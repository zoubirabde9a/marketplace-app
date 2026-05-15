import { and, eq, inArray } from "drizzle-orm";
import { uuidv7 } from "@marketplace/shared/ids";
import type { cart as cartDomain } from "@marketplace/domain";
import { ConflictError, NotFoundError, ValidationError } from "@marketplace/shared/errors";
import { carts, cartItems } from "../schema/cart.js";
import { productVariants, products, media } from "../schema/catalog.js";
import type { DbClient } from "../client.js";
import { isUuid } from "./_uuid.js";

export interface CartLineInfo {
  variantId: string;
  productId: string;
  title: string;
  heroImageUrl: string | null;
  sku: string;
}

export interface StoredCart {
  cartId: string;
  ownerKind: "user" | "anonymous";
  ownerId: string;
  currency: string;
  lines: cartDomain.CartLine[];
  createdAt: number;
  updatedAt: number;
}

async function loadLines(db: DbClient, cartId: string): Promise<cartDomain.CartLine[]> {
  const rows = await db.select().from(cartItems).where(eq(cartItems.cartId, cartId));
  return rows.map((r) => ({
    variantId: r.variantId,
    sellerId: r.sellerId,
    qty: r.qty,
    unitPriceMinor: r.unitPriceMinor,
  }));
}

