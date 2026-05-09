// Order read endpoints.

import type { FastifyInstance } from "fastify";
import { NotFoundError, UnauthorizedError } from "@marketplace/shared/errors";
import { requireUser } from "../middleware/auth.js";
import type { OrderRepo, OrderRecord } from "../repos/order.js";

function shapeOrder(o: OrderRecord): Record<string, unknown> {
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
    lines: o.lines.map((l) => ({
      variantId: l.variantId,
      sellerId: l.sellerId,
      qty: l.qty,
      unitPriceMinor: l.unitPriceMinor.toString(),
    })),
    ownerKind: o.ownerKind,
    createdAt: new Date(o.createdAt).toISOString(),
  };
}

export async function registerOrderRoutes(app: FastifyInstance, orders: OrderRepo): Promise<void> {
  app.get("/v1/orders", async (req) => {
    const sess = requireUser(req);
    const list = await orders.listForUser(sess.userId);
    return { data: list.map(shapeOrder) };
  });

  app.get<{ Params: { id: string } }>("/v1/orders/:id", async (req) => {
    const o = await orders.get(req.params.id);
    if (!o) throw new NotFoundError("order", req.params.id);

    const userId = req.userPrincipal?.userId;
    if (o.ownerKind === "user" && o.ownerId === userId) {
      return shapeOrder(o);
    }
    const token = typeof req.headers["x-mp-order-token"] === "string" ? req.headers["x-mp-order-token"] : "";
    if (token === o.accessToken) {
      return shapeOrder(o);
    }
    throw new UnauthorizedError("order_access_denied");
  });
}
