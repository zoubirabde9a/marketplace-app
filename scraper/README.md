# Scraper

Pulls real-world product data from Algerian classifieds (currently just
**Ouedkniss**) and feeds it into the marketplace catalog under one of our
synthetic sellers.

This folder is the **source of truth** for the scrape-and-seed pipeline. The
files here are mirrored to `/opt/marketplace/scripts/` on `vps-eu`, where
they're driven by a systemd timer once a minute.

---

## TL;DR — operating the live loop

```bash
# What is it doing right now?
ssh vps-eu /opt/marketplace/scripts/status.sh

# Live-tail per-run metrics
ssh vps-eu /opt/marketplace/scripts/status.sh --tail

# Run one iteration manually (for debugging — not normally needed)
ssh vps-eu /opt/marketplace/scripts/run-loop.sh --seller-id <UUID>

# Pause everything
ssh vps-eu sudo systemctl disable --now marketplace-scrape-loop.timer

# Resume
ssh vps-eu sudo systemctl enable --now marketplace-scrape-loop.timer

# Recent errors only
ssh vps-eu /opt/marketplace/scripts/status.sh --errors
```

---

## What it does, end to end

1. **Refresh the dedup skip-list** — dump every `attributes.sourceUrl` we
   already have for the target seller from Postgres into `data/skip_urls.txt`.
2. **Scrape** Ouedkniss's GraphQL `search` endpoint for the next slice of
   listings (page-progression state in `data/run-loop-state.json`). Captures
   title, description, price, images, posted date, city + wilaya — never
   seller phone or contact info.
3. **Seed** every listing whose `url` is *not* in the skip-list, by POSTing to
   the live API. Each becomes a product under the configured seller.
4. **Verify** by reading `/v1/products?limit=1` and reporting the
   before/after totals plus a structured JSONL metric.

The orchestration is a single bash script (`run-loop.sh`) with retries, a
flock lock, structured logging, and an exit code per failure mode. A systemd
timer fires it once a minute.

---

## Files in this folder

| File | Purpose |
|---|---|
| [`scrape-ouedkniss.mjs`](./scrape-ouedkniss.mjs) | GraphQL scraper. Walks `START_PAGE..START_PAGE+PAGES-1` of the category index via `api.ouedkniss.com/graphql`. Captures public listing fields (title, description, images, price, refreshedAt, city, region/wilaya). Writes `data/ouedkniss-<category>-<ts>.json` with `lastPageScraped`/`hasMorePages` so callers can advance. |
| [`seed-from-scraped.mjs`](./seed-from-scraped.mjs) | Reads a scrape JSON and POSTs each listing to `/v1/products` under `SELLER_ID`. Honours `SKIP_URLS_FILE` for dedup. Drops `source`/`sourceCategory` from attributes (only `sourceUrl` and `sourcePostedAt` are written, plus `city`/`wilaya` when scraped). |
| [`run-loop.sh`](./run-loop.sh) | One-shot orchestrator: refresh skip-urls → scrape → seed → verify → log → emit metric. Has retries, flock, page-progression state, distinct exit codes. **This is what cron / systemd actually invokes.** |
| [`status.sh`](./status.sh) | Operator tool: prints timer state, last N runs, aggregate stats, page-progression state, recent errors. Read-only. |
| [`README.md`](./README.md) | This file. |

---

## Where things live in production

| What | Path |
|---|---|
| Scripts | `/opt/marketplace/scripts/{scrape-ouedkniss,seed-from-scraped}.mjs`, `run-loop.sh`, `status.sh` |
| Per-run logs | `/opt/marketplace/data/logs/run-<RUN_ID>.log` |
| Structured metrics | `/opt/marketplace/data/logs/metrics.jsonl` (one JSON per run) |
| Skip-URL dump | `/opt/marketplace/data/skip_urls.txt` (regenerated each run) |
| Page-progression state | `/opt/marketplace/data/run-loop-state.json` |
| Lockfile | `/opt/marketplace/data/logs/run-loop.lock` (flock-protected) |
| Scrape JSONs (forensics) | `/opt/marketplace/data/ouedkniss-<category>-<ts>.json` |
| systemd unit | `/etc/systemd/system/marketplace-scrape-loop.service` |
| systemd timer | `/etc/systemd/system/marketplace-scrape-loop.timer` |
| Env (auth + scraper knobs) | `/opt/marketplace/.env` |

