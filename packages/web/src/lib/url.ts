import type { SearchInput } from "./api";

// Parse Next.js searchParams (string | string[] | undefined) into a strict SearchInput.
type Raw = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function many(v: string | string[] | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

export function parseSearchParams(sp: Raw): SearchInput {
  const out: SearchInput = {};
  const q = one(sp.q); if (q) out.q = q;
  const category = many(sp.category); if (category) out.category = category;
  const brand = one(sp.brand); if (brand) out.brand = brand;
  const sellerId = many(sp.sellerId); if (sellerId) out.sellerId = sellerId;
  const priceMin = one(sp.priceMin); if (priceMin) out.priceMin = priceMin;
  const priceMax = one(sp.priceMax); if (priceMax) out.priceMax = priceMax;
  const currency = one(sp.currency); if (currency) out.currency = currency;
  const shipsTo = one(sp.shipsTo); if (shipsTo) out.shipsTo = shipsTo;
  const minRating = one(sp.minRating); if (minRating) out.minRating = Number(minRating);
  if (one(sp.includeOutOfStock) === "true") out.includeOutOfStock = true;
  if (one(sp.fuzzy) === "true") out.fuzzy = true;
  const cursor = one(sp.cursor); if (cursor) out.cursor = cursor;
  const limit = one(sp.limit); if (limit) out.limit = Number(limit);
  const sort = one(sp.sort) as SearchInput["sort"]; if (sort) out.sort = sort;
  // Default to "newest" for a free browse (no query, no explicit sort).
  // Relevance only meaningfully ranks against a query; without one, freshness
  // is what buyers actually care about, and it nudges Google's ItemList JSON-LD
  // toward dated, easily-crawlable pages.
  if (!out.sort && !out.q) out.sort = "newest";
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (!k.startsWith("attr.")) continue;
    const val = one(v);
    if (val) attrs[k.slice(5)] = val;
  }
  if (Object.keys(attrs).length) out.attributes = attrs;
  return out;
}

export function withParam(sp: Raw, key: string, value: string | undefined): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === key) continue;
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) p.append(k, item);
    else p.append(k, v);
  }
  if (value !== undefined && value !== "") p.set(key, value);
  return p;
}

export function toggleArrayParam(sp: Raw, key: string, value: string): URLSearchParams {
  const p = new URLSearchParams();
  let removed = false;
  for (const [k, v] of Object.entries(sp)) {
    if (v === undefined) continue;
    if (k === key) {
      const list = Array.isArray(v) ? v : [v];
      for (const item of list) {
        if (item === value) { removed = true; continue; }
        p.append(k, item);
      }
    } else {
      if (Array.isArray(v)) for (const item of v) p.append(k, item);
      else p.append(k, v);
    }
  }
  if (!removed) p.append(key, value);
  return p;
}
