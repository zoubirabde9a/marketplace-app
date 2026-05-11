// Order read endpoints.

import type { FastifyInstance } from "fastify";
import { NotFoundError, UnauthorizedError } from "@marketplace/shared/errors";
import { requirePrincipal, requireUser } from "../middleware/auth.js";
import type { OrderRepo, OrderRecord } from "../repos/order.js";
import type { SellerRepo } from "../repos/seller.js";
import type { CartLineInfo, CartRepo } from "../repos/cart.js";

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

  app.get("/v1/orders", async (req) => {
    const sess = requireUser(req);
    const list = await orders.listForUser(sess.userId);
    const infos = await enrichFor(list);
    return { data: list.map((o) => shapeOrder(o, infos)) };
  });

  app.get<{ Params: { id: string } }>("/v1/orders/:id", async (req) => {
    const o = await orders.get(req.params.id);
    if (!o) throw new NotFoundError("order", req.params.id);

    const userId = req.userPrincipal?.userId;
    const token = typeof req.headers["x-mp-order-token"] === "string" ? req.headers["x-mp-order-token"] : "";
    const isOwner = o.ownerKind === "user" && o.ownerId === userId;
    const tokenOk = token === o.accessToken;
    if (!isOwner && !tokenOk) {
      throw new UnauthorizedError("order_access_denied");
    }
    const infos = await enrichFor([o]);
    return shapeOrder(o, infos);
  });

  // Seller view: orders that contain at least one of this seller's items.
  // Only the seller's own lines are returned. Caller must be the seller owner
  // (synthetic agent id matches), enforced via the SESSION_OR_PASSPORT path.
  app.get<{ Params: { id: string } }>("/v1/sellers/:id/orders", async (req) => {
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
}
