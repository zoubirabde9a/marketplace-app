import { and, eq, inArray } from "drizzle-orm";
import { uuidv7 } from "@marketplace/shared/ids";
import type { cart as cartDomain } from "@marketplace/domain";
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
      const cart = await db.select().from(carts).where(eq(carts.id, cartId)).limit(1);
      if (!cart[0]) throw new Error(`unknown_cart:${cartId}`);
      const items = await db.select().from(cartItems).where(eq(cartItems.cartId, cartId));
      if (items.length > 0 && cart[0].currency !== currency) {
        throw new Error(`cart_currency_locked:${cart[0].currency}`);
      }
      const [row] = await db
        .update(carts)
        .set({ currency, updatedAt: new Date() })
        .where(eq(carts.id, cartId))
        .returning();
      return shape(db, row!);
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
      if (!isUuid(variantId)) throw new Error(`unknown_variant:${variantId}`);
      const rows = await db
        .select({
          variantId: productVariants.id,
          sellerId: products.sellerId,
          priceMinor: productVariants.priceMinor,
          currency: productVariants.currency,
        })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(eq(productVariants.id, variantId))
        .limit(1);
      const v = rows[0];
      if (!v) throw new Error(`unknown_variant:${variantId}`);
      return {
        line: { variantId: v.variantId, sellerId: v.sellerId, qty, unitPriceMinor: v.priceMinor },
        currency: v.currency,
      };
    },
  };
}
