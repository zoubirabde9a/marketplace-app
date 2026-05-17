# Audit: pruned products return 404 to search-engine crawlers — SEO erosion

- **Detected:** 2026-05-17 20:15 local
- **Severity:** medium — directly damages SEO; rate is ~3 404s/min from crawlers right now
- **Source:** caddy access log (5 min sample)

## Evidence

17 of the 56 requests Caddy handled in the last 5 minutes were 404s, **all on `/product/<uuid>` paths**. The clients are exclusively Yandex bot ranges:

```
2  213.180.203.117
2  95.108.213.201
1  87.250.224.225
1  95.108.213.85
1  95.108.213.128
1  95.108.213.229
1  5.255.231.2
1  5.255.231.31
…
```

(`95.108.213.0/24`, `213.180.203.0/24`, `5.255.231.0/24`, `87.250.224.0/24` are all published Yandex crawler ranges.)

Sample paths:

```
/product/019e2020-2289-7e0c-9d1f-015d64277f13
/product/019e18bd-bd80-7afc-ad9e-2f8ac095b500
/product/019e1214-3a92-7589-a798-8e86db4f3673
…  (18 distinct UUIDs, each hit once)
```

Each is a UUIDv7. The encoded timestamps cluster in the recent past — i.e. these were real listings at some point, not bot fishing.

## Hypothesis

The scraper/seeder pipeline holds the catalog at a fixed size by deleting the oldest products each run (CLAUDE.md: "each iteration seeds N fresh listings, then deletes the N oldest"). The current `max_products` in `metrics.jsonl` is **280 000** — much higher than the documented 14 200 — so prune *is* happening but at a higher ceiling. The standing audit `2026-05-17-1942-scraper-invalid-skipped-50.md` already flagged that mismatch.

Mechanism producing the 404s:

1. Product P with UUID U is seeded.
2. The sitemap (regenerated periodically) includes `https://teno-store.com/product/U`.
3. Yandex/Google fetch the sitemap, queue U for crawl.
4. The prune step deletes P before the crawler gets to it.
5. The crawler hits `/product/U`, the API/SSR returns 404.
6. The crawler interprets this as "page disappeared with no redirect" — bad signal.

There is also an internal mirror of this: `2026-05-17-1942-api-products-limit1-bimodal-latency.md` noted many 404s on `/v1/products/<uuid>` coming from the web container, which is the SSR for those same crawl hits.

## Fix steps

### Fix the SEO signal
1. Instead of hard-deleting pruned products, **soft-delete** them: keep the row with a `deleted_at` timestamp.
2. On `/product/<uuid>` for a soft-deleted product, return **HTTP 410 Gone** (not 404). 410 tells crawlers "this is permanent, drop it from the index" — far better than 404 which they re-try.
3. Exclude soft-deleted products from `/v1/products` list responses and from the sitemap rebuild.

### Reduce the volume of disappearances
4. Reconsider the prune strategy. The current "delete oldest" is arbitrary. Better options:
   - Prune by some quality signal (no views in 30 d, scrape source gone, seller deleted).
   - Increase the cap if disk/DB headroom allows (Postgres data is small — `marketplace-postgres` is at 264 MiB resident, plenty of room).
   - Tune the sitemap update cadence so soft-deletes are de-listed within a reasonable window.

### Hygiene
5. Periodically diff sitemap URLs vs `EXISTS(SELECT 1 FROM catalog.products WHERE id=…)` and alert if the orphan rate exceeds a threshold.
6. Submit a 410-status `Removals` request to Bing/Google Search Console for already-indexed-but-now-deleted URLs (operator action via Search Console UI).

## Similar issues to scan for

- The catalog cap appears to have moved from 14 200 (CLAUDE.md) → 280 000 (current `metrics.jsonl`). Confirm which is intentional and update CLAUDE.md.
- Internal SSR currently surfaces the same 404s as 200 with a 404 body (Next.js default for `notFound()`). If 404 vs 410 distinction is implemented at the API layer but not at the SSR layer, crawlers will see 200 with "not found" UI — worst of both worlds. Verify the SSR returns the right HTTP status.
- `/feed.xml` and `/sitemap.xml` regeneration cadence should be tied to the prune cadence — if sitemap rebuilds once an hour and prune deletes 50 per minute, the sitemap is permanently out of date by up to 3 000 URLs.
