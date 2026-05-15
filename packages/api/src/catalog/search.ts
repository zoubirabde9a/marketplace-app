// High-level search orchestrator: filter → sort → page → hit projection +
// drill-aware facets. Pure function over `StoredProduct[]` and the seller
// map, so the in-memory store can call it directly and a future SQL-backed
// store can reuse the projection logic.

import type { catalog } from "@marketplace/domain";
import { sanitizeUntrustedString, FIELD_LIMITS, safeOrigin } from "@marketplace/shared/untrusted";
import type { StoredMedia, StoredProduct, StoredSeller } from "../types/store-types.js";
import { encodeCursor, decodeCursor, type StableCursor } from "./cursor.js";
import { displayVariant, relevanceScoreFor, type FilterContext } from "./filter.js";
import { passes } from "./filter.js";
import { keyOf, makeComparator, parseCursorKey, cmpDirection, type Sort } from "./sort.js";
import { computeFacets, type Facets } from "./facets.js";

export interface SearchHit {
  productId: string;
  titleSanitized: string;
  brand?: string;
  priceMinor?: bigint;
  currency?: string;
  rating?: number;
  ratingCount?: number;
  inStock: boolean;
  /** null for unowned reference listings — not purchasable. */
  sellerId: string | null;
  sellerDisplayName?: string;
  counterfeitRisk: catalog.CounterfeitRiskT;
  relevanceScore: number;
  heroImage?: StoredMedia;
  imageCount: number;
  priceFromMinor?: bigint;
  priceToMinor?: bigint;
  variantCount: number;
  categoryIds?: string[];
  postedAt?: string; // ISO 8601 — from attributes.sourcePostedAt, else product createdAt
  // Distinct from postedAt: this is when WE last ingested/refreshed the
  // product, regardless of the seller's original post date on the source
  // marketplace. The web sitemap consumes this as the `<lastmod>` value so
  // Google's freshness algorithms see a recent timestamp for URLs we just
  // surfaced, instead of a 2017/2020 Ouedkniss post date that makes the
  // page look abandoned. UI rendering keeps using `postedAt` for the
  // "Posté il y a N jours" relative-time line (the seller's perspective is
  // what's meaningful to a human buyer).
  updatedAt?: string; // ISO 8601 — product.createdAt (ingestion time)
}

export interface SearchResult {
  hits: SearchHit[];
  totalEstimate: number;
  cursor?: string;
  facets: Facets;
}

function heroOf(p: StoredProduct): StoredMedia | undefined {
  return p.heroMediaId ? p.media.find((m) => m.id === p.heroMediaId) : p.media[0];
}

