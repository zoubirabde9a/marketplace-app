# Audit: `/sitemap.xml` cold-builds in ~120 s, 17.7 MB, 50 108 URLs (over the 50 000 spec limit)

- **Detected:** 2026-05-17 20:05 local
- **Severity:** high — affects every search engine's crawl path; cold fetches pin origin for 2 minutes
- **Source:** `curl -w` from off-host (cold) and on-host (warm)

## Evidence

Cold fetch (from a residential connection, Cloudflare cache miss):

```
GET https://teno-store.com/sitemap.xml
→ 200 in 121.49 s
```

Immediate warm fetch from inside the VPS (after Cloudflare cached the cold response):

```
size:  17 750 843 bytes  (≈ 17.7 MB)
time:  0.49 s
ttfb:  0.40 s
url count (grep -c '<url>'): 50 108
```

Companion endpoints fetched in the same batch are all fast and unaffected:

```
robots.txt:    200  88 ms
home:          200 179 ms
api /livez:    200  62 ms
```

## Hypothesis

The route is generating the entire sitemap on demand from the database for every cache miss:
- 50 108 product/category URLs to enumerate.
- 17.7 MB XML to serialize.
- 120 s of origin CPU + DB time on each miss.

Two compounding issues:

1. **Single-file sitemap exceeds the spec.** The sitemaps.org spec caps a single sitemap at **50 000 URLs / 50 MB uncompressed**. At 50 108 URLs the response is technically invalid; some validators will accept it, some won't, and Google in particular will silently truncate.
2. **No origin cache, only Cloudflare cache.** Cloudflare does cache the response (the warm fetch confirms it), but Cloudflare TTL on dynamic-looking paths defaults short, and any cache eviction (purge, edge cold start, different POP) re-pays the 120 s cost. Bing/IndexNow re-submission timer (`marketplace-indexnow-sitemap.timer`, monthly) hits this path too.

## Fix steps

### Required (correctness)
1. Convert `/sitemap.xml` into a sitemap **index** that links to multiple child sitemaps:
   - `/sitemap-products-1.xml`, `/sitemap-products-2.xml`, …, each capped at ~40 000 URLs (a safety margin under the 50 000 limit).
   - `/sitemap-categories.xml`, `/sitemap-static.xml`.
2. Each child sitemap should be incrementally generated on a schedule (see below), not on request.

### Required (performance)
3. Pre-generate the sitemap files to disk on a schedule and have Caddy serve them statically. A 17 MB file at gzip should be < 1.5 MB on the wire; Caddy serves it in milliseconds without touching the app.
   - Add a `marketplace-sitemap-rebuild.timer` that fires every 15–60 min, writes to `/opt/marketplace/data/sitemaps/`, and atomically renames.
   - Caddyfile rule: `handle /sitemap*.xml { root * /srv/sitemaps; file_server }`.
4. Add `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400` on the response so Cloudflare keeps it long and serves stale during regeneration.

### Verification
5. After the change, repeat the cold fetch from outside the network. TTFB should be < 200 ms.

## Similar issues to scan for

- `/feed.xml` was hit by the crawler earlier today (`2026-05-17-1947-aggressive-crawler-…md`) and took 3.69 s. That is the same pattern at smaller scale — DB-derived large XML, no static caching. Apply the same "generate to disk on a timer + serve via Caddy" fix.
- Any other "list-everything" endpoints — `/agents.json`, `/.well-known/*` — should be checked for the same shape. Note `marketplace-refresh-catalog-stats.timer` already does this for `/.well-known/agents.json` hourly; that's the right pattern to copy for sitemaps.
- Once `pg_stat_statements` is enabled (see `2026-05-17-2000-pg-stat-statements-not-loaded.md`), the sitemap query will likely show up as the top `total_exec_time` contributor — that's the right way to confirm this audit's hypothesis.
