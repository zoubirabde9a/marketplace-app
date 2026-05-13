// Sort key extraction + comparator for catalog browsing.
//
// Every sort produces a deterministic order by tie-breaking on productId asc,
// which is required for the stable cursor in cursor.ts to work.

import type { catalog } from "@marketplace/domain";
import type { StoredProduct } from "../types/store-types.js";
import { displayVariant, type FilterContext } from "./filter.js";
import { fuzzyMatch } from "./fuzzy.js";

export type Sort = NonNullable<catalog.SearchQuery["sort"]>;
export type SortKey = { v: bigint; isBig: true } | { v: number; isBig: false };

function relevanceScore(p: StoredProduct, ctx: FilterContext): number {
  if (ctx.q.length === 0) return 0;
  let s: number;
  if (ctx.textScores) {
    s = ctx.textScores.get(p.productId) ?? 0;
  } else {
    const t = p.titleSanitized.toLowerCase();
    const b = (p.brand ?? "").toLowerCase();
    // Substring matches outweigh fuzzy matches; title outweighs brand.
    s = 0;
    if (t.includes(ctx.q)) s += 4;
    if (b.includes(ctx.q)) s += 2;
    if (s === 0 && ctx.fuzzy) {
      s += fuzzyMatch(ctx.q, p.titleSanitized) * 2;
      s += fuzzyMatch(ctx.q, p.brand ?? "");
    }
  }
  // Image-presence tie-breaker. 3.8% of the catalog (~2,945 products today —
  // anomalies report [22]) has no media; left alone they sometimes outrank
  // imaged listings by tiny FTS deltas (live probe 2026-05-12: q=samsung put
  // a 0-image "Samsung Samsung a31" at rank 1 with score 6.236 ahead of an
  // image-bearing listing at 6.211). The 0.5 nudge breaks those near-ties
  // without changing macro ranking — a real text-match difference of even
  // 0.6 still wins, and any score-0 listing stays at 0.
  if (s > 0 && p.media.length > 0) s += 0.5;
  return s;
}

// Per-currency junk-price floor for sort=price_asc. Scraped listings on
// Ouedkniss often carry a "1 DA" placeholder when the seller wants "contact
// for price" — these flood the top of price_asc and make the cheapest-first
// view unusable (live probe 2026-05-12: top three results for q=samsung were
// all priceMinor=100, i.e. 1.00 DZD). We don't drop them — buyers may still
// want to see them — we just sort them to the bottom by treating below-floor
// prices as the maximum sort key. price_desc is unaffected; junk naturally
// sinks there. Floor is conservative (1,000 DZD ≈ 7 USD; a sub-1000-DZD
// physical good is almost always a placeholder, not a real listing).
const PRICE_FLOOR_MINOR: Record<string, bigint> = {
  DZD: 100_000n, // 1,000 DZD
  EUR: 100n, // 1 EUR
  USD: 100n, // 1 USD
};
const PRICE_ASC_SINK = (1n << 62n); // any below-floor price gets bumped here

export function keyOf(p: StoredProduct, sort: Sort, ctx: FilterContext): SortKey {
  if (sort === "price_asc" || sort === "price_desc") {
    const v = displayVariant(p, ctx);
    const price = v?.priceMinor ?? 0n;
    if (sort === "price_asc" && v) {
      const floor = PRICE_FLOOR_MINOR[v.currency];
      if (floor !== undefined && price < floor) return { v: PRICE_ASC_SINK, isBig: true };
    }
    return { v: price, isBig: true };
  }
  if (sort === "newest") {
    // Prefer the seller's original posting date (sourcePostedAt, ISO 8601)
    // when present — that's what buyers mean by "newest". Ingestion time
    // (createdAt) only reflects when the seed pipeline reached this row,
    // and the scraper walks Ouedkniss pages in arbitrary order across
    // runs, so a freshly-posted listing can land after an old one.
    const posted = p.attributes?.sourcePostedAt;
    if (posted) {
      const t = Date.parse(posted);
      if (Number.isFinite(t)) return { v: t, isBig: false };
    }
    return { v: p.createdAt, isBig: false };
  }
  if (sort === "rating") return { v: p.rating ?? 0, isBig: false };
  return { v: relevanceScore(p, ctx), isBig: false };
}

/** True if `sort` is ascending in its natural direction. Others are descending. */
export const ascending = (sort: Sort): boolean => sort === "price_asc";

function cmpKey(a: SortKey, b: SortKey): number {
  if (a.isBig && b.isBig) return a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
  if (!a.isBig && !b.isBig) return a.v - b.v;
  return 0; // mixed — should never happen within a single sort dimension
}

export function cmpDirection(a: SortKey, b: SortKey, sort: Sort): number {
  const c = cmpKey(a, b);
  return ascending(sort) ? c : -c;
}

/** Final, deterministic comparator: primary sort + productId tie-break. */
export function makeComparator(sort: Sort, ctx: FilterContext): (a: StoredProduct, b: StoredProduct) => number {
  return (a, b) => {
    const c = cmpDirection(keyOf(a, sort, ctx), keyOf(b, sort, ctx), sort);
    if (c !== 0) return c;
    return a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0;
  };
}

/** Parse the `k` field from a cursor back into a SortKey for the active sort. */
export function parseCursorKey(rawK: string, sort: Sort): SortKey {
  if (sort === "price_asc" || sort === "price_desc") {
    return { v: BigInt(rawK), isBig: true };
  }
  return { v: Number(rawK), isBig: false };
}