function projectHit(p: StoredProduct, ctx: FilterContext, sellers: Map<string, StoredSeller>): SearchHit {
  const dv = displayVariant(p, ctx);
  const sellerName = p.sellerId ? sellers.get(p.sellerId)?.displayName : undefined;
  const sameCurrency = dv ? p.variants.filter((v) => v.currency === dv.currency) : [];
  const prices = sameCurrency.map((v) => v.priceMinor);
  const priceFrom = prices.length > 0 ? prices.reduce((a, b) => (a < b ? a : b)) : undefined;
  const priceTo = prices.length > 0 ? prices.reduce((a, b) => (a > b ? a : b)) : undefined;
  const hero = heroOf(p);
  const variantsForStock = ctx.filters.currency
    ? p.variants.filter((v) => v.currency === ctx.filters.currency)
    : p.variants;
  // `brand` is seller-controlled and the catalog write-time sanitiser doesn't
  // touch it — strip injection patterns at projection time so browse cards,
  // search results, and any downstream LLM rendering surface get a clean
  // string without changing the wire format (brand stays a plain string).
  const cleanBrand =
    p.brand !== undefined && p.brand !== null
      ? sanitizeUntrustedString(p.brand, {
          maxLength: FIELD_LIMITS.productBrand,
          origin: safeOrigin("seller", p.sellerId),
        })
      : undefined;
  return {
    productId: p.productId,
    titleSanitized: p.titleSanitized,
    ...(cleanBrand !== undefined ? { brand: cleanBrand } : {}),
    ...(dv !== undefined ? { priceMinor: dv.priceMinor, currency: dv.currency } : {}),
    ...(priceFrom !== undefined ? { priceFromMinor: priceFrom } : {}),
    ...(priceTo !== undefined ? { priceToMinor: priceTo } : {}),
    variantCount: p.variants.length,
    // Only project finite ratings. Pre-fix `p.rating !== undefined` admitted
    // NaN (which is `!== undefined`), and `JSON.stringify(NaN) === "null"`
    // — so the wire format said `"rating": null` for products whose stored
    // rating was corrupted, indistinguishable from "no rating". Drop the
    // field entirely so the client sees a clean "no rating" instead of
    // a misleading null.
    ...(typeof p.rating === "number" && Number.isFinite(p.rating) ? { rating: p.rating } : {}),
    ...(typeof p.ratingCount === "number" && Number.isFinite(p.ratingCount) ? { ratingCount: p.ratingCount } : {}),
    inStock: variantsForStock.some((v) => v.inStock),
    sellerId: p.sellerId,
    ...(sellerName !== undefined ? { sellerDisplayName: sellerName } : {}),
    counterfeitRisk: p.counterfeitRisk,
    relevanceScore: relevanceScoreFor(p, ctx),
    ...(hero ? { heroImage: hero } : {}),
    imageCount: p.media.length,
    ...(p.categoryIds && p.categoryIds.length > 0 ? { categoryIds: [...p.categoryIds] } : {}),
    postedAt: p.attributes?.sourcePostedAt ?? new Date(p.createdAt).toISOString(),
    // Always our ingestion time — sitemap lastmod consumes this so URLs
    // freshly added to the catalog don't carry a years-old Ouedkniss
    // `sourcePostedAt` as their freshness signal to Google.
    updatedAt: new Date(p.createdAt).toISOString(),
  };
}

export function searchProducts(
  all: StoredProduct[],
  sellers: Map<string, StoredSeller>,
  query: catalog.SearchQuery & { fuzzy?: boolean },
  textScores?: ReadonlyMap<string, number>,
): SearchResult {
  const ctx: FilterContext = {
    q: query.query.trim().toLowerCase(),
    filters: query.filters ?? { includeOutOfStock: false },
    fuzzy: query.fuzzy === true,
    ...(textScores ? { textScores } : {}),
  };
  const matched = all.filter((p) => passes(p, ctx));
  const sort: Sort = query.sort ?? "relevance";
  const sorted = matched.slice().sort(makeComparator(sort, ctx));

  // Stable cursor resolution.
  const cursor = decodeCursor(query.cursor);
  let startIndex = 0;
  if (cursor) {
    const exact = sorted.findIndex((p) => p.productId === cursor.id);
    if (exact >= 0) {
      startIndex = exact + 1;
    } else {
      const cursorKey = parseCursorKey(cursor.k, sort);
      // A malformed cursor key (corrupted client state / tampering / wrong
      // sort) means we can't position by sort-key fallback. Returning empty
      // is preferable to throwing — the client will see "no more results"
      // and start a fresh first page rather than a 500.
      if (cursorKey === undefined) {
        startIndex = sorted.length;
      } else {
        startIndex = sorted.findIndex((p) => {
          const c = cmpDirection(keyOf(p, sort, ctx), cursorKey, sort);
          if (c !== 0) return c > 0;
          return p.productId > cursor.id;
        });
        if (startIndex < 0) startIndex = sorted.length;
      }
    }
  }

  const limit = query.limit ?? 25;
  const page = sorted.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + page.length < sorted.length;
  const lastOnPage = page[page.length - 1];
  const nextCursor: StableCursor | undefined = hasMore && lastOnPage
    ? { k: keyOf(lastOnPage, sort, ctx).v.toString(), id: lastOnPage.productId }
    : undefined;

  const facets = computeFacets(all, ctx, sellers);

  return {
    hits: page.map((p) => projectHit(p, ctx, sellers)),
    totalEstimate: sorted.length,
    ...(nextCursor ? { cursor: encodeCursor(nextCursor) } : {}),
    facets,
  };
}
