// Drill-aware facet computation. Each dimension is counted against the
// catalog filtered by every *other* active filter, so the response shows the
// alternatives an agent could pivot to without first un-filtering.

import type { StoredProduct, StoredSeller } from "../types/store-types.js";
import { passes, type FilterContext } from "./filter.js";

const FACET_CAP = 50;

export interface Facets {
  brands: Array<{ value: string; count: number }>;
  currencies: Array<{ value: string; count: number }>;
  sellers: Array<{ sellerId: string; displayName?: string; count: number }>;
  categories: Array<{ value: string; count: number }>;
  priceRanges: Array<{ currency: string; minMinor: bigint; maxMinor: bigint }>;
}

function topN<K>(m: Map<K, number>): Array<[K, number]> {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, FACET_CAP);
}

export function computeFacets(
  all: StoredProduct[],
  ctx: FilterContext,
  sellers: Map<string, StoredSeller>,
): Facets {
  // Brand counts are keyed by case-folded brand string because the filter
  // path matches case-insensitively (`(p.brand ?? "").toLowerCase() !==
  // f.brand.toLowerCase()`). Keying facets by the raw string previously
  // produced "Samsung" / "samsung" / "SAMSUNG" as three separate facet
  // values whose counts each undercounted what the filter actually returns
  // when the agent clicks the facet. Keep a display form alongside (the
  // first capitalisation seen) so the rendered chip still looks human.
  const brandCounts = new Map<string, { count: number; display: string }>();
  const currencyCounts = new Map<string, number>();
  const sellerCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const priceByCurrency = new Map<string, { min: bigint; max: bigint }>();

  for (const p of all) {
    if (p.brand && passes(p, ctx, "brand")) {
      const key = p.brand.toLowerCase();
      const existing = brandCounts.get(key);
      if (existing) existing.count += 1;
      else brandCounts.set(key, { count: 1, display: p.brand });
    }
    if (p.sellerId && passes(p, ctx, "seller")) {
      sellerCounts.set(p.sellerId, (sellerCounts.get(p.sellerId) ?? 0) + 1);
    }
    if (passes(p, ctx, "currency")) {
      const counted = new Set<string>();
      for (const v of p.variants) {
        if (counted.has(v.currency)) continue;
        counted.add(v.currency);
        currencyCounts.set(v.currency, (currencyCounts.get(v.currency) ?? 0) + 1);
      }
    }
    if (passes(p, ctx, "category")) {
      for (const c of p.categoryIds ?? []) {
        categoryCounts.set(c, (categoryCounts.get(c) ?? 0) + 1);
      }
    }
    if (passes(p, ctx, "price")) {
      // Limit price-range facet to variants in the active currency (if any),
      // so the displayed range matches what the agent sees priced.
      const variants = ctx.filters.currency
        ? p.variants.filter((v) => v.currency === ctx.filters.currency)
        : p.variants;
      for (const v of variants) {
        // Exclude zero-priced variants from the range. The scraper occasionally
        // seeds 0-priced placeholders (Ouedkniss listings without a price
        // field); previously the slider's min anchored to 0, telling the
        // buyer "products start at $0" — same trust-trap as the
        // displayVariant fix in the buyer-honest price selection.
        if (v.priceMinor === 0n) continue;
        const rng = priceByCurrency.get(v.currency);
        if (!rng) priceByCurrency.set(v.currency, { min: v.priceMinor, max: v.priceMinor });
        else {
          if (v.priceMinor < rng.min) rng.min = v.priceMinor;
          if (v.priceMinor > rng.max) rng.max = v.priceMinor;
        }
      }
    }
  }

  return {
    brands: [...brandCounts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, FACET_CAP)
      .map(([, v]) => ({ value: v.display, count: v.count })),
    currencies: topN(currencyCounts).map(([value, count]) => ({ value, count })),
    sellers: topN(sellerCounts).map(([sellerId, count]) => {
      const dn = sellers.get(sellerId)?.displayName;
      return dn !== undefined ? { sellerId, displayName: dn, count } : { sellerId, count };
    }),
    categories: topN(categoryCounts).map(([value, count]) => ({ value, count })),
    priceRanges: [...priceByCurrency.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([currency, rng]) => ({ currency, minMinor: rng.min, maxMinor: rng.max })),
  };
}
