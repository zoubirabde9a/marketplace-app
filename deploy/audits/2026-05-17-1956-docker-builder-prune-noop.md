# Audit: `marketplace-docker-prune.service` reports `Total: 0B` daily while build cache is at 42 GB

- **Detected:** 2026-05-17 19:56 local
- **Severity:** medium — 41 GB of disk reclaimable but stuck; small disk would already be at risk
- **Source:** `docker system df`, `journalctl -u marketplace-docker-prune` on vps-eu

## Evidence

`docker system df`:

```
TYPE          TOTAL   ACTIVE   SIZE       RECLAIMABLE
Images        8       5        37.64GB    223.7MB (0%)
Containers    6       5        585.7kB    4.096kB (0%)
Local Volumes 2       2        14.4kB     0B (0%)
Build Cache   296     0        42.23GB    41.02GB
```

Service definition:

```
ExecStart=/usr/bin/docker builder prune -af --filter until=24h
```

Last 7 service runs (one per day):

```
May 11 00:12:47  docker[…] Total:        0B
May 12 00:11:46  docker[…] Total:        0B
May 13 00:05:03  docker[…] Total:        0B
May 14 00:00:28  docker[…] Total:        0B
May 15 00:09:39  docker[…] Total:        0B
May 16 00:07:07  docker[…] Total:        0B
May 17 00:03:40  docker[…] Total:        0B
```

Every run reports zero bytes freed even though `docker system df` shows 41 GB reclaimable.

## Hypothesis

Two plausible causes:

1. **The cache is buildx-managed, not legacy-builder-managed.** `docker builder prune` operates on the legacy builder's cache; if builds were ever run with `docker buildx` (the default in recent Docker engines), the 42 GB lives in `buildx` storage and the prune target is empty. The fact that `docker builder prune -af` (with `-a` for "all") still reports 0B is strong evidence the legacy builder simply has nothing to prune.
2. **The `until=24h` filter is consistently excluding everything.** Less likely — `-a` means "all unused", but with `--filter until=` Docker interprets it as a creation-age filter. If something refreshes the cache mtime each day (e.g. a re-tag), entries reset and never age out. But `-a` should still pick them up.

(1) is the more likely root cause.

## Fix steps

1. Confirm which builder is in use: `docker buildx ls` and `docker buildx du`. If `default` is a `docker-container` driver with a separate cache, the 41 GB is there.
2. If confirmed: update the service to:
   ```
   ExecStart=/usr/bin/docker buildx prune -af --filter until=24h
   ```
   (or run both: `docker builder prune` then `docker buildx prune`).
3. As a one-shot cleanup, the operator should run `docker buildx prune -af` manually once to clear the accumulated 41 GB before re-enabling the timer with the corrected command.
4. Update the service description and the corresponding entry in `deploy/systemd/` if that's where the unit is checked in (the inline service `Description` already drifted: it currently says "Prune Docker build cache older than 24h" on some lines and "older than 72h" on others — there's a stale Description string somewhere).

## Similar issues to scan for

- Image storage is 37.64 GB across 8 images. `marketplace-api` is 1.11 GB and `marketplace-web` 344 MB — the api image is suspiciously large for a Node service. Worth a multi-stage Dockerfile review (dev deps left in the final layer?). Not urgent at 20 % disk usage but reduces deploy time and image-pull cost.
- `marketplace-data-rotate.timer` is supposed to rotate scrape JSON dumps older than 7 days. Spot check: `/opt/marketplace/data/` still has `ouedkniss-automobiles_vehicules-2026-05-11T*.json` files, which is exactly at the 7-day boundary today (2026-05-17). They're due to be rotated in the next run; if they're not gone by 2026-05-18, the rotation is also broken.
