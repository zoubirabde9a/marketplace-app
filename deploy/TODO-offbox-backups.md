# TODO: off-box Postgres backups

**Status:** local daily dumps are running (see `systemd/marketplace-pg-backup.{service,timer}` and CHANGELOG 2026-05-17). Off-box copy is NOT yet configured — needs operator decision before implementation.

## Why local-only isn't enough

The dump on `vps-eu:/opt/marketplace/backups/` protects against logical mistakes (bad migration, accidental `DROP`, application-level corruption). It does NOT protect against:

- The VPS disk (`vda3`) failing.
- Netcup-side incident that destroys/quarantines the volume.
- An attacker with root deleting the backups dir before exfiltrating/wiping the DB.

A backup that lives on the same machine as the primary is one disk away from total loss.

## Decision needed from operator

Pick one of these destinations and one of these tools.

### Destination (cost is per the catalog's current ~50 MB compressed dump; budget for ~5x growth)

| Option | Cost (~250 MB stored) | Egress to restore | Notes |
|---|---|---|---|
| Backblaze B2 | ~$0.0015/mo | $0.01/GB | Cheapest. S3-compatible. |
| Netcup Object Storage | varies | in-region free | Same provider as VPS = single-point-of-failure risk. |
| Hetzner Storage Box | ~€3.50/mo (1 TB) | free | Cheap fixed, plenty of headroom, separate provider. |
| Wasabi | ~$6.99/mo min | free | Min charge dominates at our size. |

Hetzner Storage Box is the most operationally simple if the operator already has a Hetzner account; B2 is cheapest pay-as-you-go.

### Tool

- **rclone** — simple `rclone copy /opt/marketplace/backups/ remote:bucket/`. Encryption optional (`rclone crypt`). Good for "just shove the file at S3".
- **restic** — content-addressed, deduplicating, always-encrypted, native retention policy. More features than rclone but more moving parts (repo init, password file). Better if we add Caddy data + Redis dumps to the same off-box flow.

Recommendation: **restic to a Hetzner Storage Box over SSH** if the operator wants a turnkey, encrypted, deduplicating solution; **rclone to B2** if pay-as-you-go and minimal setup matter more.

## Implementation plan once a destination is chosen

1. Add the destination credentials to `/opt/marketplace/.env` (NOT committed). Document the variable names in `.env.example`.
2. Add an `ExecStartPost=` to `marketplace-pg-backup.service` (or a separate `marketplace-pg-backup-offbox.service` that triggers after) that runs the chosen sync command.
3. Add a "no successful off-box copy in 36 h" alert. Easiest: emit a journal log line on success, have the periodic-check skill flag missing lines.
4. Add a monthly test-restore: load the most recent off-box dump into a throwaway container and `SELECT count(*) FROM catalog.products` against it. Fail loud if the count drops > 10 % between runs.
5. Document the restore procedure in `deploy/runbooks/`.

## Also worth bundling into the off-box copy

- `caddy_data` volume — losing it forces a Let's Encrypt re-issue (rate-limited, disruptive but not catastrophic).
- Redis dump (`/var/lib/marketplace/redis/dump.rdb`) — mostly cache, low priority.

## Audit reference

`deploy/audits/2026-05-17-1956-no-database-backups.md` — HIGH severity gap. Local dumps close the logical-error half; this TODO covers the disk-failure half.
