import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { uuidv7 } from "@marketplace/shared/ids";
import {
  FIELD_LIMITS,
  sanitizeUntrustedString,
  safeOrigin,
} from "@marketplace/shared/untrusted";
import { products, productVariants, media } from "../schema/catalog.js";
import { sellerPhones, sellerProfiles } from "../schema/seller.js";
import type { DbClient } from "../client.js";
import { isUuid } from "./_uuid.js";
import { expandForWebsearch } from "../synonyms.js";

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
  /**
   * null for "unowned" reference listings (currently: scraper-seeded items
   * from Ouedkniss). Such products are visible in the catalog and search,
   * but cart/checkout paths refuse to resolve their variants — see
   * resolveLine() in repos/cart.ts and the UI guard on AddToCart.
   */
  sellerId: string | null;
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

export interface StoredSellerPhone {
  phoneE164: string;
  isWhatsapp: boolean;
  isViber: boolean;
  isPrimary: boolean;
  position: number;
}

export interface StoredSeller {
  sellerId: string;
  displayName: string;
  ownerAgentId: string;
  /** Primary number (E.164). Convenience mirror of `phones[0]`. */
  phone?: string;
  whatsapp?: string;
  phones: StoredSellerPhone[];
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
  // Sellers map only — used on the search hot path so we don't need to also
  // pay for products+variants+media when searchIds() has already narrowed
  // the candidate set in SQL.
  async function loadSellers(): Promise<Map<string, StoredSeller>> {
    const [sels, phones] = await Promise.all([
      db.select().from(sellerProfiles),
      db
        .select()
        .from(sellerPhones)
        .orderBy(desc(sellerPhones.isPrimary), asc(sellerPhones.position), asc(sellerPhones.createdAt)),
    ]);
    const phoneMap = new Map<string, StoredSellerPhone[]>();
    for (const p of phones) {
      const list = phoneMap.get(p.sellerId) ?? [];
      list.push({
        phoneE164: p.phoneE164,
        isWhatsapp: p.isWhatsapp,
        isViber: p.isViber,
        isPrimary: p.isPrimary,
        position: p.position,
      });
      phoneMap.set(p.sellerId, list);
    }
    const sellerMap = new Map<string, StoredSeller>();
    for (const s of sels) {
      const list = phoneMap.get(s.orgId) ?? [];
      const primary = list.find((p) => p.isPrimary) ?? list[0];
      const wa = list.find((p) => p.isWhatsapp);
      sellerMap.set(s.orgId, {
        sellerId: s.orgId,
        displayName: s.storeName,
        ownerAgentId: s.ownerAgentId,
        phones: list,
        ...(primary ? { phone: primary.phoneE164 } : s.phone ? { phone: s.phone } : {}),
        ...(wa ? { whatsapp: wa.phoneE164 } : s.whatsapp ? { whatsapp: s.whatsapp } : {}),
        ...(s.website ? { website: s.website } : {}),
        createdAt: s.createdAt.getTime(),
      });
    }
    return sellerMap;
  }

