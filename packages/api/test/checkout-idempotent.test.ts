// Verifies the idempotent retry path on POST /v1/checkout/confirm added
// 2026-05-12. /mcp is exempt from the HTTP idempotency middleware, so an MCP
// or agent client that retries checkout.confirm after a successful first
// attempt previously hit `cart: empty` (the first call cleared the cart) and
// raised a "Promise errored, but reply.sent" 500 line. The handler now looks
// up the most recent order for the cart in a short window and replays its
// payload — same orderId, same orderToken, statusCode 200 with replayed:true.

import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { MarketplaceError } from "@marketplace/shared/errors";
import { registerCheckoutRoutes } from "../src/routes/checkout.js";
import type { CartRepo } from "../src/repos/cart.js";
import type { OrderRepo } from "../src/repos/order.js";

const CART_ID = "00000000-0000-7000-8000-000000000a01";
const VARIANT_ID = "00000000-0000-7000-8000-000000000b01";
const SELLER_ID = "00000000-0000-7000-8000-000000000c01";

function buildCarts(initialLines: Array<{ variantId: string; sellerId: string; qty: number; unitPriceMinor: bigint }>): CartRepo {
  let lines = [...initialLines];
  return {
    getOrCreate: async () => ({ cartId: CART_ID, ownerKind: "anonymous", ownerId: "anonymous", currency: "DZD", lines, createdAt: Date.now(), updatedAt: Date.now() }),
    get: async (id) => (id === CART_ID ? { cartId: CART_ID, ownerKind: "anonymous", ownerId: "anonymous", currency: "DZD", lines, createdAt: Date.now(), updatedAt: Date.now() } : undefined),
    setLines: async (_id, newLines) => {
      lines = [...newLines];
      return { cartId: CART_ID, ownerKind: "anonymous", ownerId: "anonymous", currency: "DZD", lines, createdAt: Date.now(), updatedAt: Date.now() };
    },
    setCurrency: async () => ({ cartId: CART_ID, ownerKind: "anonymous", ownerId: "anonymous", currency: "DZD", lines, createdAt: Date.now(), updatedAt: Date.now() }),
    resolveLine: async (variantId, qty) => ({ line: { variantId, sellerId: SELLER_ID, qty, unitPriceMinor: 1000n }, currency: "DZD" }),
    enrichLines: async () => [],
  } as unknown as CartRepo;
}

function buildOrders(): OrderRepo & { __stored: Array<{ cartId: string; createdAt: Date; order: any }> } {
  const stored: Array<{ cartId: string; createdAt: Date; order: any }> = [];
  let nextId = 1;
  const repo: any = {
    __stored: stored,
    create: async (input: any) => {
      const order = {
        orderId: `o-${nextId++}`,
        publicNumber: `PN-${nextId}`,
        ownerKind: input.cart.ownerKind,
        ownerId: input.cart.ownerId,
        cartId: input.cart.cartId,
        status: "paid",
        currency: input.cart.currency,
        subtotalMinor: input.subtotalMinor,
        shippingMinor: input.shippingMinor,
        taxMinor: input.taxMinor,
        totalMinor: input.totalMinor,
        lines: input.cart.lines,
        customer: input.customer ?? null,
        accessToken: input.accessToken,
        createdAt: Date.now(),
      };
      stored.push({ cartId: input.cart.cartId, createdAt: new Date(), order });
      return order;
    },
    get: async () => undefined,
    listForUser: async () => [],
    listForSeller: async () => [],
    findRecentByCartId: async (cartId: string, withinMs: number) => {
      const cutoff = Date.now() - withinMs;
      const match = [...stored].reverse().find((e) => e.cartId === cartId && e.order.createdAt >= cutoff);
      return match?.order;
    },
  };
  return repo;
}

async function buildApp(cartLines: Array<{ variantId: string; sellerId: string; qty: number; unitPriceMinor: bigint }>) {
  const app = Fastify();
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof MarketplaceError) {
      void reply.code(err.status).header("content-type", "application/problem+json").send(err.toProblem(req.url));
      return;
    }
    void reply.code(500).send({ error: String(err) });
  });
  const carts = buildCarts(cartLines);
  const orders = buildOrders();
  await registerCheckoutRoutes(app, { carts, orders });
  return { app, carts, orders };
}

const VALID_CONFIRM = {
  cartId: CART_ID,
  customer: { name: "Buyer", phone: "+213555000000", region: "Alger" },
};

describe("POST /v1/checkout/confirm — idempotent retry on empty cart", () => {
  it("first confirm creates the order, second confirm returns the same order as a replay", async () => {
    const { app, orders } = await buildApp([
      { variantId: VARIANT_ID, sellerId: SELLER_ID, qty: 1, unitPriceMinor: 1000n },
    ]);

    const first = await app.inject({ method: "POST", url: "/v1/checkout/confirm", payload: VALID_CONFIRM });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json();
    expect(firstBody.orderId).toBeTruthy();
    expect(firstBody.replayed).toBeUndefined();
    expect(orders.__stored).toHaveLength(1);

    // Same cart, now empty — simulate the MCP retry path.
    const second = await app.inject({ method: "POST", url: "/v1/checkout/confirm", payload: VALID_CONFIRM });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json();
    expect(secondBody.orderId).toBe(firstBody.orderId);
    expect(secondBody.orderToken).toBe(firstBody.orderToken);
    expect(secondBody.replayed).toBe(true);
    // Critical: no second order created.
    expect(orders.__stored).toHaveLength(1);
  });

  it("rejects a confirm against an already-empty cart that has no recent order with a 400", async () => {
    const { app } = await buildApp([]);
    const res = await app.inject({ method: "POST", url: "/v1/checkout/confirm", payload: VALID_CONFIRM });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail ?? res.json().title ?? "").toMatch(/empty/i);
  });
});
