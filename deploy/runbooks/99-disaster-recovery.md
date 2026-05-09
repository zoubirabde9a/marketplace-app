# Runbook 99 — Disaster recovery

What to do when production is broken in a way that doesn't fit a single bug fix. Read this in order; each section assumes earlier ones have been ruled out.

> The point of writing this *down* is so the operator under stress at 2 a.m. has a checklist instead of trying to think.

## 0. Stop. Triage.

Before doing anything destructive:

1. **Confirm the failure mode** with three independent signals:
   - `curl -sSI https://teno-store.com/` (returns? what status?)
   - `curl -sS https://api.teno-store.com/livez` (returns? what body?)
   - The Cloudflare dashboard (does it report origin reachable? is there a recent rule change?)
2. **Check the Cloudflare side first.** A blank page often means the orange cloud is fine and the origin is fine but a rule is misbehaving. Go to Security → Events; filter to the last hour. If there's a flood of 5xx from your origin IP, that's a real outage. If there's a flood of "blocked" events, it's likely a Cloudflare rule or Bot Fight Mode false positive.
3. **Don't reboot, don't restore from backup, don't rotate keys** until you've eliminated cheap explanations:
   - Did `unattended-upgrades` reboot the box and a container failed to come back? `ssh vps-eu 'systemctl status docker'`.
   - Did the disk fill? `ssh vps-eu 'df -h /'` — if `/` is over 90 %, jump to **section 4**.
   - Did Caddy fail to renew a cert? `ssh vps-eu 'docker logs --tail=200 marketplace-caddy-1'` — jump to **section 3**.
   - Did Postgres die? `ssh vps-eu 'docker ps | grep postgres'` — jump to **section 2**.

## 1. Server lost / unrecoverable

Symptom: SSH is unreachable for > 10 min, the Cloudflare dashboard shows origin unreachable, the netcup control panel shows the VPS as stopped or "in failure".

```bash
# Step 1: provision a new VPS
# Follow runbook 01-provision-vps.md. Pick the same arm64 plan in Nuremberg.

# Step 2: bootstrap SSH
# runbook 02 — generate a fresh keypair (NOT the old one), install on the new server.

# Step 3: harden
# runbook 03 — ufw, fail2ban, unattended-upgrades.

# Step 4: install Docker
# runbook 04 — Docker CE + Compose plugin.

# Step 5: restore Postgres from B2
ssh new-vps '
  mkdir -p /var/lib/marketplace/postgres-restore
  apt-get install -y restic
  export RESTIC_REPOSITORY=b2:teno-store-backups
  export RESTIC_PASSWORD=<from-deploy-.env>
  export B2_ACCOUNT_ID=<from-deploy-.env>
  export B2_ACCOUNT_KEY=<from-deploy-.env>
  restic snapshots
  restic restore latest --target /var/lib/marketplace/postgres-restore
  mv /var/lib/marketplace/postgres /var/lib/marketplace/postgres-empty
  mv /var/lib/marketplace/postgres-restore /var/lib/marketplace/postgres
'

# Step 6: deploy the app
# runbook 05 — tar | ssh, .env, docker compose up -d.

# Step 7: cut DNS over
# Cloudflare dashboard → DNS → edit the A and AAAA records for @, www, api.
# Update deploy/dns.md and deploy/servers.md with the new IPs.
# Cloudflare TTL is 1 min for proxied records — propagation is near-instant.

# Step 8: verify
curl -sS https://api.teno-store.com/livez
curl -sSI https://teno-store.com/
```

Replace the old `vps-eu` entry in `servers.md` with the new server's details; mark the old one as "decommissioned, retain in this file for audit".

## 2. Database corrupted

Symptom: API returns 500 on every read, container logs show Postgres error like `could not read block` or `invalid page header`. Or `pg_dump` itself errors out.

```bash
ssh vps-eu '
  cd /opt/marketplace
  # Stop everything that touches the DB
  docker compose -f docker-compose.prod.yml stop api web

  # Confirm Postgres is up but unhappy
  docker compose -f docker-compose.prod.yml exec postgres pg_isready

  # Take a defensive snapshot of the broken volume FIRST
  tar -czf /root/postgres-broken-$(date +%s).tar.gz /var/lib/marketplace/postgres

  # Restore from B2
  apt-get install -y restic 2>/dev/null
  export RESTIC_REPOSITORY=b2:teno-store-backups
  export RESTIC_PASSWORD=<from-deploy-.env>
  restic snapshots --tag postgres-nightly | tail -5
  # Pick a snapshot ID, then:
  docker compose -f docker-compose.prod.yml stop postgres
  rm -rf /var/lib/marketplace/postgres
  restic restore <snapshot-id> --target /
  docker compose -f docker-compose.prod.yml start postgres
  docker compose -f docker-compose.prod.yml start api web
'
```

Don't delete `postgres-broken-*.tar.gz` for at least 7 days — if the restore was a wrong snapshot and we lose recent writes, the broken volume might still recover them with `pg_resetwal`-style hacks.

## 3. Certificate stuck (Let's Encrypt rate limit)

Symptom: Caddy logs `acme: error: 429 :: POST :: ... too many certificates already issued`. Browsers show an expired cert.

Let's Encrypt rate limits:
- 50 certs per registered domain per week
- 5 duplicate certs per week
- 5 failed validations per hour

