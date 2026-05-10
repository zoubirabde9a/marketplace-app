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

## Scraper / catalog-seeding loop

The pipeline `scripts/scrape-ouedkniss.mjs` → `scripts/seed-from-scraped.mjs` is the standing way to grow the live catalog with real-world phone listings. It runs on `vps-eu` itself (this Windows machine can't always reach `api.teno-store.com` — see runbook 08), inside ad-hoc `node:22-alpine` containers attached to the `marketplace_default` docker network.

**Auth posture (as of 2026-05-10): `DEV_BYPASS=1` is on by default in production.** The seeder relies on that flag — it does not currently send DPoP. Reverting `DEV_BYPASS=0` will break the loop. See `deploy/CHANGELOG.md` 2026-05-10 for the security tradeoff.

**Operational env values** for the loop are in `.env.example` (committed) and on `vps-eu:/opt/marketplace/.env` (live). The relevant block:

- `MARKETPLACE_BASE=http://api:3100` — seeder target. Use the docker-network alias when running on the box; use `https://api.teno-store.com` only from a laptop.
- `SELLER_ID=019e08a4-97cd-7d98-afd7-670878dc51c2` — Smart Phone DZ. Get other UUIDs from `GET /v1/sellers`.
- `CATEGORY`, `PAGES`, `PAGE_SIZE`, `MAX_LISTINGS`, `MAX_AGE_DAYS`, `BATCH_PAUSE_MS` — scraper knobs (exact env names the scripts read).

These are NOT consumed by `docker-compose.prod.yml` (api/web/postgres/redis don't need them); they're sourced into the ad-hoc node containers at run time.

**Canonical run** — one script does everything (refresh skip-urls, scrape, seed, verify, log, retry):

```bash
ssh vps-eu /opt/marketplace/scripts/run-loop.sh \
  --seller-id 019e08a4-97cd-7d98-afd7-670878dc51c2
```

Source: `scraper/run-loop.sh` in the repo, deployed to `/opt/marketplace/scripts/run-loop.sh`. Run `--help` for the full option list. It orchestrates the underlying `scripts/scrape-ouedkniss.mjs` + `scripts/seed-from-scraped.mjs` mjs scripts in `node:22-alpine` containers on the `marketplace_default` network — no node runtime needed on the host.

Output:
- A single `OK pages=X..Y next=Z before=… after=… delta=… seeded=… dup=… invalid=… log=…` line on stdout (parseable for cron summaries). `pages` is the slice of Ouedkniss pages walked this run; `next` is what the next run will start from.
- Per-run human log: `/opt/marketplace/data/logs/run-YYYY-MM-DDTHH-MM-SSZ.log`.
- Append-only structured metrics: `/opt/marketplace/data/logs/metrics.jsonl` (one JSON object per run, including `start_page`, `last_page`, `has_more`, `next_start_page`).
- Page-progress state: `/opt/marketplace/data/run-loop-state.json` keyed by `<seller>-<category>` with `{next_start_page: N}`. Each successful run advances by `PAGES`; on `hasMorePages=false` the script wraps to 1 (full category re-walked from the top).
- Exit codes: 0 success, 2 bad args, 3 prereq missing, 4 scrape failed all retries, 5 seed failed all retries, 6 skip-urls refresh failed, 7 lock held (concurrent run).
- A flock-based lock (`run-loop.lock`) prevents concurrent runs.

Useful flags: `--reset-state` to re-walk from page 1, `--start-page N` to override one run, `--state-file PATH` to point at a different state file (e.g. for parallel runs).

If you ever need to invoke the underlying steps directly (debugging), see the source comments at the top of `scraper/run-loop.sh` — the script's docstring lists every option and the legacy 3-step pipeline it replaces.

**Gotcha**: `docker compose restart api` does NOT re-read `.env`; use `docker compose -f docker-compose.prod.yml up -d api` to recreate the container with new env. Documented at `deploy/CHANGELOG.md` 2026-05-10.

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
