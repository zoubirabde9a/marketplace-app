import { searchProducts, type SearchResponse, type SearchInput } from "./api";

// Module-level cache around searchProducts(). Same pattern as the sitemap
// and CategoryFooter caches: bypasses Next 15's data cache (which we found
// in iter-29 was being defeated by cache:"no-store" and could lock empty
// payloads — see iter-16 + iter-29). Particularly important under crawler
// load because:
//
// - search/page.tsx generateMetadata fires searchProducts({...,limit:1})
//   for every slice render to enrich the count-bearing description.
// - product/[id]/page.tsx fires searchProducts({sellerId:[X],limit:9})
//   for every product render to populate the related-products grid.
//   Smart Phone DZ alone has 4,800+ products, and they all share the same
//   sellerId tuple — without this cache they each fire an identical
//   uncached fetch.
//
// 5-min TTL strikes a balance: enrichment counts are visibly fresh-ish,
// related products only matter for navigation. inFlight dedups concurrent
// callers (Googlebot crawls in parallel) so a thundering herd at TTL
// expiry doesn't fan out to N identical fetches.

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;
const cache = new Map<string, { data: SearchResponse; ts: number }>();
const inFlight = new Map<string, Promise<SearchResponse>>();

function keyFor(input: SearchInput): string {
  // Normalize array order for stable keys.
  const norm = {
    ...input,
    sellerId: input.sellerId ? [...input.sellerId].sort() : undefined,
    category: input.category ? [...input.category].sort() : undefined,
  };
  return JSON.stringify(norm);
}

function prune(now: number): void {
  // Drop stale entries; if still over MAX, drop oldest.
  for (const [k, v] of cache) {
    if (now - v.ts > TTL_MS) cache.delete(k);
  }
  if (cache.size > MAX_ENTRIES) {
    const sorted = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < cache.size - MAX_ENTRIES; i++) cache.delete(sorted[i][0]);
  }
}

export async function searchProductsCached(input: SearchInput): Promise<SearchResponse> {
  const key = keyFor(input);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < TTL_MS) return hit.data;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const data = await searchProducts(input);
      // Refuse to cache obviously-broken responses (empty data AND no count
      // signal) — same iter-16/iter-29 lesson: caching a transient API
      // outage locks the broken payload in for the full TTL.
      const total = data.pagination?.totalEstimate ?? 0;
      if (data.data.length > 0 || total > 0) {
        cache.set(key, { data, ts: Date.now() });
        if (cache.size > MAX_ENTRIES) prune(Date.now());
      }
      return data;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}

export function __resetSearchCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