```bash
ssh vps-eu '
  cd /opt/marketplace
  # Check caddy state
  docker compose logs --tail=200 caddy | grep -iE "error|acme"

  # Quick fix: switch caddy to staging issuer to keep traffic flowing on a
  # browser-untrusted-but-valid cert while we figure out the root cause.
  # In Caddyfile, add to the global options:
  #   acme_ca https://acme-staging-v02.api.letsencrypt.org/directory
  # Reload:
  docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile

  # Once the rate limit resets (1 week max), revert and reload again.
'
```

If the cause is Cloudflare blocking the HTTP-01 challenge: temporarily grey-cloud the records (Cloudflare dashboard → DNS → click the orange cloud), let Caddy issue, then re-orange.

## 4. Disk full

Symptom: API 500s, Caddy logs "no space left on device", `df -h /` is 100 %.

```bash
ssh vps-eu '
  df -h /
  # Top space hogs
  du -h --max-depth=1 / 2>/dev/null | sort -h | tail -20

  # Most likely culprits, in order:
  #   /var/lib/docker/containers/*/json.log — log rotation already configured
  #     (10m × 3) but spikes happen. Fix: docker system prune --volumes (CAREFUL)
  #   /var/lib/marketplace/postgres — DB grew faster than expected. Fix: vacuum,
  #     or scale the volume in netcup.
  #   /opt/marketplace — old tarballs left over from deploys. rm them.
  #   /root — restic cache. restic prune.

  # Defensive cleanup that does NOT lose state:
  docker system prune -a --filter "until=72h"
  journalctl --vacuum-time=7d
'
```

Never `rm -rf /var/lib/marketplace/postgres` — that *is* the database.

## 5. Domain / DNS hijacked

Symptom: traffic going to an IP we don't own, MX records appearing that we never set, Cloudflare account showing logins from unknown geos.

1. **Lock the Cloudflare account first.**
   - Force logout all sessions (Profile → API Tokens → revoke all; Profile → Security → revoke all sessions).
   - Rotate the password and enable hardware-key MFA if not already on.
2. **Audit DNS.** Cloudflare → Audit Logs → filter to the last 30 days for any record changes. Compare against `deploy/dns.md`. Restore anything that diverged.
3. **Rotate any API token** stored in `deploy/.env`. The `CLOUDFLARE_API_TOKEN` (if present, used for Caddy DNS-01 challenges) must be revoked in the Cloudflare dashboard and re-issued.
4. **Check the registrar.** Whoever owns `teno-store.com` has the *real* power — if the nameservers themselves were swapped, the Cloudflare lockdown is moot. Lock the registrar account, enable transfer-lock if it isn't already, set up a registrar-side notification on any change.
5. **Update `deploy/dns.md` and add a CHANGELOG entry** — exactly what was changed, when, by whom (suspected).

## 6. Operator key lost / laptop compromised

Symptom: laptop stolen, drive unlocked. The attacker has `~/.ssh/vps-eu_ed25519`.

```bash
# Step 1 — pre-emptive: get into the server before the attacker rotates anything.
# If you still have access via password (deploy/.env -> VPS_EU_ROOT_PASSWORD)
# or via netcup's web KVM console, do this from there:

# Step 2 — generate a fresh keypair on a clean machine
ssh-keygen -t ed25519 -f ~/.ssh/vps-eu_ed25519 -N ""

# Step 3 — replace authorized_keys on the server (don't append: replace)
cat ~/.ssh/vps-eu_ed25519.pub | ssh -i <password-or-kvm> root@<vps-eu-ip> '
  cat > /root/.ssh/authorized_keys
  chmod 600 /root/.ssh/authorized_keys
'

# Step 4 — force-logout existing sessions
ssh -i <new-key> root@vps-eu 'pkill -KILL -u root --include-parent ssh ; true'

# Step 5 — rotate everything else that was on the laptop
#   Cloudflare API token, Backblaze B2 keys, GitHub PATs, Postgres password,
#   GOOGLE_CLIENT_ID is fine to keep (public).
#   Update deploy/.env on the laptop, then re-tar | ssh the new .env to /opt/marketplace/.env.
```

## 7. Backups don't actually work

Symptom: after a quarter of "everything's fine", you try the restore drill (`section 2`) and `restic snapshots` returns empty / errors / decrypts wrong.

This is the failure mode you discover *during* a real incident. The protocol is:
1. Quarterly restore drill — file it as a calendar event right now if you haven't.
2. After every nightly backup, ship a one-line metric to UptimeRobot or similar so you get paged when the backup count is missing or shrinking.
3. Keep the broken `/var/lib/marketplace/postgres-broken-*.tar.gz` from section 2 — if backups are dead, the broken volume is the only forensic trace you have.

---

## Recovery Time Objective (informal)

Given today's setup (no warm standby, single region, manual deploy):

| Scenario | Expected RTO | Data loss (RPO) |
|---|---|---|
| `docker compose up -d` brings it back | < 1 min | 0 |
| Container crash loop, fixable in code | < 30 min | 0 |
| Postgres restore from B2 | < 60 min | up to 24 h (nightly backups) |
| Total VPS loss, fresh provision + restore | 2–4 h | up to 24 h |
| Domain hijack, full registrar recovery | 1–2 days | depends on registrar |

These are aspirational, not committed. Tighten by adding a warm standby in a second region (RPO ~1 min via streaming replication, RTO ~15 min via DNS cutover) — see `protocols.md` § Backups for the half-formed plan.
