# Findings: Redis 7.4% hit rate is dominated by MCP snapshots, not the response cache

- **Investigated:** 2026-05-17 20:30 local
- **Follow-up to:** `2026-05-17-1951-redis-low-hit-rate.md`
- **Verdict:** the headline metric is misleading. The original hypothesis (per-product seeder churn, querystring fragmentation in the response cache) is incorrect. No small code constant fix; the next change is a TTL policy decision on MCP snapshots.

## What the keyspace actually contains

Sampled `redis-cli --scan --pattern "*"` on `vps-eu` against `marketplace-redis`. Grouping by top-level prefix:

```
22868  snap:*       (MCP catalog snapshots, 24h TTL each)
    1  pcache:*     (response cache, /v1/products listing JSON)
-----
22869  total (DBSIZE: 23189 — ±300 keys turned over during the scan)
```

The `pcache:*` response cache — the one the original audit assumed was the dominant prefix — has effectively **one live key at a time**. The Redis keyspace is essentially a single `snap:*` store with a tiny response-cache appendix.

## Why hit rate is 7.4%

Both call sites use Redis as designed:

1. **`snap:*` (packages/api/src/repos/snapshots.ts)** — each MCP catalog tool call (`catalog.search`, `catalog.get_listing`, etc.) creates a snapshot with a fresh 22-char base64url id (`catalog.newSnapshotId()`) and stores it for `SNAPSHOT_TTL_MS = 24h`. The id is returned to the agent. Agents rarely fetch the snapshot back; the id exists so they CAN later present `snapshotUrl` as proof of "what they saw when they made the decision." This is **write-once, read-rarely-or-never** by design — every snapshot that expires un-read counts as one miss against zero hits.

   Evidence: `expired_keys=402k` vs `keyspace_hits=9.5k`. The ratio of expirations to hits is ~42:1, which is close to "snapshots are almost never re-read."

2. **`pcache:v1:products:*` (packages/api/src/middleware/response-cache.ts)** — keyed by raw `req.url`. TTL from `RESPONSE_CACHE_TTL_SECONDS`, default 30s, **not set in production .env so the default applies**. Sampled live: `pcache:v1:products:/v1/products?limit=1&noFacets=true ttl=5` — meaning that key was already 25s old, written by an earlier request, and about to expire. Only one such key was present in the entire sample, because anonymous traffic to `/v1/products` is low-volume relative to a 30s TTL and most requests carry an `Authorization: Bearer mp_…` cookie from the SSR layer (the middleware bypasses caching when `req.headers.authorization` is set — start.ts:198).

## What this means for the original audit's "fix steps"

- **"Lengthen TTL past the seed cadence":** the seeder writes neither `snap:*` nor `pcache:*` keys. It writes Postgres rows directly via `packages/db/dist/seed-from-scraped.js` (DB-direct path, no Redis touchpoint). So seeder cadence is irrelevant to cache freshness pressure.
- **"Normalize cache key (sort filter params, drop pagination cursors)":** real, but only worth doing if/when we have evidence that `pcache:*` traffic is high enough to be measurable. Today it isn't — one live key means the dominator on the miss count cannot be querystring fragmentation.
- **"Backfill obvious hot reads on container start":** the existing warm-up at `start.ts:212-219` already fires one local search at boot. Extending it to a handful of `/c/<category>?limit=12&sort=newest` URLs would matter only if `pcache:*` was actually being hit, which it isn't.

## The actual lever

If we want a meaningful hit rate, the choice is structural, not a TTL tweak:

- **Option A — accept the metric is meaningless.** Snapshots are receipts agents may or may not redeem. They will always have a near-zero hit rate. The right denominator for cache health is `pcache:*` + any future content cache, not the whole keyspace. Add a per-prefix breakdown (Redis doesn't expose this natively — would need an in-process counter in the snapshot store + response cache wrapper). Cost: ~30 lines, no behaviour change.
- **Option B — shorten snapshot TTL.** Drop `SNAPSHOT_TTL_MS` from 24h to 1h (or 2h). Agents that follow up within an hour still get their snapshot back; the long tail of un-redeemed snapshots cycles out 24× faster, freeing memory and lowering the absolute miss count. **Caveats:** `snapshotExpiresAt` is returned to MCP agents as part of every catalog tool response, and external agents may have stored those for replay — shortening the TTL is a contract change. Operator coordination needed before changing.
- **Option C — stop creating snapshots for tools that almost never get followed up on.** `catalog.search` snapshots are useful as audit trail. `catalog.get_listing` snapshots are arguably redundant since the product detail is already addressable by id. Worth a separate review — out of scope here.

Recommended next concrete change: **Option A** (per-prefix hit/miss counters). It is the only one that doesn't require an operator decision on agent-facing contract changes, and once we have the data we can decide on B or C with evidence.

## What changed in code today

Nothing. No TTL constants were modified, no response-cache key normalization was added. The original audit's "small fix" assumption did not survive inspection of the actual keyspace.

## Cross-references

- `packages/api/src/repos/snapshots.ts:75-81` — snapshot Redis write
- `packages/domain/src/catalog/snapshot.ts:40` — `SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000`
- `packages/api/src/start.ts:189-201` — response cache registration
- `packages/api/src/middleware/response-cache.ts` — full response-cache impl
- `packages/mcp-server/src/tools/snapshot-helpers.ts:30-50` — snapshot creation in MCP tools
