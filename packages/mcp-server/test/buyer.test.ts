// MCP buyer-flow tests: anonymous agent walks add_item → checkout.confirm →
// order.get, and a seller-owner agent reads seller.list_orders.

import { describe, expect, it } from "vitest";
import { McpRegistry, type McpContext } from "../src/registry.js";
import { registerBuyerTools, type BuyerAdapter } from "../src/tools/buyer.js";
import type { cart as cartDomain } from "@marketplace/domain";

function makeAdapter(): BuyerAdapter & { __seedVariant: (input: { variantId: string; productId: string; sellerId: string; priceMinor: bigint; currency: string; title: string; sku: string }) => void } {
  const carts = new Map<string, { cartId: string; ownerKind: "user" | "anonymous"; ownerId: string; currency: string; lines: cartDomain.CartLine[]; createdAt: number; updatedAt: number }>();
  const orders = new Map<string, {
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
  }>();
  const variants = new Map<string, { variantId: string; productId: string; sellerId: string; priceMinor: bigint; currency: string; title: string; sku: string }>();
  const sellers = new Map<string, { sellerId: string; ownerAgentId: string }>();
  let nextId = 1;

  return {
    carts: {
      async getOrCreate(input) {
        if (input.cartId && carts.has(input.cartId)) return carts.get(input.cartId)!;
        const cartId = `crt_${nextId++}`;
        const c = {
          cartId,
          ownerKind: "anonymous" as const,
          ownerId: "anonymous",
          currency: input.currency ?? "USD",
          lines: [] as cartDomain.CartLine[],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        carts.set(cartId, c);
        return c;
      },
      async get(id) {
        return carts.get(id);
      },
      async setLines(id, lines) {
        const c = carts.get(id);
        if (!c) throw new Error(`unknown_cart:${id}`);
        const u = { ...c, lines: [...lines], updatedAt: Date.now() };
        carts.set(id, u);
        return u;
      },
      async setCurrency(id, currency) {
        const c = carts.get(id);
        if (!c) throw new Error(`unknown_cart:${id}`);
        if (c.lines.length > 0 && c.currency !== currency) throw new Error("cart_currency_locked");
        const u = { ...c, currency, updatedAt: Date.now() };
        carts.set(id, u);
        return u;
      },
      async resolveLine(variantId, qty) {
        const v = variants.get(variantId);
        if (!v) throw new Error(`unknown_variant:${variantId}`);
        return {
          line: { variantId: v.variantId, sellerId: v.sellerId, qty, unitPriceMinor: v.priceMinor },
          currency: v.currency,
        };
      },
      async enrichLines(variantIds) {
        return variantIds
          .map((id) => variants.get(id))
          .filter((v): v is NonNullable<typeof v> => Boolean(v))
          .map((v) => ({ variantId: v.variantId, productId: v.productId, title: v.title, sku: v.sku, heroImageUrl: null }));
      },
    },
    orders: {
      async create(input) {
        const orderId = `ord_${nextId++}`;
        const o = {
          orderId,
          publicNumber: `MP-TEST-${nextId}`,
          ownerKind: input.cart.ownerKind,
          ownerId: input.cart.ownerId,
          status: "paid",
          currency: input.cart.currency,
          subtotalMinor: input.subtotalMinor,
          shippingMinor: input.shippingMinor,
          taxMinor: input.taxMinor,
          totalMinor: input.totalMinor,
          lines: [...input.cart.lines],
          customer: input.customer ?? null,
          accessToken: input.accessToken,
          createdAt: Date.now(),
        };
        orders.set(orderId, o);
        return o;
      },
      async get(id) {
        return orders.get(id);
      },
      async listForSeller(sellerId) {
        return [...orders.values()].filter((o) => o.lines.some((l) => l.sellerId === sellerId));
      },
    },
    sellers: {
      async get(id) {
        return sellers.get(id);
      },
    },
    __seedVariant(input) {
      variants.set(input.variantId, input);
      if (!sellers.has(input.sellerId)) {
        sellers.set(input.sellerId, { sellerId: input.sellerId, ownerAgentId: "agt_test_owner" });
      }
    },
  };
}

function makeContext(overrides: Partial<McpContext> = {}): McpContext {
  return {
    agentId: "agt_test",
    passportId: "psp_test",
    scopes: new Set([
      "buyer:cart:read",
      "buyer:cart:write",
      "buyer:checkout:write",
      "buyer:order:read",
      "seller:order:read",
    ]),
    ownerKind: "user",
    ownerId: "usr_test",
    requestId: "req_test",
    now: () => Date.now(),
    emitAudit: async () => undefined,
    ...overrides,
  };
}

describe("buyer MCP tools", () => {
  it("add_item → checkout.confirm → order.get round-trip", async () => {
    const reg = new McpRegistry();
    const adapter = makeAdapter();
    registerBuyerTools(reg, adapter);
    adapter.__seedVariant({
      variantId: "var_phone_1",
      productId: "prd_phone",
      sellerId: "slr_1",
      priceMinor: 50000n,
      currency: "USD",
      title: "Test phone",
      sku: "SKU-1",
    });
    const ctx = makeContext();

    // First add: no cartId, creates one.
    const add1 = await reg.invoke("cart.add_item", { variantId: "var_phone_1", qty: 2 }, ctx) as { cartId: string; lines: Array<{ qty: number; title: string }>; totals: { subtotalMinor: string } };
    expect(add1.lines).toHaveLength(1);
    expect(add1.lines[0]!.qty).toBe(2);
    expect(add1.lines[0]!.title).toBe("Test phone");
    expect(add1.totals.subtotalMinor).toBe("100000");

    // Confirm with customer.
    const order = await reg.invoke("checkout.confirm", {
      cartId: add1.cartId,
      customer: { name: "Karim B.", phone: "0660111222", region: "Oran" },
    }, ctx) as { orderId: string; publicNumber: string; orderToken: string; customer: { phone: string }; lines: Array<{ qty: number }> };
    expect(order.customer.phone).toBe("0660111222");
    expect(order.orderToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(order.lines[0]!.qty).toBe(2);

    // order.get with the right token works.
    const fetched = await reg.invoke("order.get", { orderId: order.orderId, orderToken: order.orderToken }, ctx) as { publicNumber: string };
    expect(fetched.publicNumber).toBe(order.publicNumber);

    // order.get without the token (and not owner) is rejected.
    await expect(reg.invoke("order.get", { orderId: order.orderId }, ctx)).rejects.toThrow();
  });

  it("seller.list_orders only returns orders for the calling agent's seller", async () => {
    const reg = new McpRegistry();
    const adapter = makeAdapter();
    registerBuyerTools(reg, adapter);
    adapter.__seedVariant({
      variantId: "var_a",
      productId: "prd_a",
      sellerId: "slr_owned_by_test",
      priceMinor: 1000n,
      currency: "USD",
      title: "Owned product",
      sku: "OWN-1",
    });
    // Place an order on the owned seller.
    const buyerCtx = makeContext();
    const add = await reg.invoke("cart.add_item", { variantId: "var_a", qty: 1 }, buyerCtx) as { cartId: string };
    await reg.invoke("checkout.confirm", {
      cartId: add.cartId,
      customer: { name: "Test", phone: "0555", region: "Alger" },
    }, buyerCtx);

    // Seller owner reads orders for slr_owned_by_test → 1 entry with customer.
    const ownerCtx = makeContext({ agentId: "agt_test_owner" });
    const r = await reg.invoke("seller.list_orders", { sellerId: "slr_owned_by_test" }, ownerCtx) as { data: Array<{ customer: { phone: string }; lines: Array<{ qty: number }> }> };
    expect(r.data).toHaveLength(1);
    expect(r.data[0]!.customer.phone).toBe("0555");
    expect(r.data[0]!.lines[0]!.qty).toBe(1);

    // A different agent gets a validation error (not_seller_owner).
    const intruderCtx = makeContext({ agentId: "agt_some_other_agent" });
    await expect(reg.invoke("seller.list_orders", { sellerId: "slr_owned_by_test" }, intruderCtx)).rejects.toThrow(/not_seller_owner/);
  });

  it("cart.add_item rejects mixed-currency lines", async () => {
    const reg = new McpRegistry();
    const adapter = makeAdapter();
    registerBuyerTools(reg, adapter);
    adapter.__seedVariant({ variantId: "v_usd", productId: "p1", sellerId: "s1", priceMinor: 100n, currency: "USD", title: "USD item", sku: "U-1" });
    adapter.__seedVariant({ variantId: "v_dzd", productId: "p2", sellerId: "s2", priceMinor: 200n, currency: "DZD", title: "DZD item", sku: "D-1" });
    const ctx = makeContext();
    const first = await reg.invoke("cart.add_item", { variantId: "v_usd", qty: 1 }, ctx) as { cartId: string };
    await expect(
      reg.invoke("cart.add_item", { cartId: first.cartId, variantId: "v_dzd", qty: 1 }, ctx),
    ).rejects.toThrow(/currency_mismatch/);
  });
});
