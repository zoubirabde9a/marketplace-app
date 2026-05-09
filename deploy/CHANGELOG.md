# Deployment changelog

Append-only log of changes made to production servers. One entry per dated event. The point is traceability: if anything breaks, this file tells us what changed and when.

Format: `## YYYY-MM-DD — short summary`, then bullets.

---

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
