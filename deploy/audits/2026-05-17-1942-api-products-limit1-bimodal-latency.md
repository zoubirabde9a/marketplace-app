# Audit: `/v1/products?limit=1` healthcheck has bimodal latency (5 ms vs 450 ms)

- **Detected:** 2026-05-17 19:42 local
- **Severity:** medium — adds avoidable load and may mask real slow-query alerts
- **Source:** `docker compose logs api --since 30m` (vps-eu)

## Evidence

Same path, same source (`127.0.0.1`, looks like an internal probe), seconds apart:

```
17:38:10  /v1/products?limit=1   200   462.57 ms
17:38:13  /v1/products?limit=1   200     5.37 ms
17:39:10  /v1/products?limit=1   200   422.68 ms
17:39:14  /v1/products?limit=1   200     2.27 ms
17:40:12  /v1/products?limit=1   200   453.09 ms
17:40:15  /v1/products?limit=1   200     1.69 ms
17:41:11  /v1/products?limit=1   200   448.82 ms
17:41:15  /v1/products?limit=1   200     3.19 ms
```

A `LIMIT 1` should be a few ms uncached. The pattern (one ~450 ms call followed by a fast call ~3 s later) suggests this endpoint runs an expensive query — likely full facet aggregation or a count — and only the second call hits a per-process cache.

Listing endpoints are also slow under normal traffic:
- `/v1/products?noFacets=true&limit=8&sort=newest` → 838 ms
- `/v1/products/<uuid>` → 953 ms (one sample)

## Hypothesis

`/v1/products` does facet aggregation by default. Even `limit=1` triggers full-catalog facet computation against a ~55k-row table, hitting cache on warm and full plan on cold. The two callers ~3 s apart are different worker processes (pids 15/17/18 alternate) — each worker has its own cold path.

## Fix steps

1. Identify the caller. Two callers spaced ~3 s apart from `127.0.0.1` looks like a kubelet-style probe, but this isn't k8s — could be a custom monitor script or a duplicate Compose healthcheck. Check `docker-compose.prod.yml` healthcheck definitions and any cron on the host.
2. If it is a healthcheck, point it at `/livez` (already 1 ms) or `/readyz` and stop hitting `/v1/products`.
3. Independently, profile `/v1/products?limit=1` with `EXPLAIN ANALYZE` for the underlying SQL. If facets are being computed unconditionally, either:
   - Short-circuit: when `limit<=1` and no filter, skip facet aggregation.
   - Cache facet aggregates with a short TTL in Redis (Redis is already running and idle-warm at 1.2 GiB resident).
4. Slow product-detail GET (953 ms) deserves the same `EXPLAIN ANALYZE` — likely a missing index or an unindexed join to `catalog.media`.

## Similar issues to scan for

- Many `404` responses on `/v1/products/<uuid>` from `172.18.0.6` (the web container) — if the catalog cap is pruning rows the SSR still references, users will see broken product pages. Check whether category/listing pages emit stale UUIDs after prune.
- Check Caddy access log for the rate of 5xx and the top slow paths from real clients (not just localhost probes).
