# Audit: Postgres is running on out-of-the-box defaults on a 7.7 GiB host

- **Detected:** 2026-05-17 20:10 local
- **Severity:** medium-high — under-tuned cache is a plausible cause of multiple slow-API audits already filed
- **Source:** `SHOW shared_buffers; SHOW work_mem; SHOW effective_cache_size; SHOW max_connections;` on `marketplace-postgres`

## Evidence

```
shared_buffers       = 128 MB     (default)
work_mem             = 4 MB       (default)
effective_cache_size = 4 GB       (default)
max_connections      = 100        (default)
```

Host has 7.7 GiB RAM. `marketplace-postgres` is currently consuming 264 MiB resident (`docker stats`). The catalog is ~55 k products + ~214 k media rows + the scraper writing constantly.

## Hypothesis

These are the values pg17 ships with for a developer laptop, not a production database on a 7.7 GiB VPS. Two specific consequences:

1. **`shared_buffers = 128 MB`** is far below the standard 25 % of RAM rule of thumb (~2 GB). Index pages and hot rows that should live in PG's cache get evicted constantly and reloaded from the OS page cache (which itself fights for memory with Node + Redis). This shows up as cold-query slowness — the bimodal latency observed for `/v1/products?limit=1` (5 ms warm, 450 ms cold; see `2026-05-17-1942-api-products-limit1-bimodal-latency.md`) fits this profile exactly.
2. **`effective_cache_size = 4 GB`** is the planner's estimate of how much memory it can assume is available for caching. Set too low, the planner underweights index scans vs sequential scans. On a query like the sitemap (50 k rows × media join, see `2026-05-17-2005-sitemap-cold-120s-exceeds-spec.md`), a planner mis-step can be the difference between 1 s and 120 s.

## Fix steps

1. Update `docker-compose.prod.yml` for the `postgres` service to apply tuned values. Conservative starting point for a 7.7 GiB host shared with Node + Redis + the OS:
   ```yaml
   command:
     - postgres
     - -c
     - shared_buffers=2GB
     - -c
     - effective_cache_size=4GB
     - -c
     - work_mem=16MB
     - -c
     - maintenance_work_mem=256MB
     - -c
     - random_page_cost=1.1            # SSD
     - -c
     - effective_io_concurrency=200    # SSD
     - -c
     - shared_preload_libraries=pg_stat_statements  # combines with 2026-05-17-2000 audit
   ```
   `pgtune` (https://pgtune.leopard.in.ua/) gives equivalent values for a "Web application" profile, same ballpark.
2. Coordinate with the operator — this requires a Postgres restart, and there are no backups yet (`2026-05-17-1956-no-database-backups.md`). The right ordering is: (a) take a `pg_dump`, (b) bring up the new config, (c) confirm queries still plan well.
3. After the change, sample p50 / p95 of the slow endpoints from earlier audits. If `pg_stat_statements` is enabled in the same restart, this is straightforward.

## Similar issues to scan for

- `max_connections = 100` while the api keeps 29 idle connections open (see iteration 5 audit). Comfortably under the cap, but if the pool sizing is per-worker it could climb. After the config change, also set `max_connections` deliberately rather than leaving it at default.
- No container memory limits in `docker-compose.prod.yml`. Combined with the no-swap audit (`2026-05-17-1942-no-swap-commit-near-limit.md`), this means any one container can starve the others. Adding `mem_limit: 3g` on `postgres` (after the tune above), `mem_limit: 2g` on `redis`, `mem_limit: 1.5g` on `web`, and similar on `api` would make the failure mode predictable.
