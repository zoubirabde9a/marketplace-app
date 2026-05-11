// Buyer-side MCP tools — mirror the HTTP cart/checkout/order flow that powers
// the web UI, so an MCP-driven agent can browse → add → confirm → fetch an
// order end-to-end via JSON-RPC instead of raw REST.
//
// The handlers take the same repo interfaces the REST routes use, so we go
// through the same domain validation (priceQuote, currency lock, etc.) and
// the same storage code path. Agents passing a cartId across calls keep
// continuity the way an anonymous browser does with the mp_cart_id cookie.

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { NotFoundError, ValidationError } from "@marketplace/shared/errors";
import { cart as cartDomain, checkout as checkoutDomain } from "@marketplace/domain";
import type { McpRegistry } from "../registry.js";
import { webBase } from "./snapshot-helpers.js";

function productWebUrl(productId: string): string | undefined {
  const base = webBase();
  return base ? `${base}/product/${encodeURIComponent(productId)}` : undefined;
}

function orderWebUrl(orderId: string): string | undefined {
  const base = webBase();
  return base ? `${base}/order/${encodeURIComponent(orderId)}` : undefined;
}

/**
 * Buyer adapter — the minimal subset of repo methods the buyer tools need.
 * Same shapes as the HTTP routes' deps so the API server can pass its existing
 * Drizzle-backed repos straight through.
 */
export interface BuyerAdapter {
  carts: {
    getOrCreate(input: { cartId?: string; userId?: string; currency?: string }): Promise<CartRecord>;
    get(cartId: string): Promise<CartRecord | undefined>;
    setLines(cartId: string, lines: cartDomain.CartLine[]): Promise<CartRecord>;
    setCurrency(cartId: string, currency: string): Promise<CartRecord>;
    resolveLine(variantId: string, qty: number): Promise<{ line: cartDomain.CartLine; currency: string }>;
    enrichLines(variantIds: string[]): Promise<CartLineInfo[]>;
  };
  orders: {
    create(input: {
      cart: CartRecord;
      subtotalMinor: bigint;
      shippingMinor: bigint;
      taxMinor: bigint;
      totalMinor: bigint;
      accessToken: string;
      customer?: { name: string; phone: string; region: string };
    }): Promise<OrderRecord>;
    get(orderId: string): Promise<OrderRecord | undefined>;
    listForSeller(sellerId: string): Promise<OrderRecord[]>;
  };
  sellers: {
    get(sellerId: string): Promise<{ sellerId: string; ownerAgentId: string } | undefined>;
  };
}

interface CartRecord {
  cartId: string;
  ownerKind: "user" | "anonymous";
  ownerId: string;
  currency: string;
  lines: cartDomain.CartLine[];
  createdAt: number;
  updatedAt: number;
}

interface OrderRecord {
  orderId: string;
  publicNumber: string;
  ownerKind: "user" | "anonymous";
  ownerId: string;
  status: string;
  currency: string;
  subtotalMinor: bigint;
  shippingMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  lines: cartDomain.CartLine[];
  customer: { name: string; phone: string; region: string } | null;
  accessToken: string;
  createdAt: number;
}

interface CartLineInfo {
  variantId: string;
  productId: string;
  title: string;
  sku: string;
  heroImageUrl: string | null;
}

// Flat shipping options — same defaults the REST checkout uses. Until we wire
// a real shipping-rate engine, MCP and HTTP agree on these two carriers so
// totals match between the two surfaces.
const FLAT_SHIPPING_OPTIONS = [
  { carrier: "MP-Shipping", service: "standard", costMinor: 599n, estDeliveryDays: 5 },
  { carrier: "MP-Shipping", service: "express", costMinor: 1499n, estDeliveryDays: 2 },
];

// ─── Shared output shapes ────────────────────────────────────────────────────

const CartLineOutputSchema = z.object({
  variantId: z.string(),
  sellerId: z.string(),
  qty: z.number().int(),
  unitPriceMinor: z.string(),
  productId: z.string().nullable(),
  title: z.string().nullable(),
  sku: z.string().nullable(),
  heroImageUrl: z.string().nullable(),
  /** Permanent product page URL — null when the variant's product was deleted. */
  productUrl: z.string().url().nullable(),
});

const CartOutputSchema = z.object({
  cartId: z.string(),
  currency: z.string(),
  ownerKind: z.enum(["user", "anonymous"]),
  lines: z.array(CartLineOutputSchema),
  totals: z.object({
    subtotalMinor: z.string(),
    shippingMinor: z.string(),
    taxMinor: z.string(),
    discountMinor: z.string(),
    tipMinor: z.string(),
    totalMinor: z.string(),
  }),
});