  async function loadAll(): Promise<{ products: StoredProduct[]; sellers: Map<string, StoredSeller> }> {
    // Filter out non-active products (status enum is draft | active | paused
    // | removed per migration schema). Browse surfaces should never see
    // drafts (sellers' work-in-progress), paused listings (seller temporarily
    // pulled), or removed listings (admin take-down / counterfeit-action
    // ladder from pass #15's `visible: false`). The create path always sets
    // status="active" today, but the schema default is "draft" and an admin
    // tool / future migration could set paused/removed — defending here
    // ensures those states actually disappear from browse without each
    // call site needing to remember to filter.
    const [prods, vars, meds, sellerMap] = await Promise.all([
      db.select().from(products).where(eq(products.status, "active")),
      db.select().from(productVariants),
      db.select().from(media),
      loadSellers(),
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

  // Public-read variant: filter to status='active'. Browse paths (loadAll)
  // already apply this filter, but direct /v1/products/:id fetch by id was
  // returning draft / paused / removed listings — defeating the
  // counterfeit-action-ladder takedown (`removed` status sets `visible:
  // false`), letting seller-pulled drafts leak to a buyer holding a stale
  // link, and undermining the anti-counterfeit guarantee that a removed
  // listing actually disappears from public surfaces. Seller-edit paths
  // (PATCH /v1/products/:id, POST/DELETE media) keep using `loadOne` so
  // they can still see their own drafts / paused / removed listings.
  async function loadOneActive(productId: string): Promise<StoredProduct | undefined> {
    if (!isUuid(productId)) return undefined;
    const prows = await db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.status, "active")))
      .limit(1);
    if (!prows[0]) return undefined;
    const [vrows, mrows] = await Promise.all([
      db.select().from(productVariants).where(eq(productVariants.productId, productId)),
      db.select().from(media).where(eq(media.productId, productId)),
    ]);
    return shapeProduct(prows[0], vrows, mrows);
  }