---

## How to check status

The fastest path is `status.sh`. From your laptop:

```bash
ssh vps-eu /opt/marketplace/scripts/status.sh
```

That prints:

1. **`[timer]`** — is the systemd timer active? When does it next fire?
2. **`[service — last invocation]`** — last journal line, exit code, result.
3. **`[recent runs]`** — last N rows of `metrics.jsonl` as a table:
   ```
   ts  pages  next  seeded  dup  invalid  before→after  delta
   ```
4. **`[aggregate]`** — total runs, total seeded / dup / invalid, idle runs
   (seeded=0), api total before→after.
5. **`[page-progression state]`** — what `next_start_page` will be on the
   next run, per `<seller>-<category>` key.
6. **`[errors in recent run logs]`** — any `[error]` / `[warn]` /
   `exit_code=N (N≠0)` line from the last 20 runs.

Flags:

- `-n 30` — show 30 recent runs instead of 10.
- `--errors` — show only failed (`seeded=0`) runs in the recent-runs table.
- `--tail` — `tail -F` the `metrics.jsonl` file. Live stream of every run.

For raw systemd / journal access:

```bash
# Timer state, next fire
ssh vps-eu sudo systemctl status marketplace-scrape-loop.timer

# Last N service invocations (oneshot, so each run is its own activation)
ssh vps-eu sudo journalctl -u marketplace-scrape-loop.service -n 50 --no-pager

# Live-follow journal
ssh vps-eu sudo journalctl -u marketplace-scrape-loop.service -f
```

For raw structured metrics:

```bash
ssh vps-eu cat /opt/marketplace/data/logs/metrics.jsonl
```

Each line is a JSON object with at minimum:
`ts, run_id, seller_id, category, start_page, last_page, has_more,
next_start_page, before, after, delta, seeded, dup_skipped,
invalid_skipped, scrape_listings, skip_urls_count`.

For a deep dive into a specific run, the per-run log has every line of
scraper + seeder output:

```bash
ssh vps-eu cat /opt/marketplace/data/logs/run-2026-05-10T13-52-05Z.log
```

---

## Exit codes

`run-loop.sh` returns the following so cron / systemd / monitoring can react:

| Code | Meaning |
|---|---|
| 0 | Success (any non-error outcome — `delta=0` is fine, just means dedup ate the run) |
| 2 | Bad CLI arguments |
| 3 | Prereqs missing (docker, api/postgres container, network, env file) |
| 4 | Scrape failed all retries (transient — Ouedkniss 5xx, rate limit, etc.) |
| 5 | Seed failed all retries |
| 6 | Skip-urls Postgres dump failed all retries |
| 7 | Lockfile held — another instance is running. Not fatal; the next timer fire will have its own try. |

For systemd:
- `Result=success` + `ExecMainStatus=0` → all good.
- `Result=exit-code` + `ExecMainStatus=N` (N≠0) → look at the per-run log
  AND `journalctl -u marketplace-scrape-loop.service -p err`.

---

## Configuration

CLI args on `run-loop.sh` override env, env overrides defaults.

| Arg / env | Default | Meaning |
|---|---|---|
| `--seller-id` / `SELLER_ID` | (required) | UUID of the seller new products attach to |
| `--category` / `CATEGORY` | `telephones` | Ouedkniss category slug |
| `--pages` / `PAGES` | `2` | Pages walked per iteration |
| `--max-listings` / `MAX_LISTINGS` | `50` | Hard cap on listings seeded per iteration |
| `--base` / `MARKETPLACE_BASE` | `http://api:3100` | Where seeder POSTs |
| `--start-page` | (state file) | Override the next page to scrape |
| `--reset-state` | `false` | Force `next_start_page=1` for this seller+category |
| `--state-file` | `data/run-loop-state.json` | Override the state file path |
| `--no-dedup-refresh` | `false` | Reuse existing `skip_urls.txt`, skip the psql dump |
| `--reuse-recent-scrape` | `false` | Reuse a scrape file from this UTC minute (cron retry hint) |
| `--dry-run` | `false` | Scrape only, don't seed |
| `--scrape-retries` | `3` | |
| `--seed-retries` | `2` | |
| `--quiet` | `false` | Suppress the `OK …` summary on stdout (used by systemd) |
| `--log-dir` | `data/logs` | |
| `--help` | | Show full usage |

