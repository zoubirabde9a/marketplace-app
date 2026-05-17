# Audit: no Postgres backups configured anywhere

- **Detected:** 2026-05-17 19:56 local
- **Severity:** **high** — production data is one bad migration / disk failure away from total loss
- **Source:** `systemctl list-timers`, `systemctl list-units`, `crontab`, filesystem scan

## Evidence

`systemctl list-timers` shows 12 timers. The only one matching `*backup*` is `dpkg-db-backup.timer` — that backs up the OS's Debian package database, not Postgres.

`systemctl list-units --all | grep -iE 'backup|dump'`: only `dpkg-db-backup.service`.

`sudo crontab -l`: empty. `/etc/cron.d/`: only `e2scrub_all`, `kernel`. `/etc/cron.daily|hourly|weekly|monthly|yearly`: only OS hygiene tasks (`apt-compat`, `dpkg`, `logrotate`).

`find /etc/systemd/system /opt/marketplace/deploy/systemd -iname '*backup*' -o -iname '*dump*'`: returns only `dpkg-db-backup.timer`.

No `/opt/marketplace/backups/` directory exists. The `marketplace-postgres` container has been up 9 days with no scheduled `pg_dump`, no `pg_basebackup`, no replication, no off-host snapshot, no netcup-side volume snapshot visible from inside the VPS.

## Hypothesis

The Postgres backup job was either never written, or it lived as part of a docker compose service that was removed during a deploy. Either way, today the catalog has ~55 k products, ~214 k media rows, and presumably some real seller/account/cart data on a 9-day-old volume — all of which would be unrecoverable if `vda3` failed, if a bad migration ran, or if someone ran the wrong `DROP`.

## Fix steps

1. Add a `marketplace-pg-backup.service` + `marketplace-pg-backup.timer` to `deploy/systemd/` that runs daily and:
   - Calls `docker exec marketplace-postgres pg_dump -Fc -U marketplace marketplace > /opt/marketplace/backups/marketplace-$(date -u +%FT%H%M).dump`
   - Compresses if not already compressed (`-Fc` already does).
   - Rotates: keep 7 daily, 4 weekly, 6 monthly.
2. Off-box copy. The dump on the same VPS protects against logical mistakes but not against the disk dying. Easy options:
   - `rclone copy` to a netcup object storage bucket or Backblaze B2 (cheap, ~$0.005/GB/mo).
   - `restic` to a remote repo with encryption.
3. Verify the backup. A backup that has never been restored is not a backup — add a monthly test-restore that loads the latest dump into a throwaway container and runs `SELECT count(*) FROM catalog.products` against it. Fail loud if the count drops > 10 % between runs.
4. Document in `deploy/runbooks/` how to restore from a dump.

## Similar issues to scan for

- No Redis backup either. Redis is mostly cache (and is `allkeys-lru`), so this is lower priority — but if any session/cart state lives in Redis without a Postgres mirror, that's also at risk. Confirm via the app code.
- Caddy data dir (TLS certificates) — losing it forces a re-issue from Let's Encrypt; not catastrophic but disruptive. Worth including in the same off-box backup.
- No monitoring/alert on backup *success*. Even if (1) above is wired up, a silent failure for 30 days is invisible until the day you need to restore. Add a "no successful backup in 36 h" alert.
