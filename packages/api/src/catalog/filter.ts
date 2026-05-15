// Per-product filter predicate. Designed to support drill-aware facets: the
// `skip` argument lets the caller temporarily ignore a single dimension when
// computing a facet for that dimension, so the response shows alternatives
// the agent could pivot to without first un-filtering.

import type { catalog } from "@marketplace/domain";
import type { StoredProduct, StoredVariant } from "../types/store-types.js";
import { fuzzyMatch } from "./fuzzy.js";

export type FacetDim = "brand" | "currency" | "seller" | "price" | "category";

export interface FilterContext {
  /** Lower-cased free-text query. Empty string means "browse all". */
  q: string;
  filters: NonNullable<catalog.SearchQuery["filters"]>;
  /** Opt-in token-fuzzy matching when q is non-empty. */
  fuzzy: boolean;
  /**
   * When set, text matching and relevance scoring are delegated to Postgres
   * (FTS + pg_trgm via repo.searchIds). The presence of a productId in this
   * map means the row matched the query in SQL; the value is its rank score.
   * The JS substring/Levenshtein paths are bypassed.
   */
  textScores?: ReadonlyMap<string, number>;
}

function textBlob(p: StoredProduct): string {
  const attrs = Object.entries(p.attributes).map(([k, v]) => `${k}=${v}`).join(" ");
  return [p.titleSanitized, p.brand ?? "", p.descriptionSanitized ?? "", attrs].join(" ");
}

/** Whether the free-text query matches this product, given fuzzy on/off. */
export function matchesText(p: StoredProduct, ctx: FilterContext): boolean {
  if (ctx.q.length === 0) return true;
  if (ctx.textScores) return ctx.textScores.has(p.productId);
  const blob = textBlob(p);
  if (blob.toLowerCase().includes(ctx.q)) return true;
  if (!ctx.fuzzy) return false;
  return fuzzyMatch(ctx.q, blob) > 0;
}

/**
 * In-process relevance score used when the Postgres FTS path didn't run.
 * Returns 1 when there's no query (every product equally relevant) so the
 * "relevance" sort degenerates to whatever the sort comparator falls back
 * on, and a real signal otherwise:
 *   - title substring hit ⇒ high (3)
 *   - any text substring hit ⇒ medium (2)
 *   - fuzzy multi-token match ⇒ 1 + token-count
 * Previously projectHit hard-coded `relevanceScore: 1` for every result
 * whenever textScores was absent — the sort was effectively a no-op and
 * agents reading the field for ranking saw a useless flat value.
 */
export function relevanceScoreFor(p: StoredProduct, ctx: FilterContext): number {
  if (ctx.q.length === 0) return 1;
  if (ctx.textScores) return ctx.textScores.get(p.productId) ?? 1;
  if (p.titleSanitized.toLowerCase().includes(ctx.q)) return 3;
  const blob = textBlob(p);
  if (blob.toLowerCase().includes(ctx.q)) return 2;
  if (!ctx.fuzzy) return 1;
  const tokens = fuzzyMatch(ctx.q, blob);
  return tokens > 0 ? 1 + tokens : 1;
}

/** Subset of variants in the active currency (or all if no currency filter). */
function variantsInCurrency(p: StoredProduct, ctx: FilterContext, skip?: FacetDim): StoredVariant[] {
  const currencyActive = skip !== "currency" && ctx.filters.currency !== undefined;
  return currencyActive ? p.variants.filter((v) => v.currency === ctx.filters.currency) : p.variants;
}

/**
 * Whether `p` passes every active filter, except the one named in `skip`.
 * Pass `skip="brand"` when computing the brand facet so the brand filter is
 * lifted just for that calculation.
 */
