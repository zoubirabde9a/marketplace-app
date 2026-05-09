import { eq, inArray } from "drizzle-orm";
import { uuidv7 } from "@marketplace/shared/ids";
import { products, productVariants, media } from "../schema/catalog.js";
import { sellerProfiles } from "../schema/seller.js";
import type { DbClient } from "../client.js";
import { isUuid } from "./_uuid.js";

export interface StoredVariant {
  id: string;
  sku: string;
  priceMinor: bigint;
  currency: string;
  inStock: boolean;
}

export interface StoredMedia {
  id: string;
  url: string;
  contentType: string;
  byteSize?: number;
  width?: number;
  height?: number;
  altText?: string;
}

export interface StoredProduct {
  productId: string;
  sellerId: string;
  titleSanitized: string;
  descriptionSanitized?: string;
  brand?: string;
  attributes: Record<string, string>;
  variants: StoredVariant[];
  media: StoredMedia[];
  heroMediaId?: string;
  rating?: number;
  ratingCount?: number;
  categoryIds?: string[];
  shipsTo?: string[];
  counterfeitRisk: "low" | "elevated" | "high";
  createdAt: number;
}

export interface StoredSeller {
  sellerId: string;
  displayName: string;
  ownerAgentId: string;
  phone?: string;
  whatsapp?: string;
  website?: string;
  createdAt: number;
}

function shapeVariant(row: typeof productVariants.$inferSelect): StoredVariant {
  return {
    id: row.id,
    sku: row.sku,
    priceMinor: row.priceMinor,
    currency: row.currency,
    inStock: row.inStock,
  };
}

function shapeMedia(row: typeof media.$inferSelect): StoredMedia {
  return {
    id: row.id,
    url: row.url,
    contentType: row.contentType,
    byteSize: row.byteSize,
    ...(row.width !== null ? { width: row.width } : {}),
    ...(row.height !== null ? { height: row.height } : {}),
    ...(row.altText ? { altText: row.altText } : {}),
  };
}

function shapeProduct(
  p: typeof products.$inferSelect,
  vrows: Array<typeof productVariants.$inferSelect>,
  mrows: Array<typeof media.$inferSelect>,
): StoredProduct {
  return {
    productId: p.id,
    sellerId: p.sellerId,
    titleSanitized: p.titleSanitized,
    ...(p.descriptionSanitized ? { descriptionSanitized: p.descriptionSanitized } : {}),
    ...(p.brand ? { brand: p.brand } : {}),
    attributes: (p.attributes as Record<string, string>) ?? {},
    variants: vrows.map(shapeVariant),
    media: mrows.map(shapeMedia),
    ...(p.heroMediaId ? { heroMediaId: p.heroMediaId } : {}),
    ...(p.categoryIds && p.categoryIds.length > 0 ? { categoryIds: p.categoryIds } : {}),
    ...(p.shipsTo && p.shipsTo.length > 0 ? { shipsTo: p.shipsTo } : {}),
    counterfeitRisk: p.counterfeitRisk as StoredProduct["counterfeitRisk"],
    createdAt: p.createdAt.getTime(),
  };
}

