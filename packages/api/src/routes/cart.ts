// Cart endpoints. Anonymous and authenticated callers both supported.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { cart as cartDomain } from "@marketplace/domain";
import { NotFoundError, ValidationError } from "@marketplace/shared/errors";
import type { CartRepo, CartRecord } from "../repos/cart.js";

const AddItemSchema = z.object({
  variantId: z.string().min(1),
  qty: z.coerce.number().int().min(1).max(999),
});

const UpdateQtySchema = z.object({
  qty: z.coerce.number().int().min(0).max(999),
});

export async function registerCartRoutes(app: FastifyInstance, carts: CartRepo): Promise<void> {
  async function shapeCart(c: CartRecord): Promise<Record<string, unknown>> {
    const totals = cartDomain.totalsFor({
      cartId: c.cartId,
      currency: c.currency,
      lines: c.lines,
    });
    const infos = c.lines.length > 0
      ? await carts.enrichLines(c.lines.map((l) => l.variantId))
      : [];
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

  async function resolveCart(req: import("fastify").FastifyRequest): Promise<CartRecord> {
    const userId = req.userPrincipal?.userId;
    const headerCartId = typeof req.headers["x-mp-cart-id"] === "string" ? req.headers["x-mp-cart-id"] : undefined;
    return carts.getOrCreate({
      ...(userId !== undefined ? { userId } : {}),
      ...(headerCartId !== undefined ? { cartId: headerCartId } : {}),
    });
  }

  app.get("/v1/cart", async (req, reply) => {
    // Cart is correlated to the caller (anonymous: session-cookie scoped;
    // authenticated: user-scoped). MUST NOT be cached by any intermediate
    // — a CDN serving user A's cart contents to user B is a real
    // user-data leak. No Cache-Control means HTTP heuristic caching MAY
    // kick in; private+no-store is explicit and intermediary-proof.
    void reply.header("cache-control", "private, no-store");
    const c = await resolveCart(req);
    void reply.header("x-mp-cart-id", c.cartId);
    return shapeCart(c);
  });

  app.post("/v1/cart/items", async (req, reply) => {
    const body = AddItemSchema.parse(req.body);
    const c = await resolveCart(req);
    let resolved;
    try {
      resolved = await carts.resolveLine(body.variantId, body.qty);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.startsWith("unowned_product:")) {
        throw new ValidationError([
          { path: "variantId", message: "unowned_product:this listing is a catalog reference and is not for sale" },
        ]);
      }
      throw new NotFoundError("variant", body.variantId);
    }
    let cart = c;
    if (cart.lines.length === 0) {
      if (cart.currency !== resolved.currency) {
        cart = await carts.setCurrency(cart.cartId, resolved.currency);
      }
    } else if (cart.currency !== resolved.currency) {
      throw new ValidationError([
        { path: "variantId", message: `currency_mismatch:cart=${cart.currency},variant=${resolved.currency}` },
      ]);
    }
    const updated = await carts.setLines(cart.cartId, cartDomain.addLine(cart.lines, resolved.line));
    void reply.header("x-mp-cart-id", updated.cartId);
    void reply.code(200);
    return shapeCart(updated);
  });

  app.patch<{ Params: { variantId: string } }>("/v1/cart/items/:variantId", async (req, reply) => {
    const body = UpdateQtySchema.parse(req.body);
    const c = await resolveCart(req);
    let lines;
    try {
      lines = cartDomain.updateLineQty(c.lines, req.params.variantId, body.qty);
    } catch (e) {
      throw new ValidationError([{ path: "qty", message: (e as Error).message }]);
    }
    const updated = await carts.setLines(c.cartId, lines);
    void reply.header("x-mp-cart-id", updated.cartId);
    return shapeCart(updated);
  });

  app.delete<{ Params: { variantId: string } }>("/v1/cart/items/:variantId", async (req, reply) => {
    const c = await resolveCart(req);
    const updated = await carts.setLines(c.cartId, cartDomain.removeLine(c.lines, req.params.variantId));
    void reply.header("x-mp-cart-id", updated.cartId);
    return shapeCart(updated);
  });

  // Backwards-compat alias: clients (likely an MCP / agent client) have been
  // observed in production logs POSTing to /v1/carts/items (note the plural)
  // and getting a misleading 401 from the auth middleware, which doesn't see
  // /v1/carts/* in PUBLIC_MATCHERS. The 401 sends them down a credential-
  // troubleshooting path that never works because the path doesn't exist —
  // the real fix is "drop the s". Issue a 308 (permanent + preserve method
  // + body) so the request is reissued at /v1/cart/items by clients that
  // honour 308, AND set the matcher in auth.ts to public so the redirect
  // actually reaches this handler instead of being short-circuited by the
  // auth onRequest hook. See anomalies [34], [55].
  app.all("/v1/carts/*", async (req, reply) => {
    const rewritten = req.url.replace(/^\/v1\/carts(\/|\?|$)/, "/v1/cart$1");
    void reply.code(308).header("location", rewritten);
    return null;
  });
  // The bare /v1/carts (no trailing path) similarly redirects to /v1/cart.
  app.all("/v1/carts", async (_req, reply) => {
    void reply.code(308).header("location", "/v1/cart");
    return null;
  });
}