  // Postgres-backed text search (migration 0003): full-text via tsvector
  // (websearch_to_tsquery + ts_rank_cd) plus typo / prefix tolerance via
  // pg_trgm `word_similarity`. Plain `similarity` would compare full strings,
  // which collapses to ~0 when the title has many extra tokens beyond the
  // query — `word_similarity` finds the best-matching word inside the title
  // and is what makes "iphn" → "iPhone …" or "ipho" → "iPhone …" actually hit.
  // Threshold 0.5 was picked empirically: 0.4 admitted "oppo" → "OPERATEUR"
  // (both words share __o/_op trigrams, word_similarity ~0.4) but real typos
  // score ≥0.5 (iphn→iPhone 0.6, samsng→Samsung 0.71, sams→Samsung 0.5).
  // Tighter than the pg_trgm default (0.6) is still needed for 4-char typos.
  // The lexical score is weighted ×4 so FTS hits always outrank typo matches.
  //
  // Custom weights {D=0, C=0.05, B=0.4, A=1.0} (vs default {0.1, 0.2, 0.4,
  // 1.0}) suppress description-only matches. Default C=0.2 lets a long
  // description that mentions the query 5× (e.g., a robot-car kit with "car"
  // sprinkled through the description) beat short title matches. C=0.05 keeps
  // description as a tiebreaker without letting it dominate. Measured
  // 2026-05-11: "car" with default weights pulled in an Arduino robot kit;
  // with C=0.05 all top-12 results have "car" in the title.
  //
  // ts_rank_cd normalization=1 (divide by 1+log(doc_length)) is also critical:
  // without it, listings with long keyword-stuffed descriptions ("iPhone
  // alternative", "PC & LAPTOP & MULTIMÉDIA") beat short focused titles.
  // Measured 2026-05-11: "iphone" without norm — IPAD PRO ranked #1 at 3.6,
  // actual iPhones at 2.0–2.2. With norm=1 — Iphone11 #1 at 0.78, iPad drops
  // to ~0.50. Same effect for "laptop" (SSD-with-LAPTOP-in-title outranking
  // actual laptops).
  //
  // Freshness decay: final score is multiplied by exp(-age_days / 90). A
  // 90-day-old listing scores ×0.37, 30-day ×0.71, 1-day ×0.99 — enough to
  // break ties between equally-relevant listings without inverting the
  // lexical-vs-typo ordering. 60% of our catalog is scraped from Ouedkniss
  // and age is the strongest signal we have for "is this listing still real".
  // We use created_at (ingestion time); attributes.sourcePostedAt is a
  // future refinement once the seed pipeline reliably populates it.
  async function searchIds(q: string, limit = 200): Promise<Array<{ id: string; score: number }>> {
    const trimmed = q.trim();
    if (trimmed.length === 0) return [];
    // Bound the limit early — the `LIMIT ${limit}` interpolation a few
    // lines down accepts NaN which Postgres rejects with a
    // type-conversion error rather than returning a clean empty list.
    const safeCap = safeLimit(limit, 200);
    // Synonym expansion drives the FTS path: "frigo" → tsquery
    // 'frigo' | 'refrigerateur'. Trigram fallback keeps the literal user
    // input (qtxt) — synonyms shouldn't widen the typo-similarity check or
    // we'll match unrelated rows.
    const ftsInput = expandForWebsearch(trimmed);
    // Trigram fallback only fires for single-token queries. For multi-token
    // queries (e.g. "samsung note") word_similarity treats the query as a
    // phrase and matches the best single word in each title — so any title
    // with "samsung" leaks in regardless of "note", returning hundreds of
    // false positives. With FTS-only on multi-token, we trust the user
    // typed multiple words deliberately and want all of them. Multi-token
    // typos lose tolerance but they're rare; single-token typos still work.
    const isSingleToken = !/\s/.test(trimmed);
    // Two index-scannable subqueries UNION'd, instead of one query with
    // `... OR word_similarity(...) >= 0.5` in the WHERE. The function-form
    // comparison forced a full Seq Scan (measured 2026-05-11: p50 471ms,
    // 49k buffers/388MB for an "iphone" query); UNION ALL of two CTEs lets
    // each branch use its proper GIN index — FTS via products_search_text_idx,
    // trigram via products_title_trgm_idx with the `<%` operator. Bench:
    // trigram branch alone dropped from 320ms → 24ms (≈13×).
    //
    // The `<%` operator uses pg_trgm.word_similarity_threshold (default 0.6).
    // We need 0.5 to preserve the existing recall calibration, so we run the
    // query inside a transaction and SET LOCAL the threshold.
    return db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL pg_trgm.word_similarity_threshold = 0.5`);
      const trgmFallback = isSingleToken
        ? sql`,
        trgm_matches AS (
          SELECT p."id" AS id,
                 GREATEST(
                   word_similarity((SELECT qtxt FROM q), public.f_normalize_search(p."title_sanitized")),
                   word_similarity((SELECT qtxt FROM q), public.f_normalize_search(COALESCE(p."brand", '')))
                 )::float8
                 * exp(-EXTRACT(EPOCH FROM (NOW() - p."created_at")) / 86400.0 / 90.0)::float8
                 AS score
          FROM "catalog"."products" p
          WHERE ((SELECT qtxt FROM q) <% public.f_normalize_search(p."title_sanitized")
                 OR (SELECT qtxt FROM q) <% public.f_normalize_search(COALESCE(p."brand", '')))
            AND NOT (p."search_text" @@ (SELECT tsq FROM q))
            -- Mirror the status filter applied to loadAll / idsBySeller /
            -- recentIds / idsByCategory in pass #84. Search results
            -- should never return drafts / paused / removed listings.
            AND p."status" = 'active'
        )`
        : sql``;
      const trgmUnion = isSingleToken ? sql`UNION ALL SELECT id, score FROM trgm_matches` : sql``;
      const rows = await tx.execute<{ id: string; score: number }>(sql`
        WITH q AS (
          SELECT websearch_to_tsquery('simple', public.f_normalize_search(${ftsInput})) AS tsq,
                 public.f_normalize_search(${trimmed})::text AS qtxt
        ),
        fts_matches AS (
          SELECT p."id" AS id,
                 (
                   COALESCE(ts_rank_cd('{0.0,0.05,0.4,1.0}'::float4[], p."search_text", (SELECT tsq FROM q), 1), 0)::float8 * 4.0
                   + GREATEST(
                       word_similarity((SELECT qtxt FROM q), public.f_normalize_search(p."title_sanitized")),
                       word_similarity((SELECT qtxt FROM q), public.f_normalize_search(COALESCE(p."brand", '')))
                     )::float8
                 )
                 * exp(-EXTRACT(EPOCH FROM (NOW() - p."created_at")) / 86400.0 / 90.0)::float8
                 AS score
          FROM "catalog"."products" p
          WHERE p."search_text" @@ (SELECT tsq FROM q)
            -- Mirror the status filter applied to loadAll / idsBySeller /
            -- recentIds / idsByCategory in pass #84. FTS matches must
            -- never return drafts / paused / removed listings.
            AND p."status" = 'active'
        )${trgmFallback}
        SELECT id, score FROM (
          SELECT id, score FROM fts_matches
          ${trgmUnion}
        ) m
        ORDER BY score DESC, id ASC
        LIMIT ${safeCap}
      `);
      return (rows as Array<{ id: string; score: number | string }>).map((r) => ({
        id: r.id,
        score: Number(r.score),
      }));
    });
  }

  // Bound a caller-supplied limit. Pre-fix, a NaN or negative `limit` flowed
  // straight into Drizzle's `.limit()` and produced a `LIMIT NaN` SQL query
  // that Postgres rejects with a confusing type-conversion error. Same
  // family as the user.ts NaN-clamp (pass #75) and the search-log
  // windowHours bound (pass #72).
  function safeLimit(limit: number, fallback: number, max = 1000): number {
    if (!Number.isFinite(limit) || limit <= 0) return fallback;
    return Math.min(Math.floor(limit), max);
  }

  // Indexed lookup of one seller's product ids, newest first. Used by the
  // storefront and any "by seller, no query" caller so they can skip the
  // catalog-wide loadAll(). A small shop with 5 products doesn't need a
  // 77k-row scan to render its storefront.
  async function idsBySeller(sellerId: string, limit = 200): Promise<string[]> {
    if (!isUuid(sellerId)) return [];
    const rows = await db
      .select({ id: products.id })
      .from(products)
      // Active-only matches the loadAll filter — public browse should
      // never see drafts / paused / removed states. The seller's own
      // dashboard, if it needs draft visibility, should use a separate
      // owner-scoped read path that doesn't filter.
      .where(and(eq(products.sellerId, sellerId), eq(products.status, "active")))
      .orderBy(desc(products.createdAt))
      .limit(safeLimit(limit, 200));
    return rows.map((r) => r.id);
  }

  // Newest-N product ids across the whole catalog, ordered by created_at DESC.
  // Used by the home page's "recent listings" strip and any other caller that
  // wants "the newest N products" without paying for the full-catalog loadAll
  // + JS-sort. At 77k products the loadAll path was the source of 11s+ cold
  // hits on the home page (measured 2026-05-12); this indexed query is sub-ms.
  async function recentIds(limit = 50): Promise<string[]> {
    const rows = await db
      .select({ id: products.id })
      .from(products)
      // Active-only — same rationale as idsBySeller. The home page's
      // "recent listings" strip is public-browse, must never surface
      // a draft / paused / removed listing.
      .where(eq(products.status, "active"))
      .orderBy(desc(products.createdAt))
      .limit(safeLimit(limit, 50));
    return rows.map((r) => r.id);
  }

  // Indexed lookup of one category's product ids, newest first. Mirrors
  // idsBySeller(): when the storefront filters on a single category slug
  // with no text query, skip the catalog-wide loadAll() + JS-sort and let
  // Postgres do it via the GIN index on products.category_ids (migration
  // 0010, jsonb_path_ops).
  //
  // pg_stat_user_indexes 2026-05-12 showed products_category_ids_gin sitting
  // at 0 scans — the index is ready, but the route layer has no SQL path
  // that uses it. This function is that SQL path. Categories are stored
  // as a jsonb array of slugs (e.g. ["telephones"]); containment via @>
  // is the GIN's sweet spot.
  async function idsByCategory(slug: string, limit = 200): Promise<string[]> {
    if (!slug || typeof slug !== "string") return [];
    if (slug.length > 120) return [];
    const rows = await db
      .select({ id: products.id })
      .from(products)
      // Active-only — same rationale as idsBySeller / recentIds.
      .where(
        and(
          sql`${products.categoryIds} @> ${JSON.stringify([slug])}::jsonb`,
          eq(products.status, "active"),
        ),
      )
      .orderBy(desc(products.createdAt))
      .limit(safeLimit(limit, 200));
    return rows.map((r) => r.id);
  }

  return {
    loadAll,
    loadSellers,
    loadOne,
    loadOneActive,
    searchIds,
    idsBySeller,
    idsByCategory,
    recentIds,

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
      sellerId: string | null;
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
        // Same write-time sanitisation as the `update` path (pass #80).
        // The `*Sanitized` columns are what every downstream LLM-rendering
        // reader (browse / search / catalog.get_product) consumes —
        // depositing raw seller text into them was a prompt-injection
        // bypass that survived every read-side defense. titleRaw and
        // descriptionRaw stay raw for audit-trail honesty.
        const origin = safeOrigin("seller", input.sellerId);
        const titleSanitized = sanitizeUntrustedString(input.title, {
          maxLength: FIELD_LIMITS.productTitle,
          origin,
        });
        const descriptionSanitized = input.description
          ? sanitizeUntrustedString(input.description, {
              maxLength: FIELD_LIMITS.productDescription,
              origin,
            })
          : null;
        const cleanBrand = input.brand
          ? sanitizeUntrustedString(input.brand, {
              maxLength: FIELD_LIMITS.productBrand,
              origin,
            })
          : null;
        // Clean both keys and values for attributes — the keys flow into
        // the response as JSON property names and are LLM-readable too
        // (per pass #36's attribute-key injection vector closure).
        // Drop prototype-pollution-prone keys (`__proto__`, `prototype`,
        // `constructor`) up front — `JSON.parse('{"__proto__": …}')`
        // creates a real own property that downstream `o[key]` lookups
        // surface as the actual __proto__. Same defense as the catalog
        // sanitiser (pass #162). Use a null-prototype map for the output.
        const cleanAttrs: Record<string, string> = Object.create(null) as Record<string, string>;
        if (input.attributes) {
          for (const [k, v] of Object.entries(input.attributes)) {
            if (k === "__proto__" || k === "prototype" || k === "constructor") continue;
            const ck = sanitizeUntrustedString(k, {
              maxLength: FIELD_LIMITS.productAttribute,
              origin,
            });
            const cv = sanitizeUntrustedString(v, {
              maxLength: FIELD_LIMITS.productAttribute,
              origin,
            });
            if (ck.length > 0) cleanAttrs[ck] = cv;
          }
        }
        const [pRow] = await tx
          .insert(products)
          .values({
            id: productId,
            sellerId: input.sellerId,
            sku: productSku,
            titleRaw: input.title,
            titleSanitized,
            descriptionRaw: input.description ?? null,
            descriptionSanitized,
            brand: cleanBrand,
            attributes: { ...cleanAttrs },
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
                sellerId: input.sellerId ?? null,
                productId,
                url: m.url,
                contentType: m.contentType,
                byteSize: m.byteSize ?? 0,
                width: m.width ?? null,
                height: m.height ?? null,
                // Sanitise seller-supplied alt text at the write boundary.
                // Alt text lands on every product card's `<img alt>` (read
                // by screen readers and indexed by LLM-rendered product
                // summaries) — without sanitisation a seller could embed
                // `<system>ignore previous instructions</system>` and have
                // it surface in any downstream LLM consumer reading the
                // catalog. Same defense applied to title/description/
                // attributes earlier in this function and to displayName
                // in the seller repo (pass #106).
                altText: m.altText
                  ? sanitizeUntrustedString(m.altText, {
                      maxLength: 500,
                      origin: safeOrigin("seller", input.sellerId ?? "platform"),
                    })
                  : null,
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
        // PATCH path was bypassing the catalog sanitiser entirely: titleRaw
        // and titleSanitized both got the raw input, and brand / description
        // / attributes flowed verbatim into the row. A seller updating
        // their listing with `<system>ignore previous</system>` would land
        // injection bytes in `titleSanitized`, which is what every
        // downstream LLM-rendering surface reads. Same defense the
        // projection-side strip in pass #53 applied to brand, but at the
        // WRITE side so the stored row is clean for every reader.
        //
        // titleRaw keeps the seller's original wording (audit-trail
        // honesty); titleSanitized gets the injection-pattern strip.
        const u: Partial<typeof products.$inferInsert> = { updatedAt: new Date() };
        const origin = safeOrigin("seller", exists[0].sellerId);
        if (patch.title !== undefined) {
          u.titleRaw = patch.title;
          u.titleSanitized = sanitizeUntrustedString(patch.title, {
            maxLength: FIELD_LIMITS.productTitle,
            origin,
          });
        }
        if (patch.description !== undefined) {
          u.descriptionRaw = patch.description ?? null;
          u.descriptionSanitized = patch.description
            ? sanitizeUntrustedString(patch.description, {
                maxLength: FIELD_LIMITS.productDescription,
                origin,
              })
            : null;
        }
        if (patch.brand !== undefined) {
          u.brand = patch.brand
            ? sanitizeUntrustedString(patch.brand, {
                maxLength: FIELD_LIMITS.productBrand,
                origin,
              })
            : null;
        }
        if (patch.categoryIds !== undefined) u.categoryIds = patch.categoryIds.length > 0 ? patch.categoryIds : null;
        if (patch.shipsTo !== undefined) u.shipsTo = patch.shipsTo.length > 0 ? patch.shipsTo : null;
        if (patch.attributes !== undefined) {
          // Strip injection patterns from BOTH attribute keys (per pass #36
          // — keys flow into the catalog response as JSON property names,
          // visible to any LLM reading the product) AND values. Skip
          // prototype-pollution-prone keys and use a null-prototype map,
          // matching the create-side defense (pass #163) and the catalog
          // sanitiser (pass #162).
          const cleaned: Record<string, string> = Object.create(null) as Record<string, string>;
          for (const [k, v] of Object.entries(patch.attributes)) {
            if (k === "__proto__" || k === "prototype" || k === "constructor") continue;
            const cleanKey = sanitizeUntrustedString(k, {
              maxLength: FIELD_LIMITS.productAttribute,
              origin,
            });
            const cleanValue = sanitizeUntrustedString(v, {
              maxLength: FIELD_LIMITS.productAttribute,
              origin,
            });
            if (cleanKey.length > 0) cleaned[cleanKey] = cleanValue;
          }
          u.attributes = { ...cleaned };
        }
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

    // Attach already-uploaded media (POST /v1/media wrote the bytes and
    // produced a content-addressed URL). We record the metadata row and
    // promote it to hero if the product has none yet.
    async addMedia(
      productId: string,
      input: {
        url: string;
        contentType: string;
        byteSize?: number;
        width?: number;
        height?: number;
        altText?: string;
      },
    ): Promise<StoredMedia | "media_cap_exceeded" | undefined> {
      // Wrap the read-product → insert-media → set-hero sequence in a single
      // transaction. Without it:
      //   - Between the read and the insert, a concurrent product DELETE
      //     would let us insert a media row with an FK that just got
      //     orphaned. The DB raises a FK error, but the function's caller
      //     sees a raw error instead of a clean undefined.
      //   - The "set hero if previously null" update was a read-then-update
      //     race: two concurrent addMedia calls both see heroMediaId=null
      //     and both run an unconditional UPDATE, last-write-wins. The
      //     conditional `AND hero_media_id IS NULL` below makes the update
      //     atomic — only the first concurrent caller's SET sticks; the
      //     second is a no-op.
      return db.transaction(async (tx) => {
        const prod = await tx.select().from(products).where(eq(products.id, productId)).limit(1);
        if (!prod[0]) return undefined;
        // Enforce the 20-image cap inside the transaction. Pre-fix the
        // route handler checked `existing.media.length >= 20` outside the
        // tx and called addMedia; two concurrent POSTs could each see 19,
        // both pass the route gate, and both insert — leaving the product
        // with 21 images and the cap silently defeated. Same race-
        // closure pattern as `removeMedia`'s last-image guard (pass #156).
        const before = await tx
          .select({ n: count() })
          .from(media)
          .where(eq(media.productId, productId));
        if (Number(before[0]?.n ?? 0) >= 20) return "media_cap_exceeded";
        const id = uuidv7();
        const [row] = await tx
          .insert(media)
          .values({
            id,
            sellerId: prod[0].sellerId,
            productId,
            url: input.url,
            contentType: input.contentType,
            byteSize: input.byteSize ?? 0,
            width: input.width ?? null,
            height: input.height ?? null,
            // Mirror the create-time scrub above — addMedia is the other
            // entry point for seller-supplied alt text.
            altText: input.altText
              ? sanitizeUntrustedString(input.altText, {
                  maxLength: 500,
                  origin: safeOrigin("seller", prod[0].sellerId ?? "platform"),
                })
              : null,
          })
          .returning();
        // Atomic "only set if currently NULL" — survives the concurrent-
        // addMedia race without needing SELECT … FOR UPDATE.
        await tx
          .update(products)
          .set({ heroMediaId: id })
          .where(and(eq(products.id, productId), isNull(products.heroMediaId)));
        return row ? shapeMedia(row) : undefined;
      });
    },

    async removeMedia(
      productId: string,
      mediaId: string,
    ): Promise<"removed" | "not_found" | "last_image"> {
      // Same transactional wrap as addMedia: the four-step sequence
      // (select-media / delete / select-product / set-hero-to-remaining)
      // was previously non-atomic and could leave a product pointing at
      // a hero_media_id whose underlying row was deleted between steps,
      // or could overwrite a fresh hero assigned by a concurrent caller.
      //
      // Move the "refuse to delete the last image" invariant check INSIDE
      // the transaction. Pre-fix the route handler counted media outside
      // the tx and called removeMedia — two concurrent DELETE requests on
      // distinct mediaIds could each see count=2, both pass the > 1 check,
      // both commit, and leave the product with 0 media. The catalog
      // filter then hides the product from every browse surface
      // (media.length >= 1 invariant), but the seller's dashboard shows
      // it as still active — confusing operator state. Atomicity here
      // closes the race.
      return db.transaction(async (tx) => {
        const m = await tx.select().from(media).where(eq(media.id, mediaId)).limit(1);
        if (!m[0] || m[0].productId !== productId) return "not_found";
        const before = await tx
          .select({ n: count() })
          .from(media)
          .where(eq(media.productId, productId));
        if (Number(before[0]?.n ?? 0) <= 1) return "last_image";
        await tx.delete(media).where(eq(media.id, mediaId));
        const prod = await tx.select().from(products).where(eq(products.id, productId)).limit(1);
        if (prod[0]?.heroMediaId === mediaId) {
          const remaining = await tx
            .select()
            .from(media)
            .where(eq(media.productId, productId))
            .limit(1);
          await tx
            .update(products)
            .set({ heroMediaId: remaining[0]?.id ?? null })
            .where(eq(products.id, productId));
        }
        return "removed";
      });
    },

    async getProductsByIds(ids: string[]): Promise<Array<StoredProduct | null>> {
      if (ids.length === 0) return [];
      const validIds = ids.filter(isUuid);
      // Filter to status='active' — same takedown-respect as loadOneActive
      // (pass #134) and loadAll. Every caller of getProductsByIds is on a
      // public-read path (the /v1/products/_batch endpoint plus the fast-
      // path browse code in routes/products.ts at lines 1193/1227/1261/1297).
      // Without this filter, a removed/paused/draft listing remained
      // fetchable in bulk — defeating the takedown the loadAll filter
      // already enforces on the broad-browse path.
      const prows = validIds.length > 0
        ? await db
            .select()
            .from(products)
            .where(and(inArray(products.id, validIds), eq(products.status, "active")))
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
    async resolveVariant(variantId: string): Promise<{ productId: string; sellerId: string | null; priceMinor: bigint; currency: string } | undefined> {
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