export function makeProductRepo(db: DbClient) {
  // Load all products + their variants + media in 3 queries. Used by search()
  // (which delegates to the in-memory catalog/search.ts) and by listing-style
  // reads. For larger catalogs this would page or join; for the current
  // dev/demo dataset it's a fine simplification.
  async function loadAll(): Promise<{ products: StoredProduct[]; sellers: Map<string, StoredSeller> }> {
    const [prods, vars, meds, sels] = await Promise.all([
      db.select().from(products),
      db.select().from(productVariants),
      db.select().from(media),
      db.select().from(sellerProfiles),
    ]);
    const byProdVars = new Map<string, Array<typeof productVariants.$inferSelect>>();
    for (const v of vars) {
      const arr = byProdVars.get(v.productId) ?? [];
      arr.push(v);
      byProdVars.set(v.productId, arr);
    }
    const byProdMedia = new Map<string, Array<typeof media.$inferSelect>>();
    for (const m of meds) {
      if (!m.productId) continue;
      const arr = byProdMedia.get(m.productId) ?? [];
      arr.push(m);
      byProdMedia.set(m.productId, arr);
    }
    const result = prods.map((p) => shapeProduct(p, byProdVars.get(p.id) ?? [], byProdMedia.get(p.id) ?? []));
    const sellerMap = new Map<string, StoredSeller>();
    for (const s of sels) {
      sellerMap.set(s.orgId, {
        sellerId: s.orgId,
        displayName: s.storeName,
        ownerAgentId: s.ownerAgentId,
        ...(s.phone ? { phone: s.phone } : {}),
        ...(s.whatsapp ? { whatsapp: s.whatsapp } : {}),
        ...(s.website ? { website: s.website } : {}),
        createdAt: s.createdAt.getTime(),
      });
    }
    return { products: result, sellers: sellerMap };
  }

  async function loadOne(productId: string): Promise<StoredProduct | undefined> {
    if (!isUuid(productId)) return undefined;
    const prows = await db.select().from(products).where(eq(products.id, productId)).limit(1);
    if (!prows[0]) return undefined;
    const [vrows, mrows] = await Promise.all([
      db.select().from(productVariants).where(eq(productVariants.productId, productId)),
      db.select().from(media).where(eq(media.productId, productId)),
    ]);
    return shapeProduct(prows[0], vrows, mrows);
  }

  return {
    loadAll,
    loadOne,

    async getOwnerAgentId(productId: string): Promise<string | undefined> {
      if (!isUuid(productId)) return undefined;
      const rows = await db
        .select({ ownerAgentId: sellerProfiles.ownerAgentId })
        .from(products)
        .innerJoin(sellerProfiles, eq(products.sellerId, sellerProfiles.orgId))
        .where(eq(products.id, productId))
        .limit(1);
      return rows[0]?.ownerAgentId;
    },

    async create(input: {
      sellerId: string;
      title: string;
      description?: string;
      brand?: string;
      attributes?: Record<string, string>;
      categoryIds?: string[];
      shipsTo?: string[];
      variants: Array<{ sku: string; priceMinor: bigint; currency: string; inStock?: boolean }>;
      media?: Array<{
        url: string;
        contentType: string;
        byteSize?: number;
        width?: number;
        height?: number;
        altText?: string;
      }>;
      heroMediaIndex?: number;
    }): Promise<StoredProduct> {
      return db.transaction(async (tx) => {
        const productId = uuidv7();
        // Use the UUIDv7 random tail (last 12 chars) — the timestamp prefix
        // is shared between adjacent generations and would collide on the
        // (seller_id, sku) unique constraint when seeding multiple products.
        const productSku = `prd-${productId.slice(-12)}`;
        const [pRow] = await tx
          .insert(products)
          .values({
            id: productId,
            sellerId: input.sellerId,
            sku: productSku,
            titleRaw: input.title,
            titleSanitized: input.title,
            descriptionRaw: input.description ?? null,
            descriptionSanitized: input.description ?? null,
            brand: input.brand ?? null,
            attributes: input.attributes ?? {},
            categoryIds: input.categoryIds && input.categoryIds.length > 0 ? input.categoryIds : null,
            shipsTo: input.shipsTo && input.shipsTo.length > 0 ? input.shipsTo : null,
            counterfeitRisk: "low",
            status: "active",
          })
          .returning();

        const insertedMedia: Array<typeof media.$inferSelect> = [];
        if (input.media && input.media.length > 0) {
          const rows = await tx
            .insert(media)
            .values(
              input.media.map((m) => ({
                id: uuidv7(),
                sellerId: input.sellerId,
                productId,
                url: m.url,
                contentType: m.contentType,
                byteSize: m.byteSize ?? 0,
                width: m.width ?? null,
                height: m.height ?? null,
                altText: m.altText ?? null,
              })),
            )
            .returning();
          insertedMedia.push(...rows);
        }
        const heroIdx = input.heroMediaIndex ?? 0;
        const heroRow = insertedMedia[heroIdx] ?? insertedMedia[0];
        if (heroRow) {
          await tx.update(products).set({ heroMediaId: heroRow.id }).where(eq(products.id, productId));
        }

        const vRows = await tx
          .insert(productVariants)
          .values(
            input.variants.map((v) => ({
              id: uuidv7(),
              productId,
              sku: v.sku,
              options: {},
              priceMinor: v.priceMinor,
              currency: v.currency,
              salePriceMinor: 0n,
              floorPriceMinor: 0n,
              inStock: v.inStock ?? true,
            })),
          )
          .returning();

        return shapeProduct(
          { ...pRow!, ...(heroRow ? { heroMediaId: heroRow.id } : {}) },
          vRows,
          insertedMedia,
        );
      });
    },

    async update(
      productId: string,
      patch: {
        title?: string;
        description?: string | null;
        brand?: string | null;
        categoryIds?: string[];
        shipsTo?: string[];
        attributes?: Record<string, string>;
        variants?: Array<{ sku: string; priceMinor: bigint; currency: string; inStock?: boolean }>;
      },
    ): Promise<StoredProduct | undefined> {
      return db.transaction(async (tx) => {
        const exists = await tx.select().from(products).where(eq(products.id, productId)).limit(1);
        if (!exists[0]) return undefined;
        const u: Partial<typeof products.$inferInsert> = { updatedAt: new Date() };
        if (patch.title !== undefined) {
          u.titleRaw = patch.title;
          u.titleSanitized = patch.title;
        }
        if (patch.description !== undefined) {
          u.descriptionRaw = patch.description ?? null;
          u.descriptionSanitized = patch.description ?? null;
        }
        if (patch.brand !== undefined) u.brand = patch.brand ?? null;
        if (patch.categoryIds !== undefined) u.categoryIds = patch.categoryIds.length > 0 ? patch.categoryIds : null;
        if (patch.shipsTo !== undefined) u.shipsTo = patch.shipsTo.length > 0 ? patch.shipsTo : null;
        if (patch.attributes !== undefined) u.attributes = patch.attributes;
        await tx.update(products).set(u).where(eq(products.id, productId));

        if (patch.variants !== undefined) {
          const existing = await tx.select().from(productVariants).where(eq(productVariants.productId, productId));
          const bySku = new Map(existing.map((v) => [v.sku, v]));
          const keepIds = new Set<string>();
          for (const v of patch.variants) {
            const prev = bySku.get(v.sku);
            if (prev) {
              await tx
                .update(productVariants)
                .set({
                  priceMinor: v.priceMinor,
                  currency: v.currency,
                  inStock: v.inStock ?? true,
                  updatedAt: new Date(),
                })
                .where(eq(productVariants.id, prev.id));
              keepIds.add(prev.id);
            } else {
              const id = uuidv7();
              await tx.insert(productVariants).values({
                id,
                productId,
                sku: v.sku,
                options: {},
                priceMinor: v.priceMinor,
                currency: v.currency,
                salePriceMinor: 0n,
                floorPriceMinor: 0n,
                inStock: v.inStock ?? true,
              });
              keepIds.add(id);
            }
          }
          for (const v of existing) {
            if (!keepIds.has(v.id)) {
              await tx.delete(productVariants).where(eq(productVariants.id, v.id));
            }
          }
        }

        // re-load the canonical view for return
        const [pRow] = await tx.select().from(products).where(eq(products.id, productId));
        const [vRows, mRows] = await Promise.all([
          tx.select().from(productVariants).where(eq(productVariants.productId, productId)),
          tx.select().from(media).where(eq(media.productId, productId)),
        ]);
        return shapeProduct(pRow!, vRows, mRows);
      });
    },

    // The HTTP surface doesn't currently expose addMedia/removeMedia routes,
    // but the interface requires them. We implement against the media table
    // (no blob storage — the existing schema only stores URL+metadata).
    async addMedia(
      productId: string,
      input: { contentType: string; bytes: Buffer; altText?: string; width?: number; height?: number },
    ): Promise<StoredMedia | undefined> {
      const prod = await db.select().from(products).where(eq(products.id, productId)).limit(1);
      if (!prod[0]) return undefined;
      const id = uuidv7();
      const [row] = await db
        .insert(media)
        .values({
          id,
          sellerId: prod[0].sellerId,
          productId,
          url: `/v1/media/${id}`,
          contentType: input.contentType,
          byteSize: input.bytes.byteLength,
          width: input.width ?? null,
          height: input.height ?? null,
          altText: input.altText ?? null,
        })
        .returning();
      if (!prod[0].heroMediaId) {
        await db.update(products).set({ heroMediaId: id }).where(eq(products.id, productId));
      }
      return row ? shapeMedia(row) : undefined;
    },

    async removeMedia(productId: string, mediaId: string): Promise<boolean> {
      const m = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
      if (!m[0] || m[0].productId !== productId) return false;
      await db.delete(media).where(eq(media.id, mediaId));
      const prod = await db.select().from(products).where(eq(products.id, productId)).limit(1);
      if (prod[0]?.heroMediaId === mediaId) {
        const remaining = await db.select().from(media).where(eq(media.productId, productId)).limit(1);
        await db
          .update(products)
          .set({ heroMediaId: remaining[0]?.id ?? null })
          .where(eq(products.id, productId));
      }
      return true;
    },

    async getProductsByIds(ids: string[]): Promise<Array<StoredProduct | null>> {
      if (ids.length === 0) return [];
      const validIds = ids.filter(isUuid);
      const prows = validIds.length > 0
        ? await db.select().from(products).where(inArray(products.id, validIds))
        : [];
      const byId = new Map(prows.map((r) => [r.id, r]));
      const productIdsFound = prows.map((p) => p.id);
      const [vrows, mrows] =
        productIdsFound.length > 0
          ? await Promise.all([
              db.select().from(productVariants).where(inArray(productVariants.productId, productIdsFound)),
              db.select().from(media).where(inArray(media.productId, productIdsFound)),
            ])
          : [[], []];
      const byProdVars = new Map<string, Array<typeof productVariants.$inferSelect>>();
      for (const v of vrows) {
        const arr = byProdVars.get(v.productId) ?? [];
        arr.push(v);
        byProdVars.set(v.productId, arr);
      }
      const byProdMedia = new Map<string, Array<typeof media.$inferSelect>>();
      for (const m of mrows) {
        if (!m.productId) continue;
        const arr = byProdMedia.get(m.productId) ?? [];
        arr.push(m);
        byProdMedia.set(m.productId, arr);
      }
      return ids.map((id) => {
        const p = byId.get(id);
        if (!p) return null;
        return shapeProduct(p, byProdVars.get(id) ?? [], byProdMedia.get(id) ?? []);
      });
    },

    /** Resolve a variantId to its product, owning seller, price, currency. */
    async resolveVariant(variantId: string): Promise<{ productId: string; sellerId: string; priceMinor: bigint; currency: string } | undefined> {
      if (!isUuid(variantId)) return undefined;
      const rows = await db
        .select({
          productId: productVariants.productId,
          sellerId: products.sellerId,
          priceMinor: productVariants.priceMinor,
          currency: productVariants.currency,
        })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(eq(productVariants.id, variantId))
        .limit(1);
      return rows[0];
    },
  };
}
