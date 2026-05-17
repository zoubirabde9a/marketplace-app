# Audit: `pg_stat_statements` not enabled — no slow-query telemetry in prod

- **Detected:** 2026-05-17 20:00 local
- **Severity:** low-medium — not breaking anything today, but blocks investigation of every slow-API audit already filed
- **Source:** `pg_available_extensions`, `SHOW shared_preload_libraries` on `marketplace-postgres`

## Evidence

```
SELECT * FROM pg_available_extensions WHERE name = 'pg_stat_statements';
        name        | default_version | installed_version
--------------------+-----------------+-------------------
 pg_stat_statements | 1.11            | (null)

SHOW shared_preload_libraries;
 shared_preload_libraries
--------------------------
 (empty)
```

The extension is available in the image (`pgvector/pgvector:pg17`) but neither preloaded nor installed. With `shared_preload_libraries` empty, `CREATE EXTENSION pg_stat_statements` alone won't work — Postgres has to be restarted with the library in the preload list first.

## Hypothesis

Default `postgresql.conf` shipped with the image, plus the Compose service does not override it. So we never instrumented query statistics on this database. Every slow-query investigation (e.g. the bimodal-latency report `2026-05-17-1942-api-products-limit1-bimodal-latency.md`, the 953 ms product-detail GETs) currently has to be done by ad-hoc `EXPLAIN ANALYZE` — there is no historical record of which queries are slow.

## Fix steps

1. Add a Postgres config override mounted into the container. Simplest path is to set `POSTGRES_INITDB_ARGS` / use a `command:` override in `docker-compose.prod.yml`:
   ```yaml
   command:
     - postgres
     - -c
     - shared_preload_libraries=pg_stat_statements
     - -c
     - pg_stat_statements.max=10000
     - -c
     - pg_stat_statements.track=all
   ```
2. Restart the postgres service (operator confirmation needed — this is the moment to coordinate the change with a `pg_dump` first, see `2026-05-17-1956-no-database-backups.md`).
3. After restart: `CREATE EXTENSION pg_stat_statements;` in the `marketplace` database.
4. Add a follow-up audit job that grabs the top 20 by `total_exec_time` once a day and writes it to `deploy/audits/perf/` — keeps a rolling record of which queries to optimize.

## Resolved 2026-05-17 20:32

Operator restarted Postgres with `shared_preload_libraries = pg_stat_statements,auto_explain` (the audit's primary recommendation plus the `auto_explain` follow-up from the "similar issues" section). The extension is installed and reporting data within seconds. First top-by-total-time sample at 20:34 — only one minute of uptime, so noisy, but `select id from catalog.products where category_ids @> $1::jsonb` is already at 583 ms mean on its single call; a likely candidate for a missing GIN index on `catalog.products.category_ids`. Will revisit after a few hours of accumulation.

The companion tuning recommendation (`shared_buffers`, `effective_cache_size`, `work_mem`) in `2026-05-17-2010-postgres-on-defaults.md` was **not** applied in this restart — those are still at defaults. That is the right order (gather telemetry, then tune from evidence).

## Similar issues to scan for

- Also worth enabling `auto_explain` with `auto_explain.log_min_duration = 1000` so any query > 1 s gets its plan written to the Postgres log automatically. Same restart, same config block.
- Postgres currently has 29 idle connections and 1 active. 29 is high relative to load — likely the API's connection pool. Confirm the pool size in the api configuration; if it's e.g. 20-per-worker × 2 workers = 40, that's fine. If it's set unbounded, that's a foot-gun.
- The catalog tables we've seen so far (`catalog.products`, `catalog.media`) don't have a visible "what's slow" baseline. Once `pg_stat_statements` is on, run a 24 h sample and use it to validate or reprioritize the existing bimodal-latency / slow-listing audits.
