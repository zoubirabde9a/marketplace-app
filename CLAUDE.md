# CLAUDE.md — agent operating notes

Notes for Claude (or any LLM agent) working in this repo. Humans should read [`README.md`](./README.md) instead.

## Production access — authorized

**You can SSH to the production server directly from this machine.** The operator has set this up; using it is the normal way to operate, not a privileged escalation.

```bash
ssh vps-eu '<command>'             # run any command
ssh vps-eu                          # open an interactive session
```

`vps-eu` is an SSH alias defined in `~/.ssh/config` on the operator's laptop (key: `~/.ssh/vps-eu_ed25519`). It resolves to the netcup VPS at `152.53.147.77`. The repo lives at `/opt/marketplace/` on the box. See [`deploy/protocols.md`](./deploy/protocols.md) and [`deploy/runbooks/02-ssh-bootstrap.md`](./deploy/runbooks/02-ssh-bootstrap.md) for the setup rationale.

**Use SSH freely for diagnostics** — `journalctl`, `docker compose ps/logs`, `ss`, `nstat`, `tcpdump` (install with `sudo apt-get install -y tcpdump` if missing), reading config files, etc.

**Confirm with the operator before running on vps-eu:**
- Anything destructive: `rm -rf`, `docker compose down`, `systemctl stop`, dropping DB tables, deleting volumes, force-pushing.
- Anything that changes the running app: `docker compose up -d`, image rebuilds, secret rotation, Caddyfile changes, fail2ban/ufw rule changes.
- Anything that touches user data in `marketplace-postgres`.

After any change to the server, append a one-line entry to [`deploy/CHANGELOG.md`](./deploy/CHANGELOG.md) (date · server · what · why).

## Local diagnostics

`scripts/probe-cf.mjs` — sample requests across Cloudflare edge IPs and surface slow paths. Use it to verify before/after any production change that touches networking.

```bash
node scripts/probe-cf.mjs --count 100
```

## Where things are

- App code: TypeScript monorepo under `packages/` (see [`ARCHITECTURE.md`](./ARCHITECTURE.md))
- Production state, runbooks, change log: [`deploy/`](./deploy/) — start at [`deploy/STATUS.md`](./deploy/STATUS.md)
- Server: `/opt/marketplace/` on `vps-eu`. Compose file: `docker-compose.prod.yml`. Secrets: `/opt/marketplace/.env` (NOT in repo, do not overwrite via tar-deploy).
- DNS / Cloudflare: see [`deploy/dns.md`](./deploy/dns.md). Dashboard access requires the operator's login.

## What you cannot do from this session

- Cloudflare dashboard (DNS records, SSL/TLS mode, Bot Fight Mode, Page Rules, cache rules) — operator has to do it.
- Open netcup support tickets — operator has to do it.
- Google Search Console / Bing Webmaster — operator has to do it.

When something needs one of these, write up exactly what change to make and why, and surface it for the operator.