Scraper-only env (read by `scrape-ouedkniss.mjs`, passed via `docker --env-file`):

| Env | Default | Meaning |
|---|---|---|
| `START_PAGE` | `1` | First page to scrape |
| `PAGES` | `1` | Pages walked |
| `PAGE_SIZE` | `48` | Items per page (max 48 enforced by Ouedkniss) |
| `MAX_LISTINGS` | `200` | Hard cap |
| `MAX_AGE_DAYS` | `3` (overridden to `0` by run-loop) | Drop listings older than N days; `0` disables |
| `BATCH_SIZE` | `10` | Items between log lines |
| `BATCH_PAUSE_MS` | `4000` | Pause between page requests (politeness) |

Seeder-only env (read by `seed-from-scraped.mjs`):

| Env | Default | Meaning |
|---|---|---|
| `MARKETPLACE_BASE` | `http://127.0.0.1:3100` | Base URL for `/v1/products` |
| `SELLER_ID` | (required) | UUID |
| `SESSION_JWT` | (none) | Bearer token; only needed if `DEV_BYPASS=0` |
| `SKIP_URLS_FILE` | (none) | Newline-delimited file of `sourceUrl`s to skip |

---

## Auth posture

Production currently runs with `DEV_BYPASS=1` set in `/opt/marketplace/.env`,
so the seeder doesn't need a session token or DPoP-bound passport. This was
an explicit operator decision (logged in `deploy/CHANGELOG.md` 2026-05-10) to
avoid juggling per-iteration auth.