export function passes(p: StoredProduct, ctx: FilterContext, skip?: FacetDim): boolean {
  // Hide listings with no media on browse surfaces. A card with no hero
  // image renders as an empty placeholder on home/search/category — a
  // visible quality hit. The product is still retrievable by direct
  // GET /v1/products/:id, and seller-scoped queries (dashboard, store page)
  // bypass this rule below so the seller can see and fix their own listings
  // that slipped in without media. ~3.8% of catalog as of 2026-05-10.
  // 2026-05-13: scope tightened to browse-only — was applying everywhere,
  // including the seller's own /seller/dashboard which made freshly-created
  // (UI-side) media-less listings vanish without a trace.
  const sellerScoped = ctx.filters.sellerIds !== undefined && ctx.filters.sellerIds.length > 0;
  if (!sellerScoped && p.media.length === 0) return false;
  if (!matchesText(p, ctx)) return false;
  const f = ctx.filters;
  if (skip !== "brand" && f.brand && (p.brand ?? "").toLowerCase() !== f.brand.toLowerCase()) return false;
  if (skip !== "seller" && f.sellerIds && f.sellerIds.length > 0 && (p.sellerId === null || !f.sellerIds.includes(p.sellerId))) return false;
  if (skip !== "category" && f.categoryIds && f.categoryIds.length > 0) {
    const has = (p.categoryIds ?? []).some((c) => f.categoryIds!.includes(c));
    if (!has) return false;
  }
  if (f.attributes) {
    for (const [k, v] of Object.entries(f.attributes)) {
      // Belt-and-suspenders: the schema already rejects forbidden filter
      // keys (catalog/types.ts pass #202), but the catalog filter runs
      // against direct domain callers too (search-stats reporting,
      // future internal tools) — skip prototype-pollution-prone keys
      // here as well so a hand-built filter never reaches the lookup.
      if (k === "__proto__" || k === "prototype" || k === "constructor") continue;
      // Use Object.hasOwn so `p.attributes["__proto__"]` doesn't surface
      // a value from Object.prototype if a legacy DB row stored that key
      // as an own property and the projection-side filter missed it.
      const attrVal = Object.hasOwn(p.attributes, k) ? p.attributes[k] : undefined;
      if ((attrVal ?? "").toLowerCase() !== v.toLowerCase()) return false;
    }
  }
  if (f.minRating !== undefined) {
    // `?? 0` does NOT catch NaN — `NaN ?? 0` keeps NaN — so a product
    // with a corrupted rating row evaluates `NaN < minRating` as `false`
    // and silently passes any minRating filter (treated as "rating high
    // enough"). Normalise to 0 via Number.isFinite so a corrupt rating
    // fails the filter the same way an unset one would. Same NaN-bypass
    // family as moderation/counterfeit (passes #130/#131).
    const rating = Number.isFinite(p.rating) ? p.rating! : 0;
    if (rating < f.minRating) return false;
  }
  if (f.shipsTo && !(p.shipsTo ?? []).includes(f.shipsTo)) return false;

  const candidate = variantsInCurrency(p, ctx, skip);
  if (candidate.length === 0) return false;

  const priceActive = skip !== "price";
  const inRange = candidate.filter((v) => {
    if (!priceActive) return true;
    if (f.priceMinMinor !== undefined && v.priceMinor < f.priceMinMinor) return false;
    if (f.priceMaxMinor !== undefined && v.priceMinor > f.priceMaxMinor) return false;
    return true;
  });
  if (inRange.length === 0) return false;
  if (!f.includeOutOfStock && !inRange.some((v) => v.inStock)) return false;
  // Hide listings with no real price set (priceMinor=0 across every viable
  // variant). The scraper occasionally yields these when Ouedkniss publishes
  // an announcement without a price field; surfacing them as "inStock" with
  // a 0 DZD tag is a UX trap — a buyer taps thinking it's free.
  if (inRange.every((v) => v.priceMinor === 0n)) return false;
  return true;
}

/** Cheapest variant in the active currency — used as the listed price.
 *
 * Tiebreaker: prefer in-stock variants over OOS, and non-zero prices over 0.
 * The previous "cheapest wins" rule meant a product with a $0 placeholder
 * variant (scraper artifact) or an OOS-cheapest variant would advertise the
 * misleading price on browse — buyer taps "From $0" or "From $10 (in stock)"
 * and finds the actual variant they can buy is $30. The list page must
 * advertise a price the buyer can actually pay.
 *
 * Sort precedence:
 *   1. In-stock variants before out-of-stock.
 *   2. Non-zero prices before zero prices.
 *   3. Lowest price first.
 */
export function displayVariant(p: StoredProduct, ctx: FilterContext): StoredVariant | undefined {
  const cands = variantsInCurrency(p, ctx);
  if (cands.length === 0) return p.variants[0];
  return [...cands].sort((a, b) => {
    if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
    const aZero = a.priceMinor === 0n;
    const bZero = b.priceMinor === 0n;
    if (aZero !== bZero) return aZero ? 1 : -1;
    // bigint-safe compare — `Number(a.priceMinor - b.priceMinor)` would lose
    // precision past 2^53 (rare at retail, possible for stablecoin pairs).
    if (a.priceMinor < b.priceMinor) return -1;
    if (a.priceMinor > b.priceMinor) return 1;
    return 0;
  })[0];
}
