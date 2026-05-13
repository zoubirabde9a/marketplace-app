// High-level search orchestrator: filter → sort → page → hit projection +
// drill-aware facets. Pure function over `StoredProduct[]` and the seller
// map, so the in-memory store can call it directly and a future SQL-backed
// store can reuse the projection logic.

import type { catalog } from "@marketplace/domain";
import type { StoredMedia, StoredProduct, StoredSeller } from "../types/store-types.js";
import { encodeCursor, decodeCursor, type StableCursor } from "./cursor.js";
import { displayVariant, type FilterContext } from "./filter.js";
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
  return {
    productId: p.productId,
    titleSanitized: p.titleSanitized,
    ...(p.brand !== undefined ? { brand: p.brand } : {}),
    ...(dv !== undefined ? { priceMinor: dv.priceMinor, currency: dv.currency } : {}),
    ...(priceFrom !== undefined ? { priceFromMinor: priceFrom } : {}),
    ...(priceTo !== undefined ? { priceToMinor: priceTo } : {}),
    variantCount: p.variants.length,
    ...(p.rating !== undefined ? { rating: p.rating } : {}),
    ...(p.ratingCount !== undefined ? { ratingCount: p.ratingCount } : {}),
    inStock: variantsForStock.some((v) => v.inStock),
    sellerId: p.sellerId,
    ...(sellerName !== undefined ? { sellerDisplayName: sellerName } : {}),
    counterfeitRisk: p.counterfeitRisk,
    relevanceScore: ctx.textScores?.get(p.productId) ?? 1,
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
      startIndex = sorted.findIndex((p) => {
        const c = cmpDirection(keyOf(p, sort, ctx), cursorKey, sort);
        if (c !== 0) return c > 0;
        return p.productId > cursor.id;
      });
      if (startIndex < 0) startIndex = sorted.length;
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