**Security implication**: anyone who can reach `https://api.teno-store.com`
can `POST /v1/products` and act as any principal via arbitrary `x-mp-*`
headers. To revert: set `DEV_BYPASS=0` in `.env`, run
`docker compose -f docker-compose.prod.yml up -d api` (NOT `restart` — that
doesn't re-read `.env`), then either pass `SESSION_JWT=...` to the seeder or
issue an agent passport.

---

## Common operations

### Pause the loop

```bash
ssh vps-eu sudo systemctl disable --now marketplace-scrape-loop.timer
```

### Resume

```bash
ssh vps-eu sudo systemctl enable --now marketplace-scrape-loop.timer
```

### Re-walk the category from page 1

The loop progressively walks pages and wraps when Ouedkniss says
`hasMorePages=false`. To force a fresh walk from the top:

```bash
ssh vps-eu /opt/marketplace/scripts/run-loop.sh \
  --seller-id <UUID> --reset-state
```

### Try a single page slice

```bash
ssh vps-eu /opt/marketplace/scripts/run-loop.sh \
  --seller-id <UUID> --start-page 100 --pages 4
```

The state file is still advanced afterwards (next run resumes correctly).

### Update the scripts

Source of truth is this folder. To deploy a change:

```bash
cd /your/local/checkout/scraper
scp run-loop.sh status.sh scrape-ouedkniss.mjs seed-from-scraped.mjs \
  vps-eu:/tmp/
ssh vps-eu '
  sudo install -m 0755 /tmp/run-loop.sh   /opt/marketplace/scripts/run-loop.sh
  sudo install -m 0755 /tmp/status.sh     /opt/marketplace/scripts/status.sh
  sudo install -m 0644 /tmp/scrape-ouedkniss.mjs   /opt/marketplace/scripts/scrape-ouedkniss.mjs
  sudo install -m 0644 /tmp/seed-from-scraped.mjs  /opt/marketplace/scripts/seed-from-scraped.mjs
'
```

The systemd timer keeps firing during deploy; the lockfile prevents the
in-flight iteration from overlapping with a freshly-deployed one.

### Clean up old scrape JSONs

`data/ouedkniss-<category>-<ts>.json` accumulates one file per iteration (~1
per minute) and is kept for forensics. To reclaim space:

```bash
ssh vps-eu 'sudo find /opt/marketplace/data \
  -maxdepth 1 -name "ouedkniss-*.json" -mtime +7 -delete'
```

`metrics.jsonl` and per-run `.log` files do not currently rotate either.
Suggest setting up `logrotate` if/when retention becomes a concern.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `status.sh` says timer not active | systemd disabled or unit missing | `systemctl status marketplace-scrape-loop.timer`; reinstall unit if missing |
| Many `seeded=0 dup_skipped=50` runs | Page-1 saturated and state stuck at low `next_start_page` | Check `run-loop-state.json`; the loop should auto-advance — if it doesn't, look for `[error]` lines in recent run logs |
| `before=N after=0 delta=-N` historical | api container was being recreated mid-run | The hardened `api_total_estimate` (post-2026-05-10) now retries and emits `null`/`?` instead of misleading values |
| Service exits 4 (scrape failed) repeatedly | Ouedkniss rate-limited or returned 5xx | Check the per-run log for the actual response body; bump `BATCH_PAUSE_MS` if it's a 429 |
| Service exits 5 (seed failed) repeatedly | API down, `DEV_BYPASS=0` after a deploy, schema validation reject | Per-run log shows the 4xx/5xx body verbatim |
| `marketplace-api not running` (exit 3) | Operator deploy left the container with a Docker-prefixed name (`<id>_marketplace-api`) | `docker rename <id>_marketplace-api marketplace-api`; consider a clean `docker compose -f docker-compose.prod.yml up -d api` |
| Iteration hits 141 (SIGPIPE) | Was a bug pre-2026-05-10 with `ls -t … \| head -1` against a large data dir; replaced with `sed -n '1p'`. Should not recur. | If it does, check what new pipe was introduced. |
| `delta=0` every run despite `seeded=N>0` | API's `pagination.totalEstimate` is approximate / lazy. Real DB count is correct. | Use `psql -c "SELECT count(*) FROM catalog.products WHERE seller_id='…'"` for an exact number. |

---

## Architecture diagram

```
┌────────────────────────────────────────────────────────┐
│  vps-eu (host)                                         │
│                                                        │
│  systemd timer (every minute, 10s jitter)              │
│       │                                                │
│       ▼                                                │
│  marketplace-scrape-loop.service (oneshot)             │
│       │                                                │
│       ▼                                                │
│  /opt/marketplace/scripts/run-loop.sh                  │
│       │ ─ flock lock                                   │
│       │ ─ retries (psql ×2, scrape ×3, seed ×2)        │
│       │                                                │
│       ├── docker exec marketplace-postgres psql ──→ skip_urls.txt
│       │                                                │
│       ├── docker run node:22-alpine \                  │
│       │     -v /opt/marketplace:/work \                │
│       │     -e START_PAGE=N -e PAGES=2 …               │
│       │     scrape-ouedkniss.mjs ──→ data/ouedkniss-*.json
│       │                                                │
│       ├── docker run node:22-alpine \                  │
│       │     -e SKIP_URLS_FILE=/work/data/skip_urls.txt │
│       │     -e SELLER_ID=… -e MARKETPLACE_BASE=…       │
│       │     seed-from-scraped.mjs                      │
│       │              │                                 │
│       │              ▼                                 │
│       │       marketplace-api  (POST /v1/products …)   │
│       │              │                                 │
│       │              ▼                                 │
│       │       marketplace-postgres (catalog.products)  │
│       │                                                │
│       └── update run-loop-state.json (next_start_page) │
│           append metrics.jsonl                         │
│           write per-run run-<RUN_ID>.log               │
└────────────────────────────────────────────────────────┘
```

---

## Legal & privacy posture

Ouedkniss's terms of service prohibit automated harvesting of seller contact
details. Running this against real sellers can implicate:

- (a) **Ouedkniss ToS**,
- (b) **Algerian Law 18-07** on protection of personal data,
- (c) **GDPR** if any listed seller is in the EU.

Mitigations baked into `scrape-ouedkniss.mjs`:

- The GraphQL query **deliberately omits** `user`, `phone`, `whatsapp`, and
  any field that ties a listing to a real seller's identity. We capture
  `cities { id name region { id name } }` for location context only.
- Scraped listings are reattached to **our** synthetic seller (currently
  "Smart Phone DZ — Alger Centre"), not to the real Ouedkniss seller.
- `BATCH_PAUSE_MS` (default 4s when called directly, 2s when called via
  run-loop's `.env`) keeps request volume polite.

`scraper/scrape-ouedkniss.mjs:13–17` documents this posture inline; if the
field set ever needs to grow (e.g. to capture `phone` for some legitimate
reason), the legal review must happen first.