async function shapeCart(deps: BuyerAdapter, c: CartRecord): Promise<z.infer<typeof CartOutputSchema>> {
  const totals = cartDomain.totalsFor({ cartId: c.cartId, currency: c.currency, lines: c.lines });
  const infos = c.lines.length > 0 ? await deps.carts.enrichLines(c.lines.map((l) => l.variantId)) : [];
  const byVariant = new Map(infos.map((i) => [i.variantId, i]));
  return {
    cartId: c.cartId,
    currency: c.currency,
    ownerKind: c.ownerKind,
    lines: c.lines.map((l) => {
      const info = byVariant.get(l.variantId);
      return {
        variantId: l.variantId,
        sellerId: l.sellerId,
        qty: l.qty,
        unitPriceMinor: l.unitPriceMinor.toString(),
        productId: info?.productId ?? null,
        title: info?.title ?? null,
        sku: info?.sku ?? null,
        heroImageUrl: info?.heroImageUrl ?? null,
        productUrl: info?.productId ? productWebUrl(info.productId) ?? null : null,
      };
    }),
    totals: {
      subtotalMinor: totals.subtotalMinor.toString(),
      shippingMinor: totals.shippingMinor.toString(),
      taxMinor: totals.taxMinor.toString(),
      discountMinor: totals.discountMinor.toString(),
      tipMinor: totals.tipMinor.toString(),
      totalMinor: totals.totalMinor.toString(),
    },
  };
}

const OrderLineOutputSchema = z.object({
  variantId: z.string(),
  sellerId: z.string(),
  qty: z.number().int(),
  unitPriceMinor: z.string(),
  productId: z.string().nullable(),
  title: z.string().nullable(),
  sku: z.string().nullable(),
  heroImageUrl: z.string().nullable(),
  productUrl: z.string().url().nullable(),
});

const OrderOutputSchema = z.object({
  orderId: z.string(),
  publicNumber: z.string(),
  status: z.string(),
  currency: z.string(),
  totals: z.object({
    subtotalMinor: z.string(),
    shippingMinor: z.string(),
    taxMinor: z.string(),
    totalMinor: z.string(),
  }),
  lines: z.array(OrderLineOutputSchema),
  customer: z
    .object({ name: z.string(), phone: z.string(), region: z.string() })
    .nullable(),
  ownerKind: z.enum(["user", "anonymous"]),
  createdAt: z.string(),
  /**
   * Per-order access token. Required as `x-mp-order-token` header (or to the
   * `order.get` tool's `orderToken` field) for any future read. Treat as a
   * secret: anyone holding the token can read the order. Returned only on
   * checkout.confirm — never re-derivable.
   */
  orderToken: z.string().optional(),
  /** Buyer-facing public confirmation page (no expiry; auth via orderToken cookie). */
  orderUrl: z.string().url().optional(),
});

async function shapeOrder(
  deps: BuyerAdapter,
  o: OrderRecord,
  opts: { includeToken: boolean },
): Promise<z.infer<typeof OrderOutputSchema>> {
  const infos = o.lines.length > 0 ? await deps.carts.enrichLines(o.lines.map((l) => l.variantId)) : [];
  const byVariant = new Map(infos.map((i) => [i.variantId, i]));
  const oUrl = orderWebUrl(o.orderId);
  return {
    orderId: o.orderId,
    publicNumber: o.publicNumber,
    status: o.status,
    currency: o.currency,
    totals: {
      subtotalMinor: o.subtotalMinor.toString(),
      shippingMinor: o.shippingMinor.toString(),
      taxMinor: o.taxMinor.toString(),
      totalMinor: o.totalMinor.toString(),
    },
    lines: o.lines.map((l) => {
      const info = byVariant.get(l.variantId);
      return {
        variantId: l.variantId,
        sellerId: l.sellerId,
        qty: l.qty,
        unitPriceMinor: l.unitPriceMinor.toString(),
        productId: info?.productId ?? null,
        title: info?.title ?? null,
        sku: info?.sku ?? null,
        heroImageUrl: info?.heroImageUrl ?? null,
        productUrl: info?.productId ? productWebUrl(info.productId) ?? null : null,
      };
    }),
    customer: o.customer,
    ownerKind: o.ownerKind,
    createdAt: new Date(o.createdAt).toISOString(),
    ...(opts.includeToken ? { orderToken: o.accessToken } : {}),
    ...(oUrl ? { orderUrl: oUrl } : {}),
  };
}

// ─── Tool: cart.add_item ─────────────────────────────────────────────────────

