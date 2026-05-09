# Servers

The complete list of every machine the marketplace-app owns or rents. **No secrets in this file** — passwords, tokens, and keys live in `deploy/.env`.

| Name | Role | Provider | Plan | Region | Public IPv4 | Public IPv6 | OS | Status |
|---|---|---|---|---|---|---|---|---|
| `vps-eu` | production (web + API + Postgres) | netcup | VPS — see provider invoice | Nuremberg, DE | `152.53.147.77` | `2a0a:4cc0:c1:2d20:a816:a4ff:fe07:7870` | Debian 13 **arm64** (kernel `6.12.85+deb13-arm64`) | SSH key auth working 2026-05-08 |

## `vps-eu` — full details

| Field | Value |
|---|---|
| Provider | netcup GmbH |
| Provider hostname | `v2202605356582457645.nicesrv.de` |
| Public IPv4 | `152.53.147.77/22` |
| Public IPv6 | `2a0a:4cc0:c1:2d20:a816:a4ff:fe07:7870` |
| Region | Nuremberg, Germany (EU) |
| OS | Debian 13 (booted from provider image) |
| Architecture | **arm64** (`aarch64`) — Docker images for this server must be `linux/arm64` or multi-arch |
| Kernel | `6.12.85+deb13-arm64 #1 SMP Debian 6.12.85-1 (2026-04-30)` |
| Hostname (as seen by OS) | `v2202605356582457645` |
| SSH server | OpenSSH 10.0p2 (`SSH-2.0-OpenSSH_10.0p2 Debian-7+deb13u2`) |
| SSH port | 22 |
| Initial admin user | `root` (password auth — bootstrap only) |
| SSH host key fingerprint | `SHA256:QbOixuW2NdARlc11JVyX0ysFGMCWk99a70JQoXBih/c` (ED25519) |
| SSH alias | `vps-eu` (configured in operator's `~/.ssh/config`) |
| Operator key | `~/.ssh/vps-eu_ed25519` (per-server keypair, dedicated to this host) |
| Operator key fingerprint | `SHA256:gZOqaLJdYSyyuEMU8UBUjfLTiOePDb0xDDDGWS6H0/Q` |
| Root password | stored in `deploy/.env` as `VPS_EU_ROOT_PASSWORD`. **Stays valid** — policy is to keep password auth enabled as a recovery path; brute-force is handled by fail2ban (runbook 03). |
| Provider control panel password | stored in `deploy/.env` as `VPS_EU_PROVIDER_PASSWORD` if applicable |
| App role | will host: web (Next.js, port 3200) + API (Fastify, port 3100) + Postgres + Caddy reverse proxy |
| Domain | `teno-store.com` (apex + `www` + `api` subdomain) — DNS managed by Cloudflare; see [`dns.md`](./dns.md) |
| TLS | will be issued by Caddy via Let's Encrypt once runbooks 04–05 are done. Cloudflare SSL/TLS mode is currently **Full**; flip to **Full (strict)** after Caddy's first successful cert. |

### Hardware / system (verified 2026-05-08)

| Field | Value |
|---|---|
| Virtualization | KVM guest |
| CPU | 6 vCPU, ARM `Neoverse-N1` @ 2.0 GHz (BIOS model `virt-9.2`) |
| RAM | 7.7 GiB total (253 MiB used, 7.5 GiB available at idle) |
| Swap | **none configured** — add a swapfile in runbook 03 if Postgres or build steps need headroom |
| Disk | single 251 GB volume on `/dev/vda3` mounted at `/` (1.2 GB used, 240 GB free) |
| Timezone | `Europe/Berlin` (CEST, +0200) |
| NTP | active, system clock synchronized |
| Machine ID | `a675c57778f84b41bcdaccb9f7cc5214` |
| Bandwidth quota | check netcup invoice / control panel — not yet recorded |
| Backup / snapshot policy | not yet configured at provider level — TBD in runbook 03 |
| Billing renewal date | TBD — record from netcup invoice |

### Network state (verified 2026-05-08)

| Field | Value |
|---|---|
| Firewall | **none active** — no `ufw`, empty `nftables` ruleset. Server is wide open at the OS level; only SSH is actually listening. Hardening lands in runbook 03. |
| Listening ports | `tcp/22` (sshd) on both IPv4 and IPv6 — nothing else |
| rDNS (IPv4) | `v2202605356582457645.nicesrv.de` (provider default; change via netcup panel before sending email from this host) |
| rDNS (IPv6) | **not set** — set this too if outbound mail is ever needed |
| Provider control panel | netcup SCP / CCP — URL: `https://www.servercontrolpanel.de/` (login from invoice email) |

### Runbooks completed
- [x] [`01-provision-vps`](./runbooks/01-provision-vps.md) — purchased & received credentials 2026-05-08
- [x] [`02-ssh-bootstrap`](./runbooks/02-ssh-bootstrap.md) — key installed and verified 2026-05-08; `ssh vps-eu` works passwordlessly
- [x] [`03-harden-server`](./runbooks/03-harden-server.md) — ufw + fail2ban + unattended-upgrades 2026-05-08
- [x] [`04-install-docker`](./runbooks/04-install-docker.md) — Docker 29.4.3 + Compose v5.1.3 2026-05-08
- [x] [`05-deploy-app`](./runbooks/05-deploy-app.md) — production stack live at `https://teno-store.com` 2026-05-08; Let's Encrypt certs issued for apex / www / api

### Notes / quirks

- **OpenSSH KEX mismatch:** server runs OpenSSH 10 which defaults to the post-quantum `sntrup761x25519-sha512@openssh.com` KEX. Windows OpenSSH 9.5 doesn't support that. The `Host vps-eu` block in `~/.ssh/config` pins `KexAlgorithms curve25519-sha256` to make it work. Linux/macOS clients on OpenSSH 9.6+ don't need this.
- **Provider hostname is auto-generated and ugly** (`v2202605356582457645.nicesrv.de`). We never use it directly — always `vps-eu` or the IP.
- **arm64, not x86_64.** Cheaper at netcup but means our Docker images must target `linux/arm64`. Easiest path: build with `docker buildx build --platform linux/arm64,linux/amd64 --push ...` so the same tag works on local x86 dev machines too.
- **Bootstrap gotcha (don't repeat):** when generating the SSH key on Windows, use `-N ""` (PowerShell empty string), **not** `-N '""'` — the latter sets the literal two-character string `""` as the passphrase. Symptom: `Server accepts key` then immediate `Permission denied` because the client can't sign without the passphrase. Fix: `ssh-keygen -p -f <key> -P '""' -N ""`. Already corrected on `vps-eu_ed25519`.
