# Audit: Redis cache hit rate is 7.4 % — cache is mostly decorative

- **Detected:** 2026-05-17 19:51 local
- **Severity:** medium — wasted memory + missed perf wins; explains some of the SSR/API slowness seen earlier today
- **Source:** `redis-cli INFO memory|stats` on vps-eu

## Evidence

```
keyspace_hits:    9 444
keyspace_misses:  117 605     → hit rate 7.4 %
expired_keys:     396 279
evicted_keys:     0
dbsize:           28 246
used_memory:      928 MiB     (rss 1.18 GiB, peak 1.61 GiB)
maxmemory:        2 GiB
maxmemory_policy: allkeys-lru
mem_fragmentation_ratio: 1.31
```

A healthy production cache typically sits at 70–95 % hit rate. At 7.4 %, the app is paying Redis network + serialization cost on almost every lookup and still falling back to Postgres / sharp / Next.js render anyway. 396 k expired keys against 9 k hits means TTLs are short relative to access frequency — items expire before they get re-read.

## Hypothesis

Several plausible causes, listed in order of likelihood:

1. **TTLs are tuned for write-heavy paths but most reads are unique.** The seeder writes a cache entry per product (the scraper inserts ~50 listings every minute), and those entries expire before any human visits them. With 14 200 products live but key churn from continuous re-seeding, the working set never converges.
2. **Cache-key fragmentation.** Each `/v1/products?…` listing query has dozens of filter combinations; if the cache key is the full querystring, every variant is its own miss-on-first-hit.
3. **Cache is bypassed in code paths that should use it.** Earlier audit `2026-05-17-1942-api-products-limit1-bimodal-latency.md` shows internal healthcheck `/v1/products?limit=1` taking 450 ms cold — that route isn't reading from Redis at all, or is using a per-process in-memory cache instead.

## Fix steps

1. Add a metric/log for hit-vs-miss-by-key-prefix so we can see which prefixes are the misses. A 5-minute sample is enough.
2. Once the dominant miss prefix is known:
   - If it's per-product detail keys: lengthen TTL well past the seed cadence (e.g. 1 h), and explicitly invalidate on update/delete rather than relying on expiry.
   - If it's per-listing-querystring keys: normalize the cache key (sort filter params, drop pagination cursors from the key, cache the underlying aggregate not the response).
3. Backfill cache for the obvious hot reads (homepage / `/c/<category>?limit=12&sort=newest`, top product detail pages) on container start.
4. While the fragmentation ratio is fine (1.31), `used_memory_peak` at 1.61 GiB out of a 2 GiB cap means the LRU is close to evicting. If we raise TTLs, raise `maxmemory` proportionally or rely on `allkeys-lru` to do its job (it already would — `evicted_keys` is 0 today, which means we are not memory-pressured, only freshness-pressured).

## Similar issues to scan for

- The `/_next/image` saturation audit (`2026-05-17-1947-next-image-optimizer-saturation.md`) is in the same family: too much origin work because the appropriate cache layer isn't doing its job. Treat the two together — Cloudflare for `/_next/image`, Redis for API responses, both currently under-leveraged.
- This contradicts a worry in `2026-05-17-1942-no-swap-commit-near-limit.md` ("Redis will grow unbounded"). Redis is actually bounded: `maxmemory=2G` + `allkeys-lru`. That paragraph in the swap audit can be deprioritized.