const AddItemInput = z.object({
  /**
   * Cart to add to. Omit on the first call to start a new anonymous cart;
   * the response carries `cartId` — pass it back on subsequent calls so the
   * agent's cart persists across tool invocations.
   */
  cartId: z.string().min(1).optional(),
  variantId: z.string().min(1),
  qty: z.coerce.number().int().min(1).max(999),
});

// ─── Tool: cart.update_qty ───────────────────────────────────────────────────

const UpdateQtyInput = z.object({
  cartId: z.string().min(1),
  variantId: z.string().min(1),
  qty: z.coerce.number().int().min(0).max(999),
});

// ─── Tool: cart.remove_item ──────────────────────────────────────────────────

const RemoveItemInput = z.object({
  cartId: z.string().min(1),
  variantId: z.string().min(1),
});

// ─── Tool: cart.get ──────────────────────────────────────────────────────────

const GetCartInput = z.object({ cartId: z.string().min(1) });

// ─── Tool: checkout.confirm ──────────────────────────────────────────────────

const CustomerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(4).max(32),
  region: z.string().trim().min(2).max(120),
});

const ConfirmInput = z.object({
  cartId: z.string().min(1),
  /**
   * ISO 3166-1 alpha-2. Drives the buyer-context country used by the price
   * quote (mostly a hint today; the cart price is already locked at add time).
   */
  shipsTo: z.string().length(2).optional(),
  shipping: z
    .object({ carrier: z.string(), service: z.string() })
    .optional(),
  /**
   * Buyer contact captured at checkout. The seller needs all three to fulfil
   * a cash-on-delivery order: name to put on the package, phone to call before
   * the courier rides out, region (Algerian wilaya for the live marketplace)
   * to quote the local delivery fee and dispatch the right courier.
   */
  customer: CustomerSchema,
});

// ─── Tool: order.get ─────────────────────────────────────────────────────────

const GetOrderInput = z.object({
  orderId: z.string().min(1),
  /**
   * Required for anonymous orders — the access token returned by
   * checkout.confirm. Treat as a per-order secret. For user-owned orders
   * (when the calling agent is bound to the buyer user, e.g. via a passport
   * issued for that user), token is not required.
   */
  orderToken: z.string().min(1).optional(),
});

// ─── Tool: seller.list_orders ────────────────────────────────────────────────

const ListSellerOrdersInput = z.object({
  /** Seller id whose orders to list. Caller must own this seller. */
  sellerId: z.string().min(1),
});

const SellerOrderLineSchema = z.object({
  variantId: z.string(),
  qty: z.number().int(),
  unitPriceMinor: z.string(),
  productId: z.string().nullable(),
  title: z.string().nullable(),
  sku: z.string().nullable(),
  heroImageUrl: z.string().nullable(),
  productUrl: z.string().url().nullable(),
});

const SellerOrderSchema = z.object({
  orderId: z.string(),
  publicNumber: z.string(),
  status: z.string(),
  currency: z.string(),
  subtotalMinor: z.string(),
  lines: z.array(SellerOrderLineSchema),
  customer: z
    .object({ name: z.string(), phone: z.string(), region: z.string() })
    .nullable(),
  createdAt: z.string(),
});

const ListSellerOrdersOutput = z.object({
  data: z.array(SellerOrderSchema),
});

// ─── Registration ────────────────────────────────────────────────────────────

