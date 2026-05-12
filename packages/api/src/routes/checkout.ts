// Checkout: quote a cart, then confirm to create an order.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { checkout as checkoutDomain } from "@marketplace/domain";
import { NotFoundError, ValidationError } from "@marketplace/shared/errors";
import type { CartRepo } from "../repos/cart.js";
import type { OrderRepo } from "../repos/order.js";

const QuoteSchema = z.object({
  cartId: z.string().min(1),
  shipsTo: z.string().length(2).optional(),
});

const CustomerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  // E.164-ish — keep permissive so locals can paste "0555..." too; UI normalises.
  phone: z.string().trim().min(4).max(32),
  // Free-text region/wilaya. UI offers a dropdown of 58 Algerian wilayas;
  // we don't enforce the list server-side so sellers can ship internationally.
  region: z.string().trim().min(2).max(120),
});

const ConfirmSchema = z.object({
  cartId: z.string().min(1),
  shipsTo: z.string().length(2).optional(),
  shipping: z
    .object({ carrier: z.string(), service: z.string() })
    .optional(),
  customer: CustomerSchema,
});

const FLAT_SHIPPING_OPTIONS = [
  { carrier: "MP-Shipping", service: "standard", costMinor: 599n, estDeliveryDays: 5 },
  { carrier: "MP-Shipping", service: "express", costMinor: 1499n, estDeliveryDays: 2 },
];

export async function registerCheckoutRoutes(
  app: FastifyInstance,
  deps: { carts: CartRepo; orders: OrderRepo },
): Promise<void> {
  app.post("/v1/checkout/quote", async (req) => {
    const body = QuoteSchema.parse(req.body);
    const c = await deps.carts.get(body.cartId);
    if (!c) throw new NotFoundError("cart", body.cartId);
    if (c.lines.length === 0) throw new ValidationError([{ path: "cart", message: "empty" }]);

    const quote = checkoutDomain.priceQuote({
      cart: { cartId: c.cartId, currency: c.currency, lines: c.lines },
      shippingOptions: FLAT_SHIPPING_OPTIONS,
      taxBreakdown: [],
      classifications: [],
      buyer: { shipToCountry: body.shipsTo ?? "US", isSanctionedParty: false, carriersAvailable: [] },
      rules: [],
      now: new Date(),
    });

    return {
      cartId: c.cartId,
      currency: c.currency,
      shippingOptions: quote.shippingOptions.map((s) => ({
        carrier: s.carrier,
        service: s.service,
        costMinor: s.costMinor.toString(),
        estDeliveryDays: s.estDeliveryDays,
      })),
      selectedShipping: quote.selectedShipping
        ? {
            carrier: quote.selectedShipping.carrier,
            service: quote.selectedShipping.service,
            costMinor: quote.selectedShipping.costMinor.toString(),
            estDeliveryDays: quote.selectedShipping.estDeliveryDays,
          }
        : null,
      totals: {
        subtotalMinor: quote.totals.subtotalMinor.toString(),
        shippingMinor: quote.totals.shippingMinor.toString(),
        taxMinor: quote.totals.taxMinor.toString(),
        totalMinor: quote.totals.totalMinor.toString(),
      },
      cartHash: quote.cartHash,
    };
  });

  // Window for treating a confirm-on-empty-cart as an idempotent replay rather
  // than a validation error. Sized to cover MCP/agent retry windows (seconds
  // to a few minutes) without papering over legitimate "user emptied cart
  // manually then tried to confirm" cases, which would have a much longer gap.
  const CONFIRM_IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;

  app.post("/v1/checkout/confirm", async (req, reply) => {
    const body = ConfirmSchema.parse(req.body);
    const c = await deps.carts.get(body.cartId);
    if (!c) throw new NotFoundError("cart", body.cartId);
    if (c.lines.length === 0) {
      // The HTTP idempotency middleware (preHandler) dedupes retries that
      // carry the same Idempotency-Key, but /mcp is exempt — so an MCP client
      // that internally retries checkout.confirm hits the cart-is-empty case
      // after the first attempt already cleared it. Treat that case as an
      // idempotent replay: return the most recent order for this cart within
      // a short window. Outside the window, fall through to the original
      // validation error so a buyer who deletes everything from a stale cart
      // doesn't silently confirm an empty order.
      const prior = await deps.orders.findRecentByCartId(body.cartId, CONFIRM_IDEMPOTENCY_WINDOW_MS);
      if (prior) {
        void reply.code(200);
        return {
          orderId: prior.orderId,
          publicNumber: prior.publicNumber,
          status: prior.status,
          currency: prior.currency,
          totals: {
            subtotalMinor: prior.subtotalMinor.toString(),
            shippingMinor: prior.shippingMinor.toString(),
            taxMinor: prior.taxMinor.toString(),
            totalMinor: prior.totalMinor.toString(),
          },
          lines: prior.lines.map((l) => ({
            variantId: l.variantId,
            sellerId: l.sellerId,
            qty: l.qty,
            unitPriceMinor: l.unitPriceMinor.toString(),
          })),
          ownerKind: prior.ownerKind,
          orderToken: prior.accessToken,
          createdAt: new Date(prior.createdAt).toISOString(),
          replayed: true,
        };
      }
      throw new ValidationError([{ path: "cart", message: "empty" }]);
    }

    const quote = checkoutDomain.priceQuote({
      cart: { cartId: c.cartId, currency: c.currency, lines: c.lines },
      // priceQuote auto-selects shippingOptions[0] when no preferredShipping is
      // passed. The web checkout never surfaces a shipping picker (seller-call
      // confirmation flow, no carrier integration), so passing the FLAT list
      // here would silently add a fee the buyer never saw on the cart/checkout
      // page. Only include options when the client explicitly picked one.
      shippingOptions: body.shipping ? FLAT_SHIPPING_OPTIONS : [],
      ...(body.shipping ? { preferredShipping: body.shipping } : {}),
      taxBreakdown: [],
      classifications: [],
      buyer: { shipToCountry: body.shipsTo ?? "US", isSanctionedParty: false, carriersAvailable: [] },
      rules: [],
      now: new Date(),
    });

    const accessToken = randomBytes(24).toString("base64url");
    const order = await deps.orders.create({
      cart: c,
      subtotalMinor: quote.totals.subtotalMinor,
      shippingMinor: quote.totals.shippingMinor,
      taxMinor: quote.totals.taxMinor,
      totalMinor: quote.totals.totalMinor,
      accessToken,
      customer: body.customer,
    });
    await deps.carts.setLines(c.cartId, []);

    void reply.code(201);
    return {
      orderId: order.orderId,
      publicNumber: order.publicNumber,
      status: order.status,
      currency: order.currency,
      totals: {
        subtotalMinor: order.subtotalMinor.toString(),
        shippingMinor: order.shippingMinor.toString(),
        taxMinor: order.taxMinor.toString(),
        totalMinor: order.totalMinor.toString(),
      },
      lines: order.lines.map((l) => ({
        variantId: l.variantId,
        sellerId: l.sellerId,
        qty: l.qty,
        unitPriceMinor: l.unitPriceMinor.toString(),
      })),
      ownerKind: order.ownerKind,
      orderToken: order.accessToken,
      createdAt: new Date(order.createdAt).toISOString(),
    };
  });
}
