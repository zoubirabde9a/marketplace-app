// Contract tests for the Google login + session bearer flow.
// Uses minimal in-memory mock repositories so the test does not depend on a
// live Postgres or the production Drizzle implementations.

import { describe, expect, it, beforeAll } from "vitest";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { buildServer } from "../src/server.js";
import { makeProductReader } from "../src/routes/products.js";
import type { Repos } from "../src/repos/index.js";
import type { StoredCart, StoredOrder, StoredProduct, StoredSeller, StoredUser } from "../src/types/store-types.js";
import type { cart as cartDomain, order as orderDomain } from "@marketplace/domain";

const ISSUER_KID = "test-issuer";
const AUDIENCE = "test.audience";

let publicKey: KeyObject;
let privateKey: KeyObject;

beforeAll(() => {
  const kp = generateKeyPairSync("ed25519");
  publicKey = kp.publicKey;
  privateKey = kp.privateKey;
});

let seq = 0;
const nextId = (prefix: string) => `${prefix}_test${++seq}`;

function makeMockRepos(): Repos & {
  __seedSeller: (input: { displayName: string; ownerAgentId: string }) => StoredSeller;
  __seedProduct: (input: { sellerId: string; title: string; variants: Array<{ sku: string; priceMinor: bigint; currency: string }> }) => StoredProduct;
} {
  const usersByGoogle = new Map<string, StoredUser>();
  const usersById = new Map<string, StoredUser>();
  const sellers = new Map<string, StoredSeller>();
  const products = new Map<string, StoredProduct>();
  const carts = new Map<string, StoredCart>();
  const cartByUser = new Map<string, string>();
  const orders = new Map<string, StoredOrder>();

  const sellerMap = (): Map<string, StoredSeller> => sellers;

  const productRepo = {
    async loadAll() {
      return { products: [...products.values()], sellers: sellerMap() };
    },
    async loadOne(id: string) {
      return products.get(id);
    },
    async getProductsByIds(ids: string[]) {
      return ids.map((id) => products.get(id) ?? null);
    },
    async getOwnerAgentId(productId: string) {
      const p = products.get(productId);
      if (!p) return undefined;
      return sellers.get(p.sellerId)?.ownerAgentId;
    },
    async create(input: Parameters<Repos["products"]["create"]>[0]) {
      const productId = nextId("prd");
      const variants = input.variants.map((v) => ({
        id: nextId("var"),
        sku: v.sku,
        priceMinor: v.priceMinor,
        currency: v.currency,
        inStock: v.inStock ?? true,
      }));
      const p: StoredProduct = {
        productId,
        sellerId: input.sellerId,
        titleSanitized: input.title,
        attributes: input.attributes ?? {},
        variants,
        media: [],
        counterfeitRisk: "low",
        createdAt: Date.now(),
      };
      products.set(productId, p);
      return p;
    },
    async update() {
      return undefined;
    },
    async addMedia() {
      return undefined;
    },
    async removeMedia() {
      return "not_found" as const;
    },
  };

  return {
    users: {
      async upsertByGoogleSub(input) {
        const existing = usersByGoogle.get(input.googleSub);
        const now = Date.now();
        if (existing) {
          const updated: StoredUser = {
            ...existing,
            email: input.email,
            emailVerified: input.emailVerified,
            ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
            ...(input.picture !== undefined ? { picture: input.picture } : {}),
            updatedAt: now,
          };
          usersById.set(existing.id, updated);
          usersByGoogle.set(input.googleSub, updated);
          return updated;
        }
        const u: StoredUser = {
          id: nextId("usr"),
          googleSub: input.googleSub,
          email: input.email,
          emailVerified: input.emailVerified,
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.picture !== undefined ? { picture: input.picture } : {}),
          status: "active",
          createdAt: now,
          updatedAt: now,
        };
        usersById.set(u.id, u);
        usersByGoogle.set(input.googleSub, u);
        return u;
      },
      async get(id) {
        return usersById.get(id);
      },
    },
    sellers: {
      async create(input) {
        const s: StoredSeller = {
          sellerId: nextId("sel"),
          displayName: input.displayName,
          ownerAgentId: input.ownerAgentId,
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.whatsapp !== undefined ? { whatsapp: input.whatsapp } : {}),
          ...(input.website !== undefined ? { website: input.website } : {}),
          createdAt: Date.now(),
        };
        sellers.set(s.sellerId, s);
        return s;
      },
      async updateContact() {
        return undefined;
      },
      async get(id) {
        return sellers.get(id);
      },
      async list() {
        return [...sellers.values()];
      },
      async countProducts(sellerId) {
        let n = 0;
        for (const p of products.values()) if (p.sellerId === sellerId) n++;
        return n;
      },
    },
    products: productRepo,
    carts: {
      async getOrCreate(input) {
        if (input.userId) {
          const existing = cartByUser.get(input.userId);
          if (existing) return carts.get(existing)!;
          const c: StoredCart = {
            cartId: nextId("crt"),
            ownerKind: "user",
            ownerId: input.userId,
            currency: input.currency ?? "USD",
            lines: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          carts.set(c.cartId, c);
          cartByUser.set(input.userId, c.cartId);
          return c;
        }
        if (input.cartId) {
          const e = carts.get(input.cartId);
          if (e) return e;
        }
        const c: StoredCart = {
          cartId: nextId("crt"),
          ownerKind: "anonymous",
          ownerId: "anonymous",
          currency: input.currency ?? "USD",
          lines: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        carts.set(c.cartId, c);
        return c;
      },
      async get(id) {
        return carts.get(id);
      },
      async setLines(cartId, lines) {
        const c = carts.get(cartId);
        if (!c) throw new Error("unknown_cart");
        const u: StoredCart = { ...c, lines, updatedAt: Date.now() };
        carts.set(cartId, u);
        return u;
      },
      async setCurrency(cartId, currency) {
        const c = carts.get(cartId);
        if (!c) throw new Error("unknown_cart");
        if (c.lines.length > 0 && c.currency !== currency) throw new Error("cart_currency_locked");
        const u: StoredCart = { ...c, currency, updatedAt: Date.now() };
        carts.set(cartId, u);
        return u;
      },
      async enrichLines(variantIds) {
        const out: Array<{ variantId: string; productId: string; title: string; heroImageUrl: string | null; sku: string }> = [];
        for (const p of products.values()) {
          for (const v of p.variants) {
            if (variantIds.includes(v.id)) {
              out.push({
                variantId: v.id,
                productId: p.productId,
                title: p.titleSanitized,
                sku: v.sku,
                heroImageUrl: null,
              });
            }
          }
        }
        return out;
      },
      async resolveLine(variantId, qty) {
        for (const p of products.values()) {
          const v = p.variants.find((x) => x.id === variantId);
          if (v) {
            return {
              line: { variantId: v.id, sellerId: p.sellerId, qty, unitPriceMinor: v.priceMinor } as cartDomain.CartLine,
              currency: v.currency,
            };
          }
        }
        throw new Error(`unknown_variant:${variantId}`);
      },
    },
    orders: {
      async create(input) {
        const o: StoredOrder = {
          orderId: nextId("ord"),
          publicNumber: `MP-${seq}`,
          ownerKind: input.cart.ownerKind,
          ownerId: input.cart.ownerId,
          cartId: input.cart.cartId,
          status: "paid" as orderDomain.OrderStatus,
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
        orders.set(o.orderId, o);
        return o;
      },
      async get(id) {
        return orders.get(id);
      },
      async listForUser(userId) {
        return [...orders.values()].filter((o) => o.ownerKind === "user" && o.ownerId === userId);
      },
      async listForSeller(sellerId) {
        return [...orders.values()].filter((o) => o.lines.some((l) => l.sellerId === sellerId));
      },
    },
    __seedSeller(input) {
      const s: StoredSeller = {
        sellerId: nextId("sel"),
        displayName: input.displayName,
        ownerAgentId: input.ownerAgentId,
        createdAt: Date.now(),
      };
      sellers.set(s.sellerId, s);
      return s;
    },
    __seedProduct(input) {
      const productId = nextId("prd");
      const variants = input.variants.map((v) => ({
        id: nextId("var"),
        sku: v.sku,
        priceMinor: v.priceMinor,
        currency: v.currency,
        inStock: true,
      }));
      const p: StoredProduct = {
        productId,
        sellerId: input.sellerId,
        titleSanitized: input.title,
        attributes: {},
        variants,
        media: [],
        counterfeitRisk: "low",
        createdAt: Date.now(),
      };
      products.set(productId, p);
      return p;
    },
  };
}

async function make() {
  const repos = makeMockRepos();
  const productReader = makeProductReader(repos.products);
  const app = await buildServer({
    authDeps: {
      resolveIssuerKey: async (kid) => (kid === ISSUER_KID ? publicKey : undefined),
      resolveSessionKey: async (kid) => (kid === ISSUER_KID ? publicKey : undefined),
      isPassportRevoked: async () => false,
      jtiSeen: async () => false,
      audience: AUDIENCE,
      now: () => Date.now(),
      devBypass: false,
    },
    productReader,
    repos,
    authRouteDeps: {
      googleClientId: "test-client-id",
      googleVerifyStub: async (idToken) => {
        if (idToken === "ada") {
          return { sub: "g-ada-1", email: "ada@example.com", emailVerified: true, name: "Ada" };
        }
        if (idToken === "unverified") {
          return { sub: "g-x", email: "x@example.com", emailVerified: false };
        }
        throw new Error("invalid");
      },
      sessionIssuer: { kid: ISSUER_KID, privateKey },
      passportIssuer: { kid: ISSUER_KID, privateKey, publicKey, alg: "EdDSA" },
      audience: AUDIENCE,
      now: () => Date.now(),
    },
  });
  return { app, repos };
}

describe("/v1/auth/google + session", () => {
  it("rejects an invalid Google ID token with 401", async () => {
    const { app } = await make();
    const r = await app.inject({
      method: "POST",
      url: "/v1/auth/google",
      payload: { idToken: "garbage" },
    });
    expect(r.statusCode).toBe(401);
  });

  it("rejects an unverified email with 401", async () => {
    const { app } = await make();
    const r = await app.inject({
      method: "POST",
      url: "/v1/auth/google",
      payload: { idToken: "unverified" },
    });
    expect(r.statusCode).toBe(401);
  });

  it("issues a session and lets /v1/auth/me read the user", async () => {
    const { app } = await make();
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/google",
      payload: { idToken: "ada" },
    });
    expect(login.statusCode).toBe(200);
    const body = login.json() as { sessionJwt: string; user: { email: string } };
    expect(body.sessionJwt).toMatch(/^mp_/);
    expect(body.user.email).toBe("ada@example.com");

    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${body.sessionJwt}` },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { user: { email: string } }).user.email).toBe("ada@example.com");
  });

  it("rejects /v1/auth/me without a session", async () => {
    const { app } = await make();
    const r = await app.inject({ method: "GET", url: "/v1/auth/me" });
    expect(r.statusCode).toBe(401);
  });

  it("logs in idempotently — same Google sub returns same user id", async () => {
    const { app } = await make();
    const r1 = await app.inject({ method: "POST", url: "/v1/auth/google", payload: { idToken: "ada" } });
    const r2 = await app.inject({ method: "POST", url: "/v1/auth/google", payload: { idToken: "ada" } });
    const u1 = (r1.json() as { user: { id: string } }).user.id;
    const u2 = (r2.json() as { user: { id: string } }).user.id;
    expect(u1).toBe(u2);
  });
});

describe("public catalog + cart + checkout (no auth)", () => {
  function seed(repos: ReturnType<typeof makeMockRepos>) {
    const seller = repos.__seedSeller({ displayName: "Demo", ownerAgentId: "agt_demo" });
    const product = repos.__seedProduct({
      sellerId: seller.sellerId,
      title: "Widget",
      variants: [{ sku: "W-1", priceMinor: 1000n, currency: "USD" }],
    });
    return { variantId: product.variants[0]!.id };
  }

  it("anonymous browse → cart → checkout → fetch order with token", async () => {
    const { app, repos } = await make();
    const { variantId } = seed(repos);

    const browse = await app.inject({ method: "GET", url: "/v1/products?q=widget" });
    expect(browse.statusCode).toBe(200);

    const add = await app.inject({
      method: "POST",
      url: "/v1/cart/items",
      headers: { "idempotency-key": "anon-add-12345678" },
      payload: { variantId, qty: 3 },
    });
    expect(add.statusCode).toBe(200);
    const cartId = (add.json() as { cartId: string }).cartId;

    const confirm = await app.inject({
      method: "POST",
      url: "/v1/checkout/confirm",
      headers: { "idempotency-key": "anon-confirm-12345678" },
      payload: { cartId, customer: { name: "Test Buyer", phone: "0555000111", region: "Alger" } },
    });
    expect(confirm.statusCode).toBe(201);
    const order = confirm.json() as { orderId: string; orderToken: string; ownerKind: string };
    expect(order.ownerKind).toBe("anonymous");

    const ok = await app.inject({
      method: "GET",
      url: `/v1/orders/${order.orderId}`,
      headers: { "x-mp-order-token": order.orderToken },
    });
    expect(ok.statusCode).toBe(200);

    const denied = await app.inject({ method: "GET", url: `/v1/orders/${order.orderId}` });
    expect(denied.statusCode).toBe(401);
  });

  it("rejects checkout without customer details", async () => {
    const { app, repos } = await make();
    const { variantId } = seed(repos);
    const add = await app.inject({
      method: "POST",
      url: "/v1/cart/items",
      headers: { "idempotency-key": "anon-add-bad-payload" },
      payload: { variantId, qty: 1 },
    });
    const cartId = (add.json() as { cartId: string }).cartId;
    const r = await app.inject({
      method: "POST",
      url: "/v1/checkout/confirm",
      headers: { "idempotency-key": "anon-confirm-no-customer" },
      payload: { cartId },
    });
    expect(r.statusCode).toBe(400);
  });

  it("persists customer on the order and exposes it via /v1/sellers/:id/orders", async () => {
    const { app, repos } = await make();
    // Log Ada in first so we can derive the synthetic agent id the API will
    // ascribe to her session-scoped writes (user:<userId>).
    const login = await app.inject({ method: "POST", url: "/v1/auth/google", payload: { idToken: "ada" } });
    const session = (login.json() as { sessionJwt: string }).sessionJwt;
    const adaUserId = (login.json() as { user: { id: string } }).user.id;
    const adaAgentId = `user:${adaUserId}`;

    // Seed Ada's seller + a product with one variant.
    const sellerId = repos.__seedSeller({
      displayName: "Demo Shop",
      ownerAgentId: adaAgentId,
    }).sellerId;
    const product = repos.__seedProduct({
      sellerId,
      title: "Phone",
      variants: [{ sku: "P-1", priceMinor: 50000n, currency: "USD" }],
    });
    const variantId = product.variants[0]!.id;

    // Anonymous buyer flow: add → confirm with customer details.
    const add = await app.inject({
      method: "POST",
      url: "/v1/cart/items",
      headers: { "idempotency-key": "seller-orders-add" },
      payload: { variantId, qty: 2 },
    });
    const cartId = (add.json() as { cartId: string }).cartId;
    const confirm = await app.inject({
      method: "POST",
      url: "/v1/checkout/confirm",
      headers: { "idempotency-key": "seller-orders-confirm" },
      payload: {
        cartId,
        customer: { name: "Karim B.", phone: "0660111222", region: "Oran" },
      },
    });
    expect(confirm.statusCode).toBe(201);

    // Seller view: Ada lists her seller's orders, sees Karim's order with
    // contact details and line qty intact.
    const r = await app.inject({
      method: "GET",
      url: `/v1/sellers/${sellerId}/orders`,
      headers: { authorization: `Bearer ${session}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      data: Array<{
        publicNumber: string;
        customer: { name: string; phone: string; region: string };
        lines: Array<{ qty: number }>;
      }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.customer).toEqual({ name: "Karim B.", phone: "0660111222", region: "Oran" });
    expect(body.data[0]!.lines[0]!.qty).toBe(2);

    // Caller without a session is rejected.
    const noauth = await app.inject({ method: "GET", url: `/v1/sellers/${sellerId}/orders` });
    expect(noauth.statusCode).toBe(401);
  });

  it("logged-in user gets a per-user cart automatically", async () => {
    const { app, repos } = await make();
    const { variantId } = seed(repos);
    const login = await app.inject({ method: "POST", url: "/v1/auth/google", payload: { idToken: "ada" } });
    const session = (login.json() as { sessionJwt: string }).sessionJwt;

    const add = await app.inject({
      method: "POST",
      url: "/v1/cart/items",
      headers: { "idempotency-key": "user-add-12345678", authorization: `Bearer ${session}` },
      payload: { variantId, qty: 1 },
    });
    expect(add.statusCode).toBe(200);
    expect((add.json() as { ownerKind: string }).ownerKind).toBe("user");
  });
});
