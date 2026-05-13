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
      if ((p.attributes[k] ?? "").toLowerCase() !== v.toLowerCase()) return false;
    }
  }
  if (f.minRating !== undefined && (p.rating ?? 0) < f.minRating) return false;
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

/** Cheapest variant in the active currency — used as the listed price. */
export function displayVariant(p: StoredProduct, ctx: FilterContext): StoredVariant | undefined {
  const cands = variantsInCurrency(p, ctx);
  if (cands.length === 0) return p.variants[0];
  return [...cands].sort((a, b) => Number(a.priceMinor - b.priceMinor))[0];
}
