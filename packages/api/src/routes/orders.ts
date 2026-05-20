// Order read endpoints.

import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { NotFoundError, UnauthorizedError, ConflictError } from "@marketplace/shared/errors";
import { order as orderDomain } from "@marketplace/domain";
import { requirePrincipal, requireUser } from "../middleware/auth.js";
import type { OrderRepo, OrderRecord } from "../repos/order.js";
import type { SellerRepo } from "../repos/seller.js";
import type { CartLineInfo, CartRepo } from "../repos/cart.js";

// Body schema for the seller-driven transition endpoint. The state machine
// supports more events than sellers can trigger from the dashboard
// (authorize/capture are buyer/payment-side; refund needs an amount we
// don't surface yet). We only expose the four transitions that make
// sense for a COD-style fulfilment flow: start packing, ship, deliver,
// cancel. Reason is required when cancelling (state machine rejects
// empty strings on cancel/open_dispute — see domain/order/state-machine).
const SellerOrderTransitionSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("begin_fulfillment") }),
  z.object({ event: z.literal("ship") }),
  z.object({ event: z.literal("deliver") }),
  z.object({ event: z.literal("cancel"), reason: z.string().min(1).max(200) }),
]);

// Constant-time token comparison. `===` leaks length+prefix-match info via
// timing; with the 192-bit token here a remote attacker can't realistically
// exploit that, but using timingSafeEqual is the cheap, conventional fix and
// removes the class of defect from this code path entirely. The byte-length
// check is required because timingSafeEqual throws on mismatched lengths,
// and that exception itself would leak length info if reached.
function tokensEqual(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function withLineInfo(
  lines: OrderRecord["lines"],
  infos: CartLineInfo[],
): Array<Record<string, unknown>> {
  const byVariant = new Map(infos.map((i) => [i.variantId, i]));
  return lines.map((l) => {
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
    };
  });
}

function shapeOrder(o: OrderRecord, infos: CartLineInfo[]): Record<string, unknown> {
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
    lines: withLineInfo(o.lines, infos),
    customer: o.customer,
    ownerKind: o.ownerKind,
    createdAt: new Date(o.createdAt).toISOString(),
  };
}

/**
 * Seller-scoped view of an order: hides lines belonging to other sellers and
 * recomputes the line subtotal so the seller dashboard shows the slice they
 * actually owe / will ship, not the buyer-facing grand total.
 */
function shapeOrderForSeller(o: OrderRecord, sellerId: string, infos: CartLineInfo[]): Record<string, unknown> {
  const myLines = o.lines.filter((l) => l.sellerId === sellerId);
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
    lines: withLineInfo(myLines, infos),
    customer: o.customer,
    createdAt: new Date(o.createdAt).toISOString(),
  };
}

export async function registerOrderRoutes(
  app: FastifyInstance,
  orders: OrderRepo,
  sellers: SellerRepo,
  carts: CartRepo,
): Promise<void> {
  async function enrichFor(list: OrderRecord[]): Promise<CartLineInfo[]> {
    const ids = new Set<string>();
    for (const o of list) for (const l of o.lines) ids.add(l.variantId);
    return ids.size > 0 ? carts.enrichLines([...ids]) : [];
  }

  app.get("/v1/orders", async (req, reply) => {
    // User-scoped order list — MUST NOT be cached by intermediates.
    reply.header("cache-control", "private, no-store");
    const sess = requireUser(req);
    const list = await orders.listForUser(sess.userId);
    const infos = await enrichFor(list);
    return { data: list.map((o) => shapeOrder(o, infos)) };
  });

  app.get<{ Params: { id: string } }>("/v1/orders/:id", async (req, reply) => {
    // Order detail is owner-scoped (user or one-time token). Never
    // cacheable across users — explicit no-store.
    reply.header("cache-control", "private, no-store");
    const o = await orders.get(req.params.id);
    // Existence is not disclosed before auth — otherwise a caller could
    // enumerate valid order ids by comparing not_found vs access_denied.
    // Anonymous callers without a matching token always see access_denied.
    const userId = req.userPrincipal?.userId;
    const token = typeof req.headers["x-mp-order-token"] === "string" ? req.headers["x-mp-order-token"] : "";
    const isOwner = !!o && o.ownerKind === "user" && o.ownerId === userId;
    const tokenOk = !!o && token.length > 0 && tokensEqual(token, o.accessToken);
    if (!isOwner && !tokenOk) {
      throw new UnauthorizedError("order_access_denied");
    }
    const infos = await enrichFor([o!]);
    return shapeOrder(o!, infos);
  });

  // Seller view: orders that contain at least one of this seller's items.
  // Only the seller's own lines are returned. Caller must be the seller owner
  // (synthetic agent id matches), enforced via the SESSION_OR_PASSPORT path.
  app.get<{ Params: { id: string } }>("/v1/sellers/:id/orders", async (req, reply) => {
    // Seller-scoped order list — must never be cached across sellers.
    reply.header("cache-control", "private, no-store");
    const principal = requirePrincipal(req);
    const seller = await sellers.get(req.params.id);
    if (!seller) throw new NotFoundError("seller", req.params.id);
    if (seller.ownerAgentId !== principal.agentId) {
      throw new UnauthorizedError("not_seller_owner");
    }
    const list = await orders.listForSeller(req.params.id);
    const infos = await enrichFor(list);
    return { data: list.map((o) => shapeOrderForSeller(o, req.params.id, infos)) };
  });

  // Seller-driven order transition. Applies a domain event (begin_fulfillment
  // /ship/deliver/cancel) on an order. The caller must own at least one line
  // item in the order (verified inside the repo against orderItems.sellerId).
  // Returns the new status.
  app.post<{ Params: { sellerId: string; orderId: string } }>(
    "/v1/sellers/:sellerId/orders/:orderId/transition",
    async (req, reply) => {
      reply.header("cache-control", "private, no-store");
      const principal = requirePrincipal(req);
      const { sellerId, orderId } = req.params;
      const seller = await sellers.get(sellerId);
      if (!seller) throw new NotFoundError("seller", sellerId);
      if (seller.ownerAgentId !== principal.agentId) {
        throw new UnauthorizedError("not_seller_owner");
      }
      const body = SellerOrderTransitionSchema.parse(req.body);
      const event: orderDomain.OrderEvent =
        body.event === "cancel"
          ? { kind: "cancel", reason: body.reason }
          : { kind: body.event };
      const result = await orders.applySellerEvent({
        orderId,
        sellerId,
        event,
        actorAgentId: principal.agentId,
      });
      if (result.kind === "not_found") throw new NotFoundError("order", orderId);
      if (result.kind === "not_owned") {
        // Order exists but this seller has no lines in it. Same 401 shape
        // as the seller-list endpoint so the seller dashboard handles
        // both consistently.
        throw new UnauthorizedError("not_seller_owner");
      }
      if (result.kind === "invalid_transition") {
        throw new ConflictError(
          `order_invalid_transition:${result.current}->${body.event}`,
        );
      }
      void reply.code(200);
      return { orderId, status: result.status };
    },
  );
}
