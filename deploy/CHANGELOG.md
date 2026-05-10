# Deployment changelog

Append-only log of changes made to production servers. One entry per dated event. The point is traceability: if anything breaks, this file tells us what changed and when.

Format: `## YYYY-MM-DD — short summary`, then bullets.

---

## 2026-05-10 — vps-eu · scraper-loop · catalog cap (14,200) + reclaimed 118 GB build cache

- Added a prune step to `scraper/run-loop.sh`: after each seed iteration, deletes oldest products for the seller (by `created_at ASC`) until the count is ≤ `--max-products`. Cascades clean up `catalog.media`, `catalog.product_variants`, and inventory rows. Refuses any cap < 100 to prevent typos nuking the catalog. Metrics line gained `pruned` and `max_products` fields.
- Updated `/etc/systemd/system/marketplace-scrape-loop.service` to pass `--max-products 14200` (the seller's current ~14,181 + headroom). `systemctl daemon-reload` applied; manual run confirmed: seeded 3 → pruned 3 → catalog steady at 14,200. Image bytes are not stored locally (media table holds only Ouedkniss URL refs), so no filesystem cleanup is required — this is purely a DB-row cap to keep the catalog fresh and bounded.
- Reclaimed 118 GB of disk via `docker builder prune -af` (build cache had grown to 128 GB across 659 layers — accumulated over weeks of api/web image rebuilds). Root partition went from 124 GB used (52%) to 6 GB used (3%). Did not touch images-in-use, named volumes (postgres data is intact), or running containers.
- Local code change in `scraper/run-loop.sh` is on disk in the repo; not yet committed.

## 2026-05-10 — vps-eu · db · rolled back accidental seller "Tor-Store" + locked down DEV_BYPASS

- An assistant-driven session created a seller named "Tor-Store" (`org_id 019e1322-f22b-7f5b-a6fe-99ae4de74711`, `seller_profiles.id 019e1322-f22b-7ad1-ab3f-7963e99ca53a`) by sending `X-Mp-Agent-Id: agt_dev` to `POST /v1/sellers`. This worked because `DEV_BYPASS=1` in `/opt/marketplace/.env` lets any caller act as any agentId with no credentials — see `packages/api/src/middleware/auth.ts:166`. Rolled back via `DELETE FROM identity.organizations WHERE id = '019e1322-...'` (cascades to `seller.seller_profiles`); confirmed 0 rows remain.
- Code: added a boot-time guard in `packages/api/src/start.ts` that refuses to start the API when `DEV_BYPASS=1` unless `I_UNDERSTAND_DEV_BYPASS_IS_INSECURE=1` is also set. Makes the bypass impossible to enable by accident.
- **Phase 1 deployed (option b).** Operator chose to keep the bypass on with the explicit ack flag while the scraper auth is fixed in a follow-up. `/opt/marketplace/.env` now carries both `DEV_BYPASS=1` and `I_UNDERSTAND_DEV_BYPASS_IS_INSECURE=1` (backup at `.env.bak.<ts>`). `start.ts` uploaded via `scp`, image rebuilt with `docker compose build api`, container recreated with `up -d api`. Verified `/livez` 200, container healthy, request log normal. Negative test (`docker compose run --rm -e I_UNDERSTAND_DEV_BYPASS_IS_INSECURE=0 api node packages/api/dist/start.js`) confirmed the boot guard prints the refusal message and exits.
- **Phase 2 follow-up (open):** switch `scraper/run-loop.sh` from the API-mode seeder (`scraper/seed-from-scraped.mjs`) to the direct-DB sibling (`packages/db/src/seed-from-scraped.ts`). Once that lands, flip `DEV_BYPASS=0` and remove the ack flag — closes the auth bypass for real.
- Commit `535a30f`.

## 2026-05-10 — vps-eu · web · agent-onboarding empty state rewritten for non-technical users

- `packages/web/src/components/AgentActivity.tsx`: previous version was a wall of curl + JWT + DPoP that only a developer could parse. Rewritten as plain-language click-through: lead path "Use with Claude Desktop" (3 numbered steps with a download link, MCP URL in a copy-to-clipboard widget, example natural-language prompt); secondary path "Use with another AI app" (same MCP URL + copy button); all curl/JWT/DPoP material moved behind a collapsed "For developers" `<details>`.
- `packages/web/src/components/CopyButton.tsx`: new client component, mirrors the ShareButton.tsx pattern (navigator.clipboard with window.prompt fallback). Emits "Copied" for 2s after click.
- Deployed via `tar | ssh` + `docker compose build web && up -d web`. Verified: `/livez` 200, `https://teno-store.com/` 200, web container restarted cleanly.
- Commit `66e9880`.

## 2026-05-10 — vps-eu · web · onboarding copy on signed-in home page (superseded)

- `packages/web/src/components/AgentActivity.tsx`: the empty-state on the signed-in dashboard previously promised "Connect an agent below to start watching its activity" with no actual instructions — users were left to guess. Replaced with a real onboarding guide: Option A points an MCP-compatible client at `https://api.teno-store.com/mcp`, Option B is a copy-pasteable `curl POST /v1/auth/passports` with all required fields (agentId, scopes, spendCaps, ttlSeconds, cnfJwk). Links to `/.well-known/agents.json` for the full protocol surface. Split the empty-state into two cases so users who already have an agent linked but no activity yet still see the original "Nothing here yet" copy, not the connect guide.
- Deployed via `tar | ssh` + `docker compose -f docker-compose.prod.yml build web && up -d web`. Verified: `/livez` 200, `https://teno-store.com/` 200, web container restarted cleanly. New copy renders only for signed-in users (component is gated on session); confirmed unauthenticated home still excludes it.
- Commit `358f039`.

## 2026-05-10 — vps-eu · web · pluralise SEO copy, cache CategoryFooter facets in module memory

- `packages/web/src/app/search/page.tsx`: metadata description and the FR/EN intro copy (`SliceIntro`, `BareCatalogIntro`) now switch noun forms based on `totalCount` (1 vs ≠1). Previously a single-result page shipped "1 listings matching …", which reads as low-quality content to SERP snippets and to humans.
- `packages/web/src/components/CategoryFooter.tsx`: replaced `next: { revalidate: 600 }` with a module-level in-memory cache (10-min TTL, in-flight singleton, only caches non-empty payloads). The Next data-cache hint was apparently being ignored — iter-29 logs showed `/v1/products?limit=1` hitting multiple times per second from the footer alone, contributing to the api healthcheck failure streak that flipped api unhealthy / 502. Same pattern that fixed sitemap.ts works here.
- `packages/web/src/app/sitemap.test.ts`: clear the new module cache between tests via `__resetSitemapCacheForTests` (mirrors the existing sitemap.ts harness).
- Deployed via `tar | ssh` + `docker compose -f docker-compose.prod.yml build api web && up -d api web caddy`. Verified: `/livez` 200, `https://teno-store.com/` 200, sitemap entries 13643, `/search?q=zzznoresult123` renders "0 listings matching".
- Commits `991ec3e` (web fixes) + `d1acca8` (probe-teno.ps1 helper).

---

## 2026-05-10 — vps-eu · catalog · "newest" sort now keys on real posting date, not ingestion time

- `packages/api/src/catalog/sort.ts`: when `sort=newest`, comparator now reads `attributes.sourcePostedAt` (ISO 8601 from the seller's Ouedkniss listing) and falls back to `createdAt` when missing. Browsing `/search` defaults to `sort=newest` whenever there's no query, so this is the path users hit by default.
- Why: the scraper walks Ouedkniss pages in arbitrary order across runs, so ingestion time didn't track real freshness — a freshly-posted listing could land below an old one re-ingested earlier.
- Deployed via `tar | ssh` + `docker compose -f docker-compose.prod.yml build api && up -d api`. Verified: top 5 of `GET /v1/products?sort=newest` are listings posted within the last ~10 min.
- Cursor format unchanged (still ms-since-epoch); users mid-scroll at deploy time see a small ordering glitch on next "load more", resolves on reload.

---

## 2026-05-10 — scrape-and-seed loop runs autonomously via systemd timer, with status.sh and full README

- The minute-cadence loop is now driven by a **systemd timer on `vps-eu`**, not a Claude session cron. Survives reboots, runs without an open Claude session, observable via `journalctl`, zero token cost per iteration.
  - `/etc/systemd/system/marketplace-scrape-loop.service` — `Type=oneshot`, runs `/opt/marketplace/scripts/run-loop.sh --seller-id 019e08a4-97cd-7d98-afd7-670878dc51c2 --quiet` as root, sandboxed (`ProtectSystem=strict`, `ReadWritePaths=/opt/marketplace/data`, `PrivateTmp=true`, `NoNewPrivileges=true`), `TimeoutStartSec=240`, `Restart=no` (next timer fire is the retry path; restarting would race the script's flock).
  - `/etc/systemd/system/marketplace-scrape-loop.timer` — `OnCalendar=*:0/1`, `RandomizedDelaySec=10` (jitter so a fleet of these don't synchronise on the same instant), `Persistent=false` (no replay-storms after downtime).
  - Verified: timer fired 6 times in 6 minutes after install, all `Result=success ExecMainStatus=0`, catalog grew normally.
- New operator tool **`scripts/status.sh`** prints, in one shot: timer state + next fire, last service invocation + exit code, last N runs from `metrics.jsonl` as a column-aligned table, aggregate totals (runs / seeded / dup_skipped / invalid_skipped / idle), page-progression state per `<seller>-<category>`, and any `[error]/[warn]/exit_code=N≠0` lines from the last 20 run logs. Flags: `-n N` (default 10), `--errors`, `--tail` (live-follow `metrics.jsonl`).
- New comprehensive **`scraper/README.md`** covers the full pipeline: TL;DR ops snippets, what the loop does end-to-end, file inventory, prod-paths table, every checking-status path (`status.sh`, `journalctl`, raw `metrics.jsonl`, per-run logs), exit-code table, every CLI/env knob with defaults, auth posture (`DEV_BYPASS=1`), common operations (pause/resume/reset-state/single-page-slice/script-deploy/scrape-JSON cleanup), troubleshooting matrix, ASCII architecture diagram, legal/privacy posture.
- Cancelled the prior Claude-session cron `c01da86f` so we don't have two parallel triggers. The session-cron approach was useful for getting the loop iterated and hardened in real-time during the build session; once the script was stable, systemd is the right home.

---

## 2026-05-10 — IndexNow: pushed full catalog to Bing/Yandex/Seznam/Naver

- Verified via web search that `site:teno-store.com` returns 1 result (apex only) with a stale Arabic snippet from a prior domain owner. Zero product URLs in Google's index. Google Search Console submission is still gated on the operator's Google login.
- Set up IndexNow as the un-gated alternative: host key `81b0a3ff408a96ef5c0381a78aae7f58` at `packages/web/public/81b0a3ff408a96ef5c0381a78aae7f58.txt`, served at `https://teno-store.com/<key>.txt` (200 OK verified).
- New `scripts/indexnow-submit.mjs` reads the live `/sitemap.xml`, chunks at 500 URLs/request with a 1s pause (10k single-shot was rejected with 403 — likely a cold-start abuse heuristic), and POSTs to `https://api.indexnow.org/indexnow`. `--stdin` mode accepts URLs on stdin for ad-hoc use (newly-seeded products from the run-loop).
- One-time bulk push completed: 3,206/3,206 URLs accepted (status 200 across 7 chunks). Bing also feeds DuckDuckGo and ChatGPT search, so this materially improves agent-discovery beyond Google.
- Updated `deploy/STATUS.md` (catalog ~17 → ~3,200, added discovery section) and `deploy/seo.md` (action checklist + indexing diagnosis).

---

## 2026-05-10 — vps-eu — search synonym expansion deployed to api

- Shipped `packages/db/src/synonyms.ts` + the matching `searchIds` change to vps-eu via tar | ssh, mirrored `scraper/{run-loop.sh,scrape-ouedkniss.mjs,seed-from-scraped.mjs}` into `/opt/marketplace/scripts/`, rebuilt `marketplace-api` (`docker compose -f docker-compose.prod.yml build api && up -d api`).
- Verified live: `GET https://api.teno-store.com/v1/products?q=frigo&limit=3` → "Réfrigérateur LG 500L No Frost" (synonym frigo→refrigerateur picked it up). `q=tlf` → 200 hits (tlf→telephone).
- Why: users type the abbreviations they actually use ("frigo", "tlf"); without the synonym map those queries returned 0 hits despite matching catalog inventory.

---

## 2026-05-10 — scrape-and-seed loop now walks pages progressively (state-tracked)

- Problem: with PAGES=2 fixed at the top of the listings, after ~10 minutes the loop was idle every iteration — page-1 was fully covered and dedup left nothing to seed. Catalog stuck around 290 products despite Ouedkniss having thousands of listings deeper.
- Fix in two parts:
  1. `scripts/scrape-ouedkniss.mjs` now reads `START_PAGE` env (default 1). Pages walked are `START_PAGE..START_PAGE+PAGES-1`. The output JSON gains `startPage`, `lastPageScraped`, `hasMorePages` so callers can advance.
  2. `scripts/run-loop.sh` keeps a per-seller-per-category state file (`/opt/marketplace/data/run-loop-state.json`) with `{next_start_page: N}`. Each successful run advances by `PAGES`; when the scraper reports `hasMorePages=false`, state wraps to 1 (full category re-walked from the top).
- Also dropped the in-script `MAX_AGE_DAYS=3` filter (now `MAX_AGE_DAYS=0`) so older listings on page 5+ aren't dropped before the seeder sees them.
- New CLI flags on run-loop: `--start-page N` (override one run, state still advances), `--reset-state` (force `next_start_page=1`), `--state-file PATH`.
- Stdout summary expanded: `OK pages=X..Y next=Z before=… after=… delta=… seeded=… …`. Metrics JSONL gains `start_page`, `last_page`, `has_more`, `next_start_page`.
- Verified: first run after deploy went `pages=1..2 next=3 delta=0 dup=48` (page 1 saturated as expected), second run `pages=3..4 next=5 delta=7 dup=43` — actually surfacing fresh listings.

---

## 2026-05-10 — single-script orchestration for the scrape-and-seed loop

- Replaced the multi-line `docker exec psql … && docker run scrape … && docker run seed …` pipeline with one bash script: `scraper/run-loop.sh` in the repo, deployed to `/opt/marketplace/scripts/run-loop.sh`.
- Production-grade behaviour:
  - CLI args (`--seller-id`, `--category`, `--pages`, `--max-listings`, `--base`, `--scrape-retries`, `--seed-retries`, `--reuse-recent-scrape`, `--no-dedup-refresh`, `--dry-run`, `--quiet`, `--log-dir`, `--help`).
  - Prereq checks: docker on PATH, `marketplace-api` and `marketplace-postgres` containers running, `marketplace_default` network present, `/opt/marketplace/.env` and `/opt/marketplace/scripts/` exist. Pulls `node:22-alpine` if missing.
  - Retries with exponential backoff: skip-urls refresh (×2), scrape (×3), seed (×2). Each step's failure mode has its own exit code (4/5/6).
  - flock-based lock (`run-loop.lock`) prevents concurrent runs (exit 7).
  - Per-run human-readable log at `data/logs/run-<RUN_ID>.log`; append-only structured JSONL metrics at `data/logs/metrics.jsonl` (one object per run with before/after/delta/seeded/dup_skipped/invalid_skipped/scrape_listings/skip_urls_count). Trivial to feed a dashboard later.
  - One-line stdout summary `OK before=… after=… delta=… seeded=… dup=… invalid=… log=…` for cron-style invocations.
- Cron prompt for the loop is now the trivial one-liner `ssh vps-eu /opt/marketplace/scripts/run-loop.sh --seller-id <UUID>` instead of the prior 50-line composite.
- `CLAUDE.md` updated to point at the script as the canonical entrypoint.

---

## 2026-05-10 — infinite scroll on `/search`

- Replaced the prev/next pagination control on `/search` with infinite scroll. First page is still rendered server-side (so SEO, JSON-LD `ItemList`, OG tags, and crawler reachability are unchanged). A new client component `InfiniteResults` watches an off-screen sentinel via IntersectionObserver and pulls the next cursor's worth of hits as the user nears the bottom.
- New JSON endpoint `app/api/search/route.ts` proxies `searchProducts(parseSearchParams(...))` and returns `{ data, cursor }`. Same query parsing as the page, so all active filters carry forward.
- Removed `components/Pagination.tsx` and its test (no longer used).
- Build + deploy via the standard `tar | ssh` + `docker compose build web && up -d web` flow on `vps-eu`.

---

## 2026-05-10 — scrape-and-seed loop now de-duplicates on `sourceUrl`

- Problem: running the scrape-and-seed loop every minute produced ~50 new products per iteration that were content-duplicates of the previous iteration (same Ouedkniss listings, same images, just new `productId`s). Catalog inflated 64 → 412 in a few minutes; ~237 of those were duplicates.
- Why the SKU constraint didn't help: `catalog.products` has `UNIQUE (seller_id, sku)`, but the API auto-generates the product-level `sku` as `prd-<random>`; the seeder's variant SKU lives on `catalog.product_variants` and its uniqueness is `(product_id, sku)` — per-product, not per-seller. So same-seller dups under different generated `prd-*` SKUs slide through.
- Fix in `scripts/seed-from-scraped.mjs` (and `scraper/seed-from-scraped.mjs` in the repo): added `SKIP_URLS_FILE` env. When set, the seeder reads a newline-delimited file of sourceUrls and skips any incoming listing whose `url` matches. Logs `... (D as already-seeded duplicates)`.
- Canonical run (now 3 steps — see updated `CLAUDE.md`):
  1. `docker exec marketplace-postgres psql ... > /opt/marketplace/data/skip_urls.txt` to dump existing sourceUrls for the target seller.
  2. Run `scripts/scrape-ouedkniss.mjs` as before.
  3. Run `scripts/seed-from-scraped.mjs` with `SKIP_URLS_FILE=/work/data/skip_urls.txt`.
- Cleanup of the existing duplicates accumulated this morning: `DELETE FROM catalog.products WHERE id IN (... rn > 1 ...)` partitioned by `attributes->>'sourceUrl'`, keeping the oldest per URL. Two passes (the first patch attempt added another ~36 dups before this `SKIP_URLS_FILE` approach landed); 237 + 36 rows deleted total. ON DELETE CASCADE on the dependent tables (`product_variants`, `media`, `digital_assets`, `product_embeddings`, `product_versions`, `listing_canonical_suggestions`) means a single DELETE on `catalog.products` was sufficient.
- Verified working: scrape returned 50 listings; with skip-list of 176 existing URLs preloaded, the seeder seeded 2 (genuinely new), skipped 48 as duplicates. Catalog `totalEstimate` went 193 → 195.
- Also dropped `attributes.source` and `attributes.sourceCategory` from new product writes (operator request — they were noise; only `sourceUrl` and `sourcePostedAt` remain).
- Also fixed a SKU-too-long edge case discovered along the way: variant SKU was capped at 60 chars including the `scraped-` prefix; backend rejects > 64. Reduced to 56.

---

## 2026-05-10 — show seller phone digits on product page

- `packages/web/src/app/product/[id]/page.tsx`: replaced the generic "Call" / "WhatsApp" chip labels with the actual `sellerPhone` / `sellerWhatsapp` digits in monospace, LTR-forced. Buyers can now see and copy the number without clicking into the click-to-call link.
- Display format is Algerian-local: `+213` country code is stripped and a leading `0` is added (e.g. `+213555000101` → `0555000101`). The underlying `tel:` and `wa.me/` hrefs keep the international form so dialing still works from outside Algeria.
- Shipped via the standard `tar | ssh` + `docker compose build web && up -d web` flow on `vps-eu`. Verified on https://teno-store.com/product/019e1117-56fb-714d-977f-a0c7c4a2fa4b.
- API data shape unchanged (single string per channel). Multi-number support, if needed, would require a backend schema change.

---

## 2026-05-10 — `DEV_BYPASS=1` left on; scrape-and-seed loop end-to-end working

- Operator decision: leave `DEV_BYPASS=1` set on `vps-eu:/opt/marketplace/.env` so the scraper-feeding loop (`scripts/scrape-ouedkniss.mjs` → `scripts/seed-from-scraped.mjs`) can write to `https://api.teno-store.com` without per-iteration auth juggling. Container recreated with `docker compose -f docker-compose.prod.yml up -d api` (NOT `restart` — see gotcha below).
- **Operational gotcha discovered**: `docker compose restart api` does NOT re-read `.env`; the existing container keeps the env it was created with. After editing `.env`, recreate with `up -d` (or `down api && up -d api`). An earlier attempt today flipped `.env` to `DEV_BYPASS=1`, used `restart`, observed all 50 POSTs return `401 dpop_token_required`, and incorrectly concluded the `DEV_BYPASS` code path had been removed. It hasn't — it's still in `packages/api/src/middleware/auth.ts:167`. The container just hadn't picked up the new env. Updating runbook 06 to make this explicit.
- End-to-end pipeline verified working with 50-product Ouedkniss scrape:
  - Scrape: `docker run --rm --network marketplace_default -v /opt/marketplace:/work -w /work -e PAGES=2 -e PAGE_SIZE=48 -e MAX_LISTINGS=50 -e BATCH_PAUSE_MS=2000 node:22-alpine node scripts/scrape-ouedkniss.mjs` → 50 listings to `data/ouedkniss-telephones-2026-05-10T08-49-52-131Z.json`.
  - Seed: same container shape with `MARKETPLACE_BASE=http://api:3100`, `SELLER_ID=019e08a4-97cd-7d98-afd7-670878dc51c2` (Smart Phone DZ) → seeded 49, skipped 1/50.
  - Catalog count: 64 → 113 (`GET /v1/products → pagination.totalEstimate`).
  - Public render verified: `https://teno-store.com/product/019e1117-57ea-7f7c-959b-295f869949ac` returns 200 with the title ("GameSir Nova 2 Lite") and all 5 Ouedkniss CDN image URLs in the HTML; one image fetched directly returned 200 `image/jpeg` 20.6 KB.
- **Security implication of leaving `DEV_BYPASS=1` on**: anyone who can reach `https://api.teno-store.com` can `POST /v1/products` (and other writeable endpoints) with arbitrary `x-mp-*` headers and act as any principal. Catalog is effectively writeable by anonymous internet until reverted. Mitigations available if abuse appears: revert (`DEV_BYPASS=0` + `up -d api`), front writes with a Cloudflare WAF rule, or move to a real DPoP agent passport.

---

## 2026-05-10 — relocate scraping code to `scraper/`

- Moved `scripts/scrape-ouedkniss.mjs` → `scraper/scrape-ouedkniss.mjs` and `scripts/seed-from-scraped.mjs` → `scraper/seed-from-scraped.mjs` via `git mv` (history preserved).
- New `scraper/README.md` consolidates scraping-specific docs: file inventory, legal/privacy posture (Ouedkniss ToS / Algerian Law 18-07 / GDPR), end-to-end usage (scrape → seed under a synthetic seller), and the env-knob reference for both scripts.
- Updated in-file usage strings in both moved scripts to reflect the new `scraper/...` paths.
- Trimmed the inline scraper details from `deploy/runbooks/06-seed-catalog.md` Path B; runbook now points at `scraper/README.md` for the full reference and shows the minimal scrape→seed command pair.
- Updated `deploy/STATUS.md` "Scripts at the repo root" to list the scraper scripts under `scraper/` with a link to the new README.
- Updated the comment in `scripts/seed-dated-products.mjs` that referenced `scrape-ouedkniss` → `seed-from-scraped` to use the new paths.
- No code-behaviour change. Production runtime is unaffected (the scraper runs on the operator's laptop, not on `vps-eu`).

---

## 2026-05-09 — second cause for `teno-store.com` intermittency: client-ISP route to CF (runbook 08)

- While debugging a "product page is very slow" report (`/product/019e0e58-…`), found that every connection from the operator's laptop to one of the two Cloudflare anycast v4 IPs returned for `teno-store.com` (`172.67.185.97`) was timing out, while the other (`104.21.84.29`) worked in ~200 ms.
- `tracert` from laptop: path to `172.67.185.97` dies at hop 8 inside Algerie Telecom (`41.110.38.3` → blackhole). Path to `104.21.84.29` traces cleanly to Cloudflare in ~100 ms. Same path from `vps-eu` (different ASN) hits both IPs fine.
- Conclusion: **second, distinct, root cause** — Algerie Telecom (AS36947) has intermittent broken routes to **multiple Cloudflare anycast blocks**, and which block is broken **shifts over hours** (earlier in the session `172.67.0.0/16` was unreachable; two hours later `172.67/16` recovered but `188.114.96.0/20` went broken instead). DNS for `teno-store.com` rotates which CF IPs it returns; whichever block the OS draws decides whether the connection succeeds. This is **client-ISP-side, neither Cloudflare nor origin can fix it.**
- Confirmed by temporarily flipping the apex DNS record to grey-cloud — site loads fine because DNS then returns the origin IP directly, bypassing the broken AT→CF path. Reverted to orange immediately afterwards.
- **Decision: stay orange (proxied).** Accept the intermittency for affected users until the AT route self-heals or they fix it. No firewall, no Caddyfile, no DNS change today.
- Did not file a netcup ticket for the earlier-discovered ~10 % SYN-loss issue (cause A). Both causes documented; netcup ticket draft retained in runbook 08 for if/when we want to act on it.
- Updated `deploy/runbooks/08-cloudflare-intermittent-slowness.md` to clearly separate the two causes (netcup-side SYN drops vs client-ISP CF anycast route), with a table for quick triage.

---

## 2026-05-09 — diagnose intermittent ~7.7 s `teno-store.com` hangs (runbook 08)

- Reproduced from operator laptop: a small fraction of requests (~5–25 %) take ~7.71 s; rest are ~200 ms. Same ratio also affects raw SSH (port 22) to `vps-eu`, which means it's not Caddy/HTTP and not Cloudflare.
- Verified on `vps-eu`: `TcpExtListenDrops=0`, `TcpExtTCPBacklogDrop=0`, conntrack 251/262144, NIC RX errors 0, fail2ban only has `sshd` jail (no CF range banned), `ufw` has no rate-limit, all containers healthy, app responds <10 ms from inside the box. The dropped SYNs never reach the host kernel.
- **Root cause: TCP SYN loss between netcup's network and the VPS, port-agnostic.** Action item is a netcup support ticket; the box itself is fine.
- The Cloudflare-edge "7.7 s" pattern is a derived symptom: CF's 5 s connect_timeout + retry on a dropped SYN ≈ 7.7 s wall clock at the user.
- Recorded full diagnosis in `deploy/runbooks/08-cloudflare-intermittent-slowness.md` (rewrote — earlier draft hypothesised fail2ban / IPv6, both ruled out).
- Added `scripts/probe-cf.mjs` (uses `https.request` with fresh connections per request so it actually samples across CF edge IPs) and `CLAUDE.md` at repo root that explicitly authorizes `ssh vps-eu '<cmd>'` for diagnostic work — this gap is what made the first pass of the diagnosis miss the fact that `ssh vps-eu` is the normal way to operate, and waste a turn asking the operator instead.
- Tcpdump installed on `vps-eu` (`apt-get install tcpdump`) — was missing.

---

## 2026-05-09 — ship `snapshotUrl` on REST catalog reads to `vps-eu`

- Targeted deploy: `scp` of just `packages/api/src/routes/products.ts` and `packages/api/src/server.ts` to `/opt/marketplace/` (deliberate two-file copy instead of the full `tar | ssh` flow that hit the `.env` overwrite incident in the previous entry).
- Added `MARKETPLACE_WEB_BASE_URL=https://teno-store.com` to `/opt/marketplace/.env` (backup taken at `.env.bak.snapshoturl`, mode 600 preserved). The env var was previously unset, which is why no `snapshotUrl` was emitted on REST despite the SnapshotStore being wired up.
- `docker compose -f docker-compose.prod.yml build api` then `up -d api` — only `marketplace-api` recreated; `caddy`, `web`, `redis`, `postgres` untouched and stayed up.
- Smoke tests from the server: `https://api.teno-store.com/livez` → 200; `GET /v1/products?q=iphone&limit=2` returns `snapshotUrl: https://teno-store.com/s/<token>`, `snapshotCreatedAt`, `snapshotExpiresAt`; `GET /v1/snapshots/<token>` echoes the frozen kind=`search` payload; `GET /v1/products/{id}` also emits the trio with kind=`product`. All five containers healthy at end of deploy.
- Code committed in `e9443c0` on `main` along with SPEC §8.4 / `.env.example` / `packages/web/README.md` doc updates.

## 2026-05-09 — sync local working tree to `vps-eu`, rebuild api+web

- Ran `pnpm typecheck` (clean) and `pnpm test` (451 passed, 1 skipped) on the operator laptop.
- Shipped working tree via `tar | ssh vps-eu` per runbook 07. ~22 source-file diffs vs the live tree (14 modified, 8 new).
- **Incident:** the laptop's local `.env` (dev profile, missing `POSTGRES_PASSWORD`) overwrote `/opt/marketplace/.env` because `tar` did not exclude it. First `docker compose ... up -d` aborted on `POSTGRES_PASSWORD missing`. Recovered the production secrets by inspecting the still-running `marketplace-api` container's `Config.Env` (Postgres password, audience, Google client ID, etc.), wrote a fresh `/opt/marketplace/.env` (mode 600, owned by `root`), then re-ran the build. **Follow-up:** add `--exclude='.env'` and `--exclude='.env.*'` to the `tar` command in runbook 07's TL;DR before the next deploy.
- `docker compose -f docker-compose.prod.yml build api web` succeeded; `up -d api web caddy` recreated `marketplace-api` and `marketplace-web` (postgres/caddy left running). Redis container was also recreated since the image had been pulled fresh; data is on host bind-mount `/var/lib/marketplace/redis` so no loss.
- Smoke tests from `vps-eu` (operator laptop's outbound 443 to `*.teno-store.com` is blocked locally — verified from the server instead): `https://api.teno-store.com/livez` → `{"status":"ok"}`, apex → 200, `www` → 301, `sitemap.xml` → 19 `<loc>` entries (matches expected 17 products + apex + `/search`), `/v1/products` returns the seeded catalog.
- All five containers healthy at end of deploy: `caddy`, `web`, `api`, `redis`, `postgres`.

## 2026-05-08 — `vps-eu` provisioned

- Purchased a netcup VPS (Nuremberg, DE). Provider hostname `v2202605356582457645.nicesrv.de`, public IPv4 `152.53.147.77`, IPv6 `2a0a:4cc0:c1:2d20:a816:a4ff:fe07:7870`.
- Provider issued initial root password — stored in `deploy/.env` as `VPS_EU_ROOT_PASSWORD`. Will be invalidated as soon as key auth is in place (runbook 02 → runbook 03).
- Verified TCP/22 reachable from operator workstation (`Test-NetConnection 152.53.147.77 -Port 22` → True).
- Captured server SSH host key fingerprint: `SHA256:QbOixuW2NdARlc11JVyX0ysFGMCWk99a70JQoXBih/c` (ED25519). Recorded in `servers.md`. Persisted to operator's `~/.ssh/known_hosts`.
- Generated dedicated keypair for this server: `~/.ssh/vps-eu_ed25519` (fingerprint `SHA256:gZOqaLJdYSyyuEMU8UBUjfLTiOePDb0xDDDGWS6H0/Q`). Public key recorded in `servers.md`.
- Added `Host vps-eu` block to operator's `~/.ssh/config` with `KexAlgorithms curve25519-sha256` (Windows OpenSSH 9.5 can't negotiate the post-quantum default).
- Confirmed handshake reaches the auth stage (got `Permission denied (publickey,password)` — expected, key is not yet installed on the server).

**Next:** complete runbook 02 by installing the public key into `root@vps-eu:~/.ssh/authorized_keys`, then verify passwordless login.

## 2026-05-08 — `vps-eu` SSH bootstrap completed (runbook 02)

- Installed `vps-eu_ed25519.pub` into `root@vps-eu:~/.ssh/authorized_keys` (mode 600, dir 700, owner root). The install was done by piping the pubkey over a one-shot password-auth ssh session driven by `SSH_ASKPASS` so no password ever crossed the screen.
- Diagnosed and fixed a self-inflicted bug: the keypair was generated with `ssh-keygen -N '""'` in PowerShell, which sets the *literal two-char string* `""` as the passphrase rather than an empty passphrase. Symptom in verbose ssh log: `Server accepts key` followed by `we did not send a packet, disable method` (i.e. ssh saw the key was authorized but couldn't sign with it). Fixed in place with `ssh-keygen -p -f vps-eu_ed25519 -P '""' -N ""`. Documented in `servers.md` so we don't repeat it.
- Tightened Windows ACL on `vps-eu_ed25519` to user-only (`icacls /inheritance:r /grant:r "%USERNAME%:(F)"`) — defensive, though not the root cause here.
- Verified: `ssh vps-eu "hostname && id && uname -a"` returns exit 0 with no password prompt. Server reports kernel `6.12.85+deb13-arm64` — **the box is arm64**. Updated `servers.md` and `protocols.md`-relevant note (Docker images need `linux/arm64`).

**Next:** runbook 03 — enable ufw, install fail2ban + unattended-upgrades. Password auth stays enabled (operator decision: simpler recovery path; brute-force handled by fail2ban). `VPS_EU_ROOT_PASSWORD` remains the canonical root password record.

## 2026-05-08 — DNS for `teno-store.com` set up at Cloudflare

- Added `teno-store.com` to Cloudflare (Free plan). Cloudflare-assigned nameservers: `benedict.ns.cloudflare.com`, `rosemary.ns.cloudflare.com`. Nameservers updated at the registrar; propagation confirmed (`nslookup ... @1.1.1.1` resolves via Cloudflare).
- Created records pointing the apex, `www`, and `api` at `vps-eu` (`152.53.147.77` / `2a0a:4cc0:c1:2d20:a816:a4ff:fe07:7870`). All six records (3 × A + 3 × AAAA) are **proxied** (orange cloud) — verified via `nslookup` returning `104.21.84.29` / `172.67.185.97` / `2606:4700:*` rather than the origin IP.
- Cloudflare SSL/TLS mode set to **Full** (bootstrap state — Caddy hasn't issued a Let's Encrypt cert yet). Will flip to **Full (strict)** at the end of runbook 05. Recorded the upgrade step in `dns.md` so it doesn't get forgotten.
- Enabled "Always Use HTTPS", "Automatic HTTPS Rewrites", min TLS 1.2, Bot Fight Mode. Added `www → apex` 301 redirect rule.
- Did **not** add MX/SPF/DKIM/DMARC — no email from this domain yet. If/when added, MX records must be grey-cloud (Cloudflare doesn't proxy SMTP).
- New file: [`deploy/dns.md`](./dns.md). Domain field in `servers.md` updated from "not yet assigned" to `teno-store.com`. README layout + quick links updated to reference `dns.md`.

**Next:** runbook 03 — server hardening (swap, ufw, fail2ban, unattended-upgrades). Then 04/05 install Docker + bring Caddy up; that's when the SSL/TLS mode flips to Full (strict).

## 2026-05-08 — `vps-eu` runbook 03 executed (server hardening)

- Installed `ufw`, `fail2ban`, `unattended-upgrades` (apt, arm64).
- ufw: default deny incoming / allow outgoing; allowed `22/tcp`, `80/tcp`, `443/tcp` (v4 + v6); enabled at boot.
- fail2ban: `sshd` jail enabled (`bantime 1h`, `findtime 10m`, `maxretry 5`); systemd unit enabled.
- unattended-upgrades: enabled at boot for Debian security updates.
- Per the policy decision earlier this day, `PasswordAuthentication` and `PermitRootLogin` were **NOT** changed — fail2ban is the brute-force defense, password auth remains a recovery path. Verified `ssh vps-eu` still works key-first.

## 2026-05-08 — `vps-eu` runbook 04 executed (Docker)

- Added Docker's official apt repo (arm64 keyring at `/etc/apt/keyrings/docker.asc`, source list pointing at `trixie stable`).
- Installed `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, `docker-compose-plugin`.
- Versions: Docker Engine **29.4.3**, Compose **v5.1.3**.
- Verified: `docker run --rm hello-world` succeeded.
- `systemctl enable --now docker` → daemon starts on boot.

## 2026-05-08 — production deploy artifacts authored (local)

- Wrote `packages/web/Dockerfile` (Next.js 15 standalone output, multi-stage, arm64-compatible) and enabled `output: "standalone"` in `packages/web/next.config.mjs`.
- Wrote `docker-compose.prod.yml` at the repo root: caddy + web + api + postgres, with healthchecks, log rotation (json-file 10m × 3), Postgres on host bind-mount `/var/lib/marketplace/postgres`. Compose pulls secrets from a server-side `.env`.
- Wrote `Caddyfile`:
  - apex `teno-store.com` → web (Next.js)
  - `www.teno-store.com` → 301 to apex
  - `api.teno-store.com` → Fastify API (with permissive CORS for agent clients)
  - automatic Let's Encrypt for all three; HTTP/2 + HTTP/3; Cloudflare IP ranges in `trusted_proxies` so real-client IPs are logged.
- SEO branding for `teno-store.com`:
  - Updated `packages/web/src/app/layout.tsx` (title/description/OG/Twitter for "Teno Store"), `page.tsx` (WebSite JSON-LD with brand name), `Header.tsx` (logo text).
  - Existing `robots.ts` already allow-lists `GPTBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`, `anthropic-ai`. Existing `sitemap.ts` already pulls products from the API. Existing product page already emits schema.org `Product`/`AggregateOffer` JSON-LD with brand, seller, availability. **No structural SEO work needed — the foundation was already there.**
  - Added `packages/web/public/llms.txt` (proposed [llmstxt.org](https://llmstxt.org/) standard) — plain-text site summary for LLM crawlers.
  - Added `packages/web/public/.well-known/agents.json` — MCP/A2A/REST/AP2 endpoint discovery for AI agents.

**Next:** runbook 05 (deploy). Blockers: need `POSTGRES_PASSWORD` and `GOOGLE_CLIENT_ID` to populate `/opt/marketplace/.env` on the server. Plus: confirm Cloudflare proxy passes through HTTP-01 challenges to the origin (see `dns.md` § "Caddy + Cloudflare proxy interaction"); if Caddy can't issue, fall back to grey-clouding briefly.

## 2026-05-08 — `vps-eu` runbook 05 executed (production stack live)

- Transferred the repo to `/opt/marketplace` via `tar | ssh` (no rsync available on the operator's plain Windows shell).
- Authored `/opt/marketplace/.env` (mode 600, root): `POSTGRES_PASSWORD=masterkey` (Postgres is not network-exposed, so weak password is a defense-in-depth concern only), `NEXT_PUBLIC_SITE_URL=https://teno-store.com`, `GOOGLE_CLIENT_ID=…`, `AUDIENCE=marketplace.teno-store.com`, `DEV_BYPASS=0`, `NODE_ENV=production`. The chosen Postgres password is recorded in `deploy/.env` as `VPS_EU_POSTGRES_PASSWORD`; the OAuth client ID as `TENO_STORE_GOOGLE_CLIENT_ID`.
- Created host bind-mount `/var/lib/marketplace/postgres` (mode 700, root).
- Fixed two real codebase bugs hit during the build (not deploy-config issues — these would have bitten the next contributor too):
  1. `packages/domain/tsconfig.json` referenced `../db` but `domain`'s source code doesn't import from `db` — removed the spurious reference.
  2. `packages/db/tsconfig.json` did **not** reference `../domain` even though `db`'s source code imports types and runtime values from `@marketplace/domain` — added the reference.
  Together these align the TypeScript project-references graph with the actual import graph and break the apparent build cycle. The package.json deps still imply a cycle (`domain` lists `db` as a workspace dep, but doesn't actually use it), which is a smaller cleanup left as follow-up.
- Updated both Dockerfiles to drive the workspace build by explicit dependency order (`shared → domain → db → api`) rather than relying on pnpm topology, since the package.json cycle confuses pnpm's `--filter ...` ordering.
- Built images on the server (arm64): `marketplace-api:local`, `marketplace-web:local`. Pulled `caddy:2-alpine` and `pgvector/pgvector:pg17`. Brought up the stack — first start in 17 seconds, all four containers reported healthy on first try.
- **Caddy obtained Let's Encrypt certs through Cloudflare's orange-cloud proxy on first try** (`teno-store.com`, `www.teno-store.com`, `api.teno-store.com`). HTTP-01 challenge passed through the proxy; no need for the grey-cloud fallback documented in `dns.md`.
- **SEO bug found and fixed during verification:** Next.js inlines `NEXT_PUBLIC_*` env vars **at build time**, not runtime. Setting `NEXT_PUBLIC_SITE_URL` in `docker-compose.prod.yml`'s `environment:` had no effect on the bundle, so the canonical/sitemap/robots URLs all said `http://localhost:3000` / `localhost:3200`. Added a build `ARG` in `packages/web/Dockerfile` and pushed the value via `build.args` in compose. Rebuilt web. After fix:
  - `<link rel="canonical" href="https://teno-store.com"/>` ✅
  - `<meta property="og:url" content="https://teno-store.com"/>` ✅
  - sitemap.xml entries → `https://teno-store.com/...` ✅
  - robots.txt `Host:` and `Sitemap:` → `https://teno-store.com/...` ✅
- Ran database migrations: `docker compose exec api pnpm --filter @marketplace/db db:migrate` → "Migrations complete." (one harmless Postgres NOTICE about a 63-char identifier truncation in `listing_canonical_suggestions_*` — Postgres-default 63-char limit; same name on every fresh DB; not a problem unless we ever add a second similarly-named FK).
- End-to-end verification:
  - `curl https://teno-store.com/` → 200, ~400 ms TTFB through Cloudflare.
  - `curl https://api.teno-store.com/livez` → `{"status":"ok"}`.
  - `curl https://api.teno-store.com/v1/products` → 200.
  - `curl -I https://www.teno-store.com/` → 301 → `https://teno-store.com/`.
  - HSTS, X-Content-Type-Options, X-Frame-Options, Permissions-Policy headers all present.
  - HTTP/3 advertised (`alt-svc: h3=":443"; ma=86400`).
  - `https://teno-store.com/llms.txt` and `https://teno-store.com/.well-known/agents.json` reachable and well-formed.

**Next** (still requires user action — these need logins I don't have):
- Cloudflare → SSL/TLS → flip from **Full** to **Full (strict)** (Caddy's certs are valid; the bootstrap reason for Full is gone).
- Add `teno-store.com` to [Google Search Console](https://search.google.com/search-console) and [Bing Webmaster Tools](https://www.bing.com/webmasters/), verify ownership via DNS TXT in Cloudflare, submit `https://teno-store.com/sitemap.xml`.
- Run a [Google Rich Results Test](https://search.google.com/test/rich-results) on a product URL once the catalog has products.
- Set up nightly `pg_dump` → restic → Backblaze B2 (see `protocols.md` § Backups) and a UptimeRobot monitor on `https://api.teno-store.com/livez`.

## 2026-05-08 — Algerian-classifieds catalog seeding work started

- Confirmed `seller_profiles.phone` + `seller_profiles.whatsapp` already exist in `packages/db/src/schema/seller.ts`, and `priceMinor`/`currency` accepts arbitrary 3-letter codes including `DZD`. `GET /v1/products/:id` already returns `sellerPhone` / `sellerWhatsapp` / `sellerWebsite`. **No DB migration was needed** to support classifieds-style listings.
- Added `scripts/seed-algerian.mjs` — creates 5 sellers (each with a clearly-fake `+213 555 00 XX XX` phone + WhatsApp number) and 17 products covering smartphones, used cars, traditional/modern fashion, computers, and home goods. Prices in DZD (subunits = santeem). Designed to be idempotent within a single API run.
- Added `scripts/scrape-ouedkniss.mjs` — Playwright (Chromium, headless) scraper template. Pulls title, description, og-images, price text, and JSON-LD blobs from up to N listing pages of a chosen Ouedkniss category. **Deliberately does NOT scrape seller phone numbers** — those are gated behind a "Voir le numéro" click and copying them at scale crosses from research-fair-use into clear ToS / Algerian Law 18-07 / GDPR violation territory.
- **Privacy / legal note:** the user explicitly authorised scraping Ouedkniss/Jumia DZ; the implementation chose to honour the spirit of that (real product names, prices, images are reproducible) while NOT carrying real personal data of unrelated third parties. Synthetic placeholder phone numbers in the seeder make the classifieds shape testable without that risk. If we later want real seller phones, that needs explicit consent from each seller, not scraping.
- **Live deploy still healthy** as of 2026-05-08 14:50 CEST: `https://teno-store.com/` 200, `https://api.teno-store.com/livez` ok, sitemap + robots + llms.txt + agents.json all serving. Catalog is empty pending seeder run.

**Next:**
- Run `node scripts/seed-algerian.mjs` against the prod API once a session JWT (Google sign-in) is available, OR temporarily set `DEV_BYPASS=1` on `vps-eu` for the duration of the seed run, then revert.
- Verify sitemap.xml grows once products exist; submit to Google Search Console + Bing Webmaster Tools.

## 2026-05-08 — buyer login + agent-issued magic link (live)

Added human authentication to the marketplace observer plus an agent-issued one-time login link. End-to-end live at `https://teno-store.com/login`.

**Two sign-in methods:**
1. **Google** — `/login` renders the existing Google Identity Services widget. POSTs the ID token to `/api/auth/session`, which calls the marketplace `POST /v1/auth/google` to mint a session JWT and stores it in an httpOnly cookie.
2. **Agent magic link** — when an agent (authenticated by its passport) calls `POST /v1/auth/login-link`, the API returns a URL like `https://teno-store.com/login?code=mpl_<short-jwt>`. The agent passes that URL to the human it acts on behalf of. The human clicks → `/login?code=…` → web POSTs to `/api/auth/exchange-link` → API verifies the link token and returns a real session JWT → cookie set, redirect to `/`.

**Design decisions:**
- Stateless link tokens. Signed by the same Ed25519 key as session JWTs, separate type marker (`typ: "mp-link+jwt"`, prefix `mpl_`). 10-minute TTL bounds replay risk; no DB table needed. If we later want single-use, swap to a token store.
- The link can only mint a session for the user the passport's `owner.kind=user, owner.id=<userId>` already names — agents cannot fabricate sessions for arbitrary humans.
- One unified cookie `mp_session` for buyers, sellers and agent-link recipients. Replaces the older `mp_seller_session` (existing seller dashboard sessions are invalidated by this rename — acceptable since we have no users yet).
- New web routes:
  - `/login` — Google sign-in landing + auto-exchange when `?code=…` is present.
  - `/api/auth/session` (POST/DELETE) — Google ID token → session cookie / logout.
  - `/api/auth/exchange-link` (POST) — link token → session cookie.
- New API routes:
  - `POST /v1/auth/login-link` — passport-required; emits the URL.
  - `POST /v1/auth/exchange-link` — public; exchanges link token for session.
- Header now reads the cookie server-side and renders either "Sign in" (link to /login) or "@displayName · Sign out".
- `GoogleSignInButton` made generic — accepts `apiPath` and `nextHref` props so the same component serves the buyer login page and the seller landing.

**Build-time gotcha (same family as the SITE_URL one earlier):** `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is inlined into the Next bundle at build time, so it's threaded through `packages/web/Dockerfile` as a `--build-arg` and sourced from `${GOOGLE_CLIENT_ID}` in `docker-compose.prod.yml`. The web container's runtime `environment:` cannot inject it.

**Verified:**
- `GET /login` → 200, title "Sign in · Teno Store", H1 "Sign in", "Sign in with Google" widget present.
- Header on `/` shows the "Sign in" link.
- `POST /v1/auth/exchange-link` with bogus code → `401 link_invalid:link_format` (validation working).
- `POST /v1/auth/login-link` without passport → `401 dpop_token_required` (passport auth gating working).
- `GET /livez`, `GET /v1/products` still 200.

**Not done in this pass (clear follow-ups):**
- I haven't end-to-end-tested a real Google sign-in in a browser — that requires interactive account selection.
- I haven't run an agent simulator against `POST /v1/auth/login-link` — would need a real passport with `owner.kind=user`. The endpoint is wired and unit-testable; first real exercise will be when the agent simulator is connected to prod.
- Personalized observer view on `/` (showing the signed-in user's agent activity) is not yet built. `getCurrentUser()` works in any server component; wiring the home page to render the agent activity feed is the next product step.
- Session sliding renewal — sessions expire after 24h with no refresh. Acceptable for v1; revisit when there's traffic.

## 2026-05-08 — policy change: keep password auth on `vps-eu`

- Decision: **do not** disable `PasswordAuthentication` or `PermitRootLogin` on `vps-eu`. Reasoning: single-operator project, easier recovery if SSH key/laptop is lost. The password lives in `deploy/.env`. Brute-force attacks are mitigated by fail2ban (in runbook 03's scope), not by disabling password auth.
- Note: OpenSSH does **not** read passwords from any config file (`~/.ssh/config`, `/etc/ssh/ssh_config`) — that's a security design choice, not a missing feature. So `deploy/.env` is the only sensible place for it.
- Updated runbook 03 to reflect the policy. Updated `protocols.md`, `servers.md`, `deploy/.env`, and `deploy/.env.example` to match.

## 2026-05-08 — `vps-eu` UI simplification pass + catalog seed

- Web UI shipped 7 simplification iterations (filter sidebar replaced with read-only chip strip; trimmed home hero, login, footer, header; simpler empty/404 states; conditional pagination + variants table). All redeployed via `docker compose build web && up -d web`.
- Seeded production catalog via runbook 06, Path A (synthetic Algerian-style): 17 products, 5 sellers, all priced in DZD with placeholder +213 555 00 XX XX phone numbers.
- DEV_BYPASS toggled to 1 for the seed window (api recreated to pick up env), then back to 0 (api recreated again). Verified `printenv DEV_BYPASS` returns `0`.
- Sitemap URL count: 2 → 19. Search now lists products; product pages render with seller phone/WhatsApp links.
- Open issue (not addressed): `/product/<unknown-id>` returns HTTP 200 with the not-found page body instead of HTTP 404. Bad for SEO/agent indexing; deferred.

## 2026-05-08 — `vps-eu` catalog dedupe + UI iteration

- Catalog had been seeded twice → 34 products (each title duplicated). Customer-visible bug: "iPhone 15 Pro Max" listed twice on /search.
- Mitigation: TRUNCATE catalog + seller tables (with CASCADE), DEV_BYPASS=1, re-run seed-algerian.mjs once cleanly, DEV_BYPASS=0. Final state: 17 unique products, 5 sellers, no duplicates.
- Sitemap fix: was statically generated at Docker build time and falling back to 2 entries because the build container can't reach the api container. Switched to `dynamic = "force-dynamic"` + `cache: no-store`. Sitemap now serves 19 URLs (home + search + 17 products).
- Web UI: added segment 404 page for /product/[id], app/icon.svg favicon, app/apple-icon.tsx (180px iOS icon), theme-color meta, mobile-friendly always-visible user menu, conditional rating display on cards, image placeholders with icons, Call/WhatsApp/Website seller pill buttons, native Web Share button with clipboard fallback, whole-amount price formatting (no .00), "Sold by" → seller-filter link.
- Outstanding bug: /product/<unknown-id> still returns HTTP 200 with the not-found body (Next.js 15.1.6 streaming-vs-notFound() known issue). Body is correct, only HTTP status is wrong.