async function shape(db: DbClient, row: typeof carts.$inferSelect): Promise<StoredCart> {
  return {
    cartId: row.id,
    ownerKind: (row.ownerKind === "user" ? "user" : "anonymous") as StoredCart["ownerKind"],
    ownerId: row.ownerUserId ?? "anonymous",
    currency: row.currency,
    lines: await loadLines(db, row.id),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export function makeCartRepo(db: DbClient) {
  return {
    async getOrCreate(input: { userId?: string; cartId?: string; currency?: string }): Promise<StoredCart> {
      if (input.userId && isUuid(input.userId)) {
        const existing = await db
          .select()
          .from(carts)
          .where(and(eq(carts.ownerUserId, input.userId), eq(carts.status, "open")))
          .limit(1);
        if (existing[0]) return shape(db, existing[0]);
        const id = uuidv7();
        const [row] = await db
          .insert(carts)
          .values({
            id,
            ownerUserId: input.userId,
            ownerKind: "user",
            currency: input.currency ?? "USD",
            status: "open",
          })
          .returning();
        return shape(db, row!);
      }
      if (input.cartId && isUuid(input.cartId)) {
        const rows = await db.select().from(carts).where(eq(carts.id, input.cartId)).limit(1);
        if (rows[0]) return shape(db, rows[0]);
      }
      const id = uuidv7();
      const [row] = await db
        .insert(carts)
        .values({
          id,
          ownerKind: "anonymous",
          currency: input.currency ?? "USD",
          status: "open",
        })
        .returning();
      return shape(db, row!);
    },

    async get(cartId: string): Promise<StoredCart | undefined> {
      if (!isUuid(cartId)) return undefined;
      const rows = await db.select().from(carts).where(eq(carts.id, cartId)).limit(1);
      return rows[0] ? shape(db, rows[0]) : undefined;
    },

    async setLines(cartId: string, lines: cartDomain.CartLine[]): Promise<StoredCart> {
      // Per-line integrity guard. The route handlers and MCP tools always
      // funnel lines through `cartDomain.addLine` / `updateLineQty` (which
      // reject NaN/non-integer qty per pass #132 and non-positive prices
      // per pass #11), but `setLines` is callable directly from internal
      // code paths (sagas, future ad-hoc admin tools, tests) — refuse
      // a malformed line at the repo boundary so a NaN qty or
      // 0/negative price can't reach the DB.
      for (const l of lines) {
        if (!Number.isInteger(l.qty) || l.qty <= 0) {
          throw new ValidationError([
            { path: "qty", message: `cart_line_qty_invalid:${l.variantId}` },
          ]);
        }
        if (l.unitPriceMinor <= 0n) {
          throw new ValidationError([
            { path: "unitPriceMinor", message: `cart_line_price_invalid:${l.variantId}` },
          ]);
        }
      }
      return db.transaction(async (tx) => {
        await tx.delete(cartItems).where(eq(cartItems.cartId, cartId));
        if (lines.length > 0) {
          await tx.insert(cartItems).values(
            lines.map((l) => ({
              id: uuidv7(),
              cartId,
              variantId: l.variantId,
              sellerId: l.sellerId,
              qty: l.qty,
              unitPriceMinor: l.unitPriceMinor,
              listPriceMinor: l.unitPriceMinor,
              addedAt: new Date(),
            })),
          );
        }
        await tx.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
        const [row] = await tx.select().from(carts).where(eq(carts.id, cartId));
        return shape(tx as unknown as DbClient, row!);
      });
    },

    async setCurrency(cartId: string, currency: string): Promise<StoredCart> {
      // Wrap the read-cart / check-empty / update-currency sequence in a
      // single transaction so a concurrent setLines can't insert items
      // between the empty check and the currency update — that race would
      // leave a mixed-currency cart that the domain refuses to price.
      return db.transaction(async (tx) => {
        const cart = await tx.select().from(carts).where(eq(carts.id, cartId)).limit(1);
        // Typed errors: NotFoundError → 404, ConflictError → 409. Pre-fix
        // these threw raw `Error("unknown_cart:…")` which the API layer's
        // error handler mapped to a generic 500.
        if (!cart[0]) throw new NotFoundError("cart", cartId);
        const items = await tx.select().from(cartItems).where(eq(cartItems.cartId, cartId));
        if (items.length > 0 && cart[0].currency !== currency) {
          throw new ConflictError(`cart_currency_locked:${cart[0].currency}`);
        }
        const [row] = await tx
          .update(carts)
          .set({ currency, updatedAt: new Date() })
          .where(eq(carts.id, cartId))
          .returning();
        return shape(tx as unknown as DbClient, row!);
      });
    },

    async enrichLines(variantIds: string[]): Promise<CartLineInfo[]> {
      const ids = variantIds.filter(isUuid);
      if (ids.length === 0) return [];
      const rows = await db
        .select({
          variantId: productVariants.id,
          productId: products.id,
          title: products.titleSanitized,
          sku: productVariants.sku,
          heroMediaId: products.heroMediaId,
        })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(inArray(productVariants.id, ids));
      if (rows.length === 0) return [];
      const heroIds = rows.map((r) => r.heroMediaId).filter((v): v is string => Boolean(v));
      const heroMap = new Map<string, string>();
      if (heroIds.length > 0) {
        const mediaRows = await db
          .select({ id: media.id, url: media.url })
          .from(media)
          .where(inArray(media.id, heroIds));
        for (const m of mediaRows) heroMap.set(m.id, m.url);
      }
      return rows.map((r) => ({
        variantId: r.variantId,
        productId: r.productId,
        title: r.title,
        sku: r.sku,
        heroImageUrl: r.heroMediaId ? heroMap.get(r.heroMediaId) ?? null : null,
      }));
    },

    async resolveLine(variantId: string, qty: number): Promise<{ line: cartDomain.CartLine; currency: string }> {
      // 404 for an unknown / malformed variant id, 409 for an unowned-but-
      // existent reference listing. The string-prefixed raw `Error` thrown
      // previously was caught by the API layer's classifyError and mapped
      // to a generic 500 unless the caller branched on `.message.startsWith`
      // for each case (which several call sites did, see cart.ts /
      // buyer.ts — fragile). Typed errors let the framework's error
      // handler do the routing.
      if (!isUuid(variantId)) throw new NotFoundError("variant", variantId);
      // Join filters to active products only — matches the browse-side
      // status filter applied in pass #84 / #85 (loadAll / fast paths /
      // searchIds). Without this, a draft / paused / removed listing's
      // variant could still be ADDED to a buyer's cart from a stale
      // browser tab, defeating the counterfeit-action-ladder's no-payouts
      // intent (a removed listing should not be purchasable). Existing
      // cart items stay (they're read from cart_items, not resolveLine'd)
      // — only NEW adds are blocked here.
      const rows = await db
        .select({
          variantId: productVariants.id,
          sellerId: products.sellerId,
          priceMinor: productVariants.priceMinor,
          currency: productVariants.currency,
        })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(and(eq(productVariants.id, variantId), eq(products.status, "active")))
        .limit(1);
      const v = rows[0];
      if (!v) throw new NotFoundError("variant", variantId);
      // Unowned reference listings (scraper-seeded with seller_id = NULL) are
      // catalog-only — they appear in search but cannot be purchased. Keep
      // the raw `Error("unowned_product:…")` here INTENTIONALLY: existing
      // route handlers (api/routes/cart.ts and api/src/tools/buyer.ts)
      // pattern-match on the message prefix `msg.startsWith("unowned_product:")`
      // to translate this into a 400 ValidationError with field path
      // `variantId`. Wrapping in ConflictError would prefix the message
      // with "Conflict: " and break those handlers.
      if (v.sellerId === null) {
        throw new Error(`unowned_product:${variantId}`);
      }
      return {
        line: { variantId: v.variantId, sellerId: v.sellerId, qty, unitPriceMinor: v.priceMinor },
        currency: v.currency,
      };
    },
  };
}
