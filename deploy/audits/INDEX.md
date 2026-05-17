# Audit findings — 2026-05-17 evening sweep

Audits produced by a recurring 5-minute audit loop run against `vps-eu` on 2026-05-17 19:42–20:19 local. Each file lists detection time, evidence, hypothesis, and concrete fix steps.

Severities are the author's read; the operator should re-rank against business priorities.

## High

| Date | Title | One-line | File |
|---|---|---|---|
| 19:56 | No Postgres backups | No `pg_dump`, no snapshot, 9 days of catalog data on one disk. | [2026-05-17-1956-no-database-backups.md](./2026-05-17-1956-no-database-backups.md) |
| 20:05 | `/sitemap.xml` cold-builds in 121 s | 17.7 MB / 50 108 URLs in one file, exceeds 50 k spec limit. | [2026-05-17-2005-sitemap-cold-120s-exceeds-spec.md](./2026-05-17-2005-sitemap-cold-120s-exceeds-spec.md) |
| 19:47 | `/_next/image` saturation | 90 % of traffic, single Node core at 149 % CPU; confirmed 504 to a Facebook crawler at 20:19. | [2026-05-17-1947-next-image-optimizer-saturation.md](./2026-05-17-1947-next-image-optimizer-saturation.md) |

## Medium

| Date | Title | One-line | File |
|---|---|---|---|
| 20:10 | Postgres on stock defaults | `shared_buffers=128MB`, `effective_cache_size=4GB` on a 7.7 GiB host. | [2026-05-17-2010-postgres-on-defaults.md](./2026-05-17-2010-postgres-on-defaults.md) |
| 20:15 | Pruned products 404 to crawlers | 17 × 404 in 5 min on `/product/<uuid>`, all from Yandex bot ranges. Soft-delete + HTTP 410. | [2026-05-17-2015-pruned-products-404-for-crawlers.md](./2026-05-17-2015-pruned-products-404-for-crawlers.md) |
| 19:42 | Scraper rejects 100 % of listings for several categories | `invalid_skipped=50` every run for `immobilier`, `automobiles_vehicules`, `electronique_electromenager`. | [2026-05-17-1942-scraper-invalid-skipped-50.md](./2026-05-17-1942-scraper-invalid-skipped-50.md) |
| 19:42 | `/v1/products?limit=1` bimodal latency | 5 ms warm / 450 ms cold from internal probe; facet aggregation runs unconditionally. | [2026-05-17-1942-api-products-limit1-bimodal-latency.md](./2026-05-17-1942-api-products-limit1-bimodal-latency.md) |
| 19:42 | No swap, commit at 87 % of strict limit | Single ~500 MB spike can return ENOMEM with 2.4 GiB physically free. | [2026-05-17-1942-no-swap-commit-near-limit.md](./2026-05-17-1942-no-swap-commit-near-limit.md) |
| 20:10 | API CORS is wildcard | `Access-Control-Allow-Origin: *` with `GET/POST/PUT/PATCH/DELETE` allowed. | [2026-05-17-2010-api-cors-wildcard.md](./2026-05-17-2010-api-cors-wildcard.md) |

## Low

| Date | Title | One-line | File |
|---|---|---|---|
| 19:47 | Aggressive crawler at 136.117.185.78 | Fake Pixel 6 UA, 70 reqs/5 min, every response clustered at 3.7-3.8 s. | [2026-05-17-1947-aggressive-crawler-136-117-185-78.md](./2026-05-17-1947-aggressive-crawler-136-117-185-78.md) |

## Resolved

| Date | Title | Resolution | File |
|---|---|---|---|
| 20:00 | `pg_stat_statements` not loaded | Operator restarted Postgres at 20:32 with `pg_stat_statements,auto_explain` preloaded. Now reporting. | [2026-05-17-2000-pg-stat-statements-not-loaded.md](./2026-05-17-2000-pg-stat-statements-not-loaded.md) |
| 19:51 | `/mcp` publicly reachable | Auth path verified end-to-end (anonymous principal → empty scopes → registry rejects every scoped tool). Rate-limit follow-up still open. | [2026-05-17-1951-mcp-endpoint-public.md](./2026-05-17-1951-mcp-endpoint-public.md) |
| 19:56 | Docker builder prune is a no-op | Fully fixed by 2026-05-18 00:06 — systemd unit now runs both `docker builder prune` and `docker buildx prune` in sequence; tonight's scheduled run executed cleanly. | [2026-05-17-1956-docker-builder-prune-noop.md](./2026-05-17-1956-docker-builder-prune-noop.md) |
| 19:51 | Redis hit rate 7.4 % | Re-investigated 20:30: keyspace is 99 % MCP snapshots (write-once, read-rarely-by-design, 24 h TTL). Headline metric is meaningless; the actionable follow-up is a per-prefix breakdown. | [2026-05-17-1951-redis-low-hit-rate.md](./2026-05-17-1951-redis-low-hit-rate.md) + [2026-05-17-2030-redis-hit-rate-findings.md](./2026-05-17-2030-redis-hit-rate-findings.md) |

## Quick wins (cheapest changes with the highest leverage)

1. **Cloudflare Cache Rule on `/_next/image`** — operator dashboard action; eliminates the image-optimizer bottleneck and the 504s. ([1947-next-image…](./2026-05-17-1947-next-image-optimizer-saturation.md))
2. **`marketplace-pg-backup.timer`** — one systemd unit, one `pg_dump`. Closes the worst single risk. ([1956-no-database-backups](./2026-05-17-1956-no-database-backups.md))
3. **Switch `marketplace-docker-prune` to `docker buildx prune`** — one-line service change, reclaims 41 GB. ([1956-docker-builder-prune-noop](./2026-05-17-1956-docker-builder-prune-noop.md))
4. **Postgres `command:` override** — bundles three audits: shared_buffers/effective_cache_size tune, `shared_preload_libraries=pg_stat_statements`, plus the chance to set sensible `max_connections`. Single Postgres restart. ([2010-postgres-on-defaults](./2026-05-17-2010-postgres-on-defaults.md), [2000-pg-stat-statements](./2026-05-17-2000-pg-stat-statements-not-loaded.md))
5. **Add a swapfile** — `fallocate 4G && swapon`. Buys headroom under spike. ([1942-no-swap…](./2026-05-17-1942-no-swap-commit-near-limit.md))