export function registerBuyerTools(reg: McpRegistry, deps: BuyerAdapter): void {
  reg.register({
    name: "cart.add_item",
    description: [
      "Add a product variant to a cart. Use this to build up an order line-by-line before checkout.",
      "",
      "First call: omit `cartId` — a new anonymous cart is created and its id returned. Hold that id and",
      "pass it back as `cartId` on every subsequent cart/checkout tool call so the same cart is updated.",
      "Without the cartId on the second call you'd start a fresh cart and the first item would be lost.",
      "",
      "`variantId` is the per-SKU id returned by catalog.get_product → variants[].id (NOT the productId).",
      "All lines in one cart must share a currency; the first add_item locks the cart to that variant's",
      "currency and any later add_item with a different currency is rejected.",
    ].join("\n"),
    scope: "buyer:cart:write",
    auditEvent: "cart.add_item",
    idempotent: false,
    inputSchema: AddItemInput,
    outputSchema: CartOutputSchema,
    handler: async (input) => {
      const existing = input.cartId
        ? await deps.carts.getOrCreate({ cartId: input.cartId })
        : await deps.carts.getOrCreate({});
      let resolved;
      try {
        resolved = await deps.carts.resolveLine(input.variantId, input.qty);
      } catch {
        throw new NotFoundError("variant", input.variantId);
      }
      let cart = existing;
      if (cart.lines.length === 0) {
        if (cart.currency !== resolved.currency) {
          cart = await deps.carts.setCurrency(cart.cartId, resolved.currency);
        }
      } else if (cart.currency !== resolved.currency) {
        throw new ValidationError([
          { path: "variantId", message: `currency_mismatch:cart=${cart.currency},variant=${resolved.currency}` },
        ]);
      }
      const updated = await deps.carts.setLines(cart.cartId, cartDomain.addLine(cart.lines, resolved.line));
      return shapeCart(deps, updated);
    },
  });

  reg.register({
    name: "cart.update_qty",
    description: [
      "Change the quantity of one line in an existing cart. Pass qty=0 to delete the line entirely",
      "(equivalent to cart.remove_item). The cart's currency, owner, and other lines are untouched.",
    ].join("\n"),
    scope: "buyer:cart:write",
    auditEvent: "cart.update_qty",
    idempotent: false,
    inputSchema: UpdateQtyInput,
    outputSchema: CartOutputSchema,
    handler: async (input) => {
      const cart = await deps.carts.get(input.cartId);
      if (!cart) throw new NotFoundError("cart", input.cartId);
      let lines;
      try {
        lines = cartDomain.updateLineQty(cart.lines, input.variantId, input.qty);
      } catch (e) {
        throw new ValidationError([{ path: "qty", message: (e as Error).message }]);
      }
      const updated = await deps.carts.setLines(cart.cartId, lines);
      return shapeCart(deps, updated);
    },
  });

  reg.register({
    name: "cart.remove_item",
    description: "Remove a line from a cart by variantId. Returns the cart's new state.",
    scope: "buyer:cart:write",
    auditEvent: "cart.remove_item",
    idempotent: true,
    inputSchema: RemoveItemInput,
    outputSchema: CartOutputSchema,
    handler: async (input) => {
      const cart = await deps.carts.get(input.cartId);
      if (!cart) throw new NotFoundError("cart", input.cartId);
      const updated = await deps.carts.setLines(
        cart.cartId,
        cartDomain.removeLine(cart.lines, input.variantId),
      );
      return shapeCart(deps, updated);
    },
  });

  reg.register({
    name: "cart.get",
    description: [
      "Fetch the current state of a cart by id, including all line items (with product titles, SKUs,",
      "hero images, and per-line subtotals) plus running totals. Use this to confirm the cart looks",
      "right immediately before invoking checkout.confirm.",
    ].join("\n"),
    scope: "buyer:cart:read",
    auditEvent: "cart.get",
    idempotent: true,
    inputSchema: GetCartInput,
    outputSchema: CartOutputSchema,
    handler: async (input) => {
      const cart = await deps.carts.get(input.cartId);
      if (!cart) throw new NotFoundError("cart", input.cartId);
      return shapeCart(deps, cart);
    },
  });

  reg.register({
    name: "checkout.confirm",
    description: [
      "Place an order for the contents of `cartId`. Requires a `customer: { name, phone, region }`",
      "payload — the seller will call this phone to confirm before shipping cash-on-delivery, and",
      "the region (Algerian wilaya for the live marketplace) drives the delivery fee and courier.",
      "",
      "On success the cart is emptied (DO NOT call cart.* with the same cartId again — start a fresh",
      "cart for the next purchase) and the response includes:",
      "  - publicNumber: human-friendly order number to read to the buyer",
      "  - orderToken: per-order secret. SAVE THIS — it is the only credential that lets the agent",
      "    read the order again via order.get for anonymous (non-user-bound) buyers. It is never",
      "    re-derivable.",
      "  - orderUrl: public confirmation page the buyer can visit (also needs the token in a cookie).",
      "",
      "The agent SHOULD gather name + phone + region from the human buyer, not invent them — a wrong",
      "phone breaks the COD fulfilment loop and the seller will cancel the order.",
    ].join("\n"),
    scope: "buyer:checkout:write",
    auditEvent: "checkout.confirm",
    idempotent: false,
    inputSchema: ConfirmInput,
    outputSchema: OrderOutputSchema,
    handler: async (input) => {
      const cart = await deps.carts.get(input.cartId);
      if (!cart) throw new NotFoundError("cart", input.cartId);
      if (cart.lines.length === 0) {
        throw new ValidationError([{ path: "cart", message: "empty" }]);
      }
      const quote = checkoutDomain.priceQuote({
        cart: { cartId: cart.cartId, currency: cart.currency, lines: cart.lines },
        shippingOptions: FLAT_SHIPPING_OPTIONS,
        ...(input.shipping ? { preferredShipping: input.shipping } : {}),
        taxBreakdown: [],
        classifications: [],
        buyer: { shipToCountry: input.shipsTo ?? "US", isSanctionedParty: false, carriersAvailable: [] },
        rules: [],
        now: new Date(),
      });
      const accessToken = randomBytes(24).toString("base64url");
      const order = await deps.orders.create({
        cart,
        subtotalMinor: quote.totals.subtotalMinor,
        shippingMinor: quote.totals.shippingMinor,
        taxMinor: quote.totals.taxMinor,
        totalMinor: quote.totals.totalMinor,
        accessToken,
        customer: input.customer,
      });
      await deps.carts.setLines(cart.cartId, []);
      return shapeOrder(deps, order, { includeToken: true });
    },
  });

  reg.register({
    name: "order.get",
    description: [
      "Fetch a placed order by id. For anonymous orders (the COD flow we ship today) pass the",
      "`orderToken` returned by checkout.confirm — without it the call is rejected with",
      "order_access_denied. Returns the same line items + customer + totals the seller dashboard sees.",
    ].join("\n"),
    scope: "buyer:order:read",
    auditEvent: "order.get",
    idempotent: true,
    inputSchema: GetOrderInput,
    outputSchema: OrderOutputSchema,
    handler: async (input, ctx) => {
      const o = await deps.orders.get(input.orderId);
      if (!o) throw new NotFoundError("order", input.orderId);
      // Mirror /v1/orders/:id auth: owner-by-user OR matching token.
      const isOwner = o.ownerKind === "user" && o.ownerId === ctx.ownerId;
      const tokenOk = Boolean(input.orderToken) && input.orderToken === o.accessToken;
      if (!isOwner && !tokenOk) {
        throw new ValidationError([{ path: "orderToken", message: "order_access_denied" }]);
      }
      return shapeOrder(deps, o, { includeToken: false });
    },
  });

  reg.register({
    name: "seller.list_orders",
    description: [
      "List orders that contain at least one item sold by `sellerId`. The caller agent must own the",
      "seller (same ownership check as POST /v1/products); otherwise the call is rejected.",
      "",
      "Each entry includes buyer name + phone + region (so a seller agent can drive the COD",
      "follow-up call) and the seller-scoped line items + subtotal — lines for OTHER sellers in the",
      "same order are filtered out, and the subtotal is recomputed for just this seller's share.",
    ].join("\n"),
    scope: "seller:order:read",
    auditEvent: "seller.list_orders",
    idempotent: true,
    inputSchema: ListSellerOrdersInput,
    outputSchema: ListSellerOrdersOutput,
    handler: async (input, ctx) => {
      const seller = await deps.sellers.get(input.sellerId);
      if (!seller) throw new NotFoundError("seller", input.sellerId);
      if (seller.ownerAgentId !== ctx.agentId) {
        throw new ValidationError([{ path: "sellerId", message: "not_seller_owner" }]);
      }
      const list = await deps.orders.listForSeller(input.sellerId);
      // Collect all variantIds across all orders (deduped) so we hit the catalog
      // join exactly once instead of per-order.
      const ids = new Set<string>();
      for (const o of list) for (const l of o.lines) ids.add(l.variantId);
      const infos = ids.size > 0 ? await deps.carts.enrichLines([...ids]) : [];
      const byVariant = new Map(infos.map((i) => [i.variantId, i]));
      return {
        data: list.map((o) => {
          const myLines = o.lines.filter((l) => l.sellerId === input.sellerId);
          const subtotalMinor = myLines.reduce(
            (acc, l) => acc + l.unitPriceMinor * BigInt(l.qty),
            0n,
          );
          return {
            orderId: o.orderId,
            publicNumber: o.publicNumber,
            status: o.status,
            currency: o.currency,
            subtotalMinor: subtotalMinor.toString(),
            lines: myLines.map((l) => {
              const info = byVariant.get(l.variantId);
              return {
                variantId: l.variantId,
                qty: l.qty,
                unitPriceMinor: l.unitPriceMinor.toString(),
                productId: info?.productId ?? null,
                title: info?.title ?? null,
                sku: info?.sku ?? null,
                heroImageUrl: info?.heroImageUrl ?? null,
                productUrl: info?.productId ? productWebUrl(info.productId) ?? null : null,
              };
            }),
            customer: o.customer,
            createdAt: new Date(o.createdAt).toISOString(),
          };
        }),
      };
    },
  });
}
