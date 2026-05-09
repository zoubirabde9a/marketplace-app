# Protocols & tools we use

The list of every protocol, library, and service that touches a production server, and **why** we picked each one. New choices should be added here with the same structure.

## Remote access

| Concern | Choice | Why |
|---|---|---|
| Shell access | **OpenSSH** with **ed25519** keypairs as the primary path; **password auth left enabled** as a recovery fallback | Standard, free, every OS supports it. Ed25519 keys are short, fast, and not vulnerable to the small-modulus attacks RSA needs careful generation to avoid. We keep password auth on so a lost laptop/key isn't a lock-out — bruteforce risk is mitigated by `fail2ban` on the `sshd` jail. The password lives in `deploy/.env`; OpenSSH itself cannot read passwords from any config file. |
| One key per server | dedicated keypair `~/.ssh/vps-eu_ed25519` rather than reusing `~/.ssh/id_ed25519` | If one server is compromised we only have to rotate one key, not every key on the operator's machine. |
| Host name resolution | hand-curated `~/.ssh/config` aliases (`vps-eu`, etc.) | We rename/replace machines often enough that hardcoded IPs in scripts age badly. Names are stable; the alias indirects to whatever IP currently holds the role. |
| Host key trust | TOFU (trust-on-first-use) via `accept-new`, fingerprint recorded in `servers.md` | We compare fingerprint shown on first connect against what's in `servers.md` before accepting. |
| Key exchange | `curve25519-sha256` (pinned for Windows clients only) | Server prefers post-quantum `sntrup761x25519-sha512`; Windows OpenSSH 9.5 can't speak it. Linux/macOS on OpenSSH 9.6+ negotiates the modern KEX automatically. |

## Network

| Concern | Choice | Why |
|---|---|---|
| Inbound firewall | **`ufw`** (Uncomplicated Firewall) — allow 22, 80, 443; deny everything else | One-liner, audit-able, default on Ubuntu/Debian. We don't need fine-grained zones. |
| Reverse proxy / TLS | **Caddy** | Auto-issues Let's Encrypt certs, auto-renews, HTTP→HTTPS redirect by default, config is 5 lines. We don't need nginx's flexibility. |
| TLS | **Let's Encrypt** via Caddy's ACME client | Free, ubiquitous, 90-day certs auto-renewed. |
| HTTP version on the wire | HTTP/2 + HTTP/3 (QUIC) — Caddy enables both by default | Free latency win for users on flaky mobile networks (HTTP/3). |
| DNS / DDoS / CDN | **Cloudflare** in front of the origin (proxy mode `🟠`), once a domain is set up | Free DDoS scrubbing, free CDN for static assets, hides origin IP. |
| Brute-force protection on SSH | **fail2ban** with the `sshd` jail | Catches script kiddies hammering port 22. Optional once password auth is disabled, but cheap to run. |

## App runtime

| Concern | Choice | Why |
|---|---|---|
| Process orchestration | **Docker Compose** (single-node) | We're one VPS, not a fleet. Kubernetes is the wrong tool for one machine. Compose's restart policies + healthchecks cover what we need. |
| Container engine | **Docker Engine** + Compose v2 plugin (`docker compose`, not `docker-compose`) | Compose v1 is unmaintained. |
| Application database | **PostgreSQL 16** in a Docker container, data on a host bind-mount under `/var/lib/marketplace/postgres` | Postgres is the right default. Bind-mount (vs named volume) keeps data visible to backup scripts on the host. |
| App images | built locally, pushed to **GitHub Container Registry** (`ghcr.io`) | Free, integrates with Actions, private by default. |
| Secrets at runtime | environment variables loaded by Compose from a server-side `.env` file with mode `600` owned by root | No secrets baked into images. The file is the same shape as `deploy/.env` but lives on the server, not the laptop. |
| Logging | Docker's default `json-file` driver with rotation (`max-size=10m`, `max-file=3`) | Stops one chatty container from filling the disk. |

## Backups

| Concern | Choice | Why |
|---|---|---|
| Server-level snapshots | netcup's snapshot feature (manual, before risky changes) | Whole-disk rollback for "I broke the OS" scenarios. |
| Database backups | nightly `pg_dump` → **Backblaze B2** (S3-compatible) bucket via `restic` or `rclone` | B2 is ~$0.005/GB/mo, an order of magnitude cheaper than S3. Off-machine + off-provider. |
| Backup encryption | restic encrypts at rest; key in `deploy/.env` as `RESTIC_PASSWORD` | The B2 bucket is treated as untrusted storage. |
| Retention | 7 daily, 4 weekly, 6 monthly | Standard restic forget policy. |
| Restore drill | scheduled quarterly — log it in `CHANGELOG.md` | A backup you haven't restored isn't a backup. |

## Observability

| Concern | Choice | Why |
|---|---|---|
| Uptime monitoring | **UptimeRobot** free tier (or self-hosted **Uptime Kuma** if we want to avoid third parties) | Pings a `/livez` endpoint every 5 min. Pages us by email if it's down. |
| Application logs | `docker logs <container>` for now; **Grafana Loki** later if volume justifies | Premature log aggregation is a tarpit. SSH + grep until logs hurt. |
| Metrics | not yet decided. **Prometheus + Grafana** if we add them, or `node_exporter` + **Grafana Cloud free tier** to skip self-hosting | Most useful once we have real traffic. |

## Deploy mechanics

| Concern | Choice | Why |
|---|---|---|
| What triggers a deploy | manual `git push` then `ssh vps-eu 'cd /opt/marketplace && docker compose pull && docker compose up -d'` for now; **GitHub Actions on push to `main`** later | Manual is fine while I'm the only operator. Automation comes when we have a second person. |
| Idempotency | Compose itself is idempotent; configs are committed in this repo so a fresh server is reproducible | Recovery from total server loss = `terraform apply` (someday) + run the runbooks in order. |
| Zero-downtime deploys | not solved yet — `docker compose up -d` causes a ~3s gap | Acceptable until we have a second instance or real users. |

## Out of scope (intentionally)

- **Kubernetes / Nomad / Swarm** — wrong tool for one box.
- **Service mesh** — same.
- **Hashicorp Vault / 1Password Connect** — `deploy/.env` mode 600 is good enough until we have multiple operators.
- **Terraform / Pulumi** — useful when we have ≥3 servers; today the runbooks are the IaC.
