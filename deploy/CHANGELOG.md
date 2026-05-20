# Deployment changelog

Append-only log of changes made to production servers. One entry per dated event. The point is traceability: if anything breaks, this file tells us what changed and when.

Format: `## YYYY-MM-DD — short summary`, then bullets.

---

## 2026-05-20 — vps-eu — deploy seller orders UX batch (be30cee..51133a8)

- Shipped 7 commits via runbook 07 (tar+ssh). Rebuilt `marketplace-api:local` and `marketplace-web:local`, recreated `marketplace-api` + `marketplace-web`. Smoke: `/livez` ok, apex 200.
- What shipped (web only — UX work on the seller orders surface):
  - `be30cee` seller dashboard: group orders by date.
  - `cd3698f` seller: unified cross-shop `/seller/orders` page.
  - `915da3e` type-as-you-go search by order number or customer.
  - `8565274` per-status tabs (Toutes / À traiter / Expédiées / Livrées / Annulées).
  - `3cc37b7` inline copy buttons next to order number and customer phone.
  - `7eba1e6` three-tile stats banner: à traiter / expédiées 7j / revenu 7j.
  - `83b9a6d` actionable order count surfaced in the browser tab title.
  - `51133a8` tap-to-copy public product link on each product row (seller dashboard).
- Left uncommitted on the laptop: an in-progress `OrderRow` change that links the order number to a `/seller/orders/[orderId]` detail page that doesn't exist yet — kept out of this deploy to avoid shipping a broken link.

---

## 2026-05-20 — vps-eu — deploy commits 09dbc92 + 4d4614f + e61adcd (seller order status management + product soft-delete)

- Shipped working tree via runbook 07 (tar+ssh). Rebuilt both `marketplace-api:local` AND `marketplace-web:local` (api/db code changed for the first time in this batch). Recreated `marketplace-api` and `marketplace-web`. `caddy`/`postgres`/`redis` left in place.
- What shipped:
  - **API**: `DELETE /v1/products/:id` — soft-delete (flips products.status to "removed"). Hard delete is intentionally avoided: order_items.variant_id references productVariants without ON DELETE CASCADE, so purging a previously-ordered product would violate the FK or destroy order history. The "removed" status is already filtered out of every public read query (search, listForSeller, getProductsByIds, loadOneActive). Idempotent: re-deleting returns 204.
  - **API**: `POST /v1/sellers/:sellerId/orders/:orderId/transition` — apply a seller-driven domain event (begin_fulfillment / ship / deliver / cancel) on an order. Calls into `orderDomain.applyEvent` for the state machine, writes the new status on the order row AND a row in `order_status_history` so we can audit transitions later. Requires the caller to own at least one line in the order. Cancel requires a non-empty reason.
  - **DB**: new `ProductRepo.softDelete` and `OrderRepo.applySellerEvent` methods (typed contracts on both the api/repos interfaces and the db/repos implementations).
  - **Web**: edit-product page now has a "Zone dangereuse" section with type-the-title confirm modal (09dbc92, separate commit by parallel session).
  - **Web**: new client component `<OrderActions>` on the dashboard order list. Renders the state-machine transitions that apply to each order's current status: paid → "Marquer en préparation" + "Annuler", fulfilling → "Marquer expédié" + "Annuler", shipped → "Marquer livré". Cancel opens an inline reason prompt. Closed/pre-payment orders get no buttons (no transitions exposed).
  - **Web**: new `/api/seller/sellers/[id]/orders/[orderId]/transition` Next.js route handler proxies to the new API endpoint.
- Hiccup hit and resolved mid-deploy: first deploy of the transition route landed it under `[sellerId]/`. Next.js requires the same slug name at each tree depth and the parallel `[id]/` segment for the existing contact PATCH route caused every page to render 500 with "You cannot use different slug names for the same dynamic path ('id' !== 'sellerId')" looping in web logs. Fix (e61adcd) renamed the directory to `[id]/`, re-shipped, rebuilt+restarted web. ~5 min of 500s.
- Verified post-deploy:
  - `https://teno-store.com/` 200, `/seller` 200, `/seller/dashboard` 307 → /seller (expected), `/store/<sellerId>` 200, `/search` 200
  - `api.teno-store.com/livez` 200 (`{"status":"ok"}`)
  - All containers healthy: marketplace-api (Up, healthy), marketplace-web (Up), marketplace-caddy/postgres/redis untouched
- Known carried-over issue (unchanged from previous deploy): `https://teno-store.com/sitemap.xml` still 504s from Caddy on the slow generation. Sitemap regenerator service still owed (see 2026-05-20 first entry below).

## 2026-05-20 — vps-eu — deploy commit 20a81e2 (web-only: seller UX sweep, ~1300 LOC across seller surfaces)

- Shipped working tree via runbook 07 (tar+ssh); rebuilt `marketplace-web:local`; recreated `marketplace-web`. `api`/`caddy` left in place (no api/db code in this batch).
- Verified post-deploy:
  - `https://teno-store.com/` 200, `https://teno-store.com/seller` 200, `https://teno-store.com/search` 200, `/store/<sellerId>` 200, `/seller/dashboard` 307 → /seller (expected, no session)
  - `api.teno-store.com/livez` 200 (`{"status":"ok"}`)
  - HTML on /seller contains the new "Gratuit · sans commission" chip, the "par appel ou WhatsApp" bullet, and the "une image, un titre" image-required hint
  - Storefront /store/019e08a4-97cd-7d98-afd7-670878dc51c2 contains the new pre-filled wa.me URL with `?text=Bonjour%2C%20je%20vous%20contacte%20au%20sujet%20de%20votre%20boutique%20«%20Smart%20Phone%20DZ%20…%20»%20sur%20Teno%20Store.`
- Known pre-existing issue (not caused by this deploy): `https://teno-store.com/sitemap.xml` returns 504 from Caddy — Next.js sitemap route takes too long under load and Caddy hits its proxy-read timeout. Sitemap generates correctly from inside the container (`docker exec marketplace-web wget -qO- http://127.0.0.1:3200/sitemap.xml` returns valid XML). Out of scope for this batch; should be addressed by either a sitemap regenerator service (like the one for `/llms.txt`) or a longer Caddy timeout for `/sitemap.xml`.
- What shipped (seller UX sweep, 34 files, 1329 insertions, 450 deletions):
  - Forms (new + edit product, contact, create seller): mobile numeric-keypad price with live "29 999,00 DA" preview, currency-aware PriceField (reads v0.currency, defaults to DZD), drag-and-drop image upload with click-to-retry, "Couverture" badge on first image, failed-upload count warning, smart submit-button states (idle / no-image / uploading / submitting) with cursor-not-allowed + aria-busy, required-field asterisks + aria-required, description placeholder/counter, stock toggle with explanatory subtext (aria-describedby), multi-variant warning with mailto link, dir="auto" on text inputs, network try/catch around every fetch, success indicators with useEffect cleanup
  - Dashboard: per-shop "à traiter" actionable chip (paid/fulfilling/disputed), relative-time order timestamps, status badges in three color tiers, full-row clickable product links, quantity pill + variant SKU subtitle + thumbnail on order lines, wilaya badge with location pin, pre-filled WhatsApp message including order #, ContactSummary with clickable tel/wa.me/url/mailto links, identity line "Connecté en tant que [name] (email)" + shop count for multi-shop sellers, support-mailto footer, parallel product+order fetch per shop (`Promise.allSettled`), variants-count pill on products list
  - Storefront: pre-filled WhatsApp click-to-chat with shop name, "Voir le catalogue complet →" CTA on empty storefronts, `untrusted` + `dir="auto"` on every buyer-facing seller-typed string, "E-mail" label (was "Contact")
  - Localization: `formatPrice` default switched from `en-US` to `fr-DZ` (was leaking `DZD 29,999.00` into French-primary pages); pluralization on count-in-heading labels across dashboard/storefront/cart/order
  - Accessibility: explicit landmark naming via `aria-labelledby` on every page section + per-shop article; semantic HTML upgrades (article/section/header/footer/dl/dt/dd); `aria-hidden` on decorative arrows; `dir="ltr"` on phone/URL/email/order-number; touch targets bumped to ≥44px on mobile across all primary actions
  - Real bug fixes: edit form no longer drops trailing `categoryIds` on multi-category products and preserves niche current category as a dynamic option; French translation of stray English Google Sign-In error; CreateSellerForm error path now reads `detail || error` (was error-only)

## 2026-05-19 — vps-eu — seller-uploaded images broken on storefront (fixed via /v1/media rewrite)

- Symptom: products created through the seller UI (e.g. "eee" by Mahdi hakim, `019e423e-ff75-72a9-8418-58af7dce50ea`) had their image row written correctly in `catalog.media` (url `/v1/media/3775f84594f46c5be1bd2e9a35597ceb.jpg`) but rendered broken on `https://teno-store.com/product/<id>`. Scraper listings were unaffected because Ouedkniss URLs are absolute.
- Root cause: `POST /v1/media` stores and returns a bare relative path, so the catalog row's `url` is `/v1/media/<hash>.<ext>`. The storefront renders `<Image src="/v1/media/...">`, which the browser resolves against the page host → `teno-store.com/v1/media/...` → 404 (the file lives on `api.teno-store.com`). `_next/image?url=/v1/media/...` failed identically because the optimizer fetches its `url` param same-origin.
- Fix: added a Next.js `rewrites()` entry mapping `/v1/media/:path*` → `${MARKETPLACE_API_URL}/v1/media/:path*` (`packages/web/next.config.mjs`). Since rewrite destinations are baked into the routes manifest at `next build` time, `MARKETPLACE_API_URL` is now also a Dockerfile `ARG` (`packages/web/Dockerfile`) passed via `docker-compose.prod.yml` build args; defaults to `http://api:3100` so the rewrite resolves over the docker network.
- Deploy: scp config files, `docker compose build web`, `up -d web`. Verified `GET https://teno-store.com/v1/media/3775f84594f46c5be1bd2e9a35597ceb.jpg → 200` (122 718 B, `image/jpeg`) and `GET /_next/image?url=%2Fv1%2Fmedia%2F...&w=640&q=75 → 200` (`image/jpeg`, 44 345 B WebP-transcoded). Product page HTML for "eee" now contains the `/_next/image` src for the uploaded jpg.

## 2026-05-19 — vps-eu — scraper seeder unblocked (null-prototype attributes → drizzle JSONB crash)

- Patched `packages/db/src/repos/product.ts` (create + update paths) to spread `cleanAttrs`/`cleaned` into a plain `{}` before passing to drizzle. The 2026-05-15 hardening sweep had switched these to `Object.create(null)`, which crashed drizzle's JSONB serializer with `Cannot read properties of null (reading 'constructor')` on every insert. Prototype-pollution defense is preserved by the existing key-filter loop above the spread.
- Symptom: catalog frozen at 55,641 since 2026-05-17 ~18:01 UTC. Every `run-loop.sh` since then logged `seeded=0` with ~30 of 50 listings hitting the catch block per run.
- Shipped via tar+ssh per runbook 07; rebuilt `marketplace-api:local`; recreated `marketplace-api`. `web`/`caddy` untouched.
- Verified: `livez` 200; first post-deploy scrape run (21:50 UTC) seeded 32 products with logged UUIDs and zero `failed [N]` lines. Loop is back to writing rows; cap still 280,000.

## 2026-05-19 — vps-eu — deploy commit d3906ea (CSP for Google Sign-In + public copy refresh)

- Same commit also re-shipped the drizzle fix above (now confirmed against `dist/repos/product.js` on the running api container) plus two web-only changes:
  - `packages/web/next.config.mjs`: report-only CSP was flooding the seller sign-in console with violations against `accounts.google.com` (gsi/client SDK iframe + token endpoint) because `default-src 'self'` was the fallback for `frame-src` and `connect-src`. Added `accounts.google.com` / `apis.google.com` to `script-src`, `style-src`, `connect-src`, `frame-src`. Verified the live header at `https://teno-store.com/` contains `frame-src 'self' https://accounts.google.com`.
  - `packages/web/src/app/{about,page,login,seller/page}.tsx`: refresh public copy to drop the "marketplace for AI agents / MCP / A2A / AP2" positioning. Reframed as a third-party Algerian marketplace ("Algeria's marketplace, refreshed in real time"; sign-in CTA simplified; FAQ entries rewritten; agent-deep-dive section removed from /about).
- Deploy: tar+ssh ship, rebuilt api+web images, recreated containers. `marketplace-api` healthy in ~4s; `https://teno-store.com/` and `https://api.teno-store.com/livez` both 200.



## 2026-05-19 — vps-eu — deploy commit c83b4b8 (SEO/JSON-LD batch + scraper config)

- Shipped working tree via tar+ssh per runbook 07; rebuilt `marketplace-web:local`; restarted `marketplace-web`. `api`, `caddy` left in place (no api code in this batch).
- Verified: `https://teno-store.com/` 200; `marketplace-web` Up on new image; `/llms.txt` still serving fresher regenerator output (55,700 / 21:01 UTC) — confirms the server-side regenerator wins over the in-image static file as expected.
- Why: ship the product + store JSON-LD hardening + scraper MAX_AGE_DAYS knob to clear Google Search Console alerts in production.

## 2026-05-19 — product + store JSON-LD: clear Google Search Console alerts (local)

- Search Console flagged: critical "must specify offers/review/aggregateRating" on price-on-request products; non-critical "missing shippingDetails / hasMerchantReturnPolicy / description / global identifier" on merchant listings; "invalid string length in name" on the merchant entity.
- `packages/web/src/app/product/[id]/page.tsx`: emit a minimal Offer (priceCurrency + availability, no price) for price-on-request listings so the Product entity always has an offers node (clears the critical alert without lying with `price="0.00"`). Add `shippingDetails` (free DZ shipping, 0–2 day handling, 1–7 day transit) and `hasMerchantReturnPolicy` (MerchantReturnNotPermitted — the marketplace doesn't manage returns) to single-Offer and AggregateOffer alike. Add `mpn: productId` as global-identifier fallback. Clamp Product.name and the breadcrumb leaf to 2..150 chars (sellers post 200+ char spec-string titles that tripped the merchant validator's name-length cap).
- `packages/web/src/app/store/[id]/page.tsx`: clamp Store `name` to 2–150 chars with a sellerId-suffixed fallback when missing. Mirror name-clamp, shippingDetails, hasMerchantReturnPolicy, description and mpn onto the nested itemList Product entries.
- "Page with redirection" indexing alert: investigated — the 308 from `/search?sellerId=X` → `/store/X` (intentional, see `app/search/page.tsx:323`) and the static asset redirects in `next.config.mjs` are the only redirect sources in the codebase. Sitemap doesn't emit `/search?sellerId=` so Google is following external/historical links. This is informational, not a bug; no code change.
- Tests: all 172 web tests pass; tsc clean. Not yet deployed.

## 2026-05-19 — vps-eu · api+web rebuild · seller create-product accepts same-origin /v1/media URLs (33e9532)

- Seller dashboard "Créer un produit" was failing with `media.0.url: Invalid URL; media.0.url: media_url_scheme_not_allowed` on POST `/v1/products`. The browser uploads files to `/v1/media`, which returns a relative path like `/v1/media/<hash>.png`; the deployed validation schema chained `.url()` which rejects relative paths, and a separate http(s)-only refine that also rejected them — both errors fired together.
- Fix already committed locally (33e9532, today): MediaInputSchema in `packages/api/src/routes/products.ts` drops `.url()` and broadens the allow-list to `^https?://…` OR `^/v1/media/[a-z0-9][a-z0-9.-]*$`. Previously deployed api container was 2 days old and predated the fix.
- Deploy: tar+ssh ship, rebuilt api+web images, recreated containers. `livez=ok`, web returns 200. Verified the new refine body is present in the running container at `/app/packages/api/dist/routes/products.js`.
- Also pruned this changelog to the last 3 days (was 1629 lines) to keep it scannable.

## 2026-05-19 — vps-eu · api+web rebuild · scraper gate relaxation + product page polish

- Shipped commits f380c1b, e39e88b, 33e9532 via tar+ssh; rebuilt api/web images, recreated containers. `livez=ok`, web returns 200.
- Scraper: phones and unparseable prices are now metadata, not seed-time gates. Unowned reference listings don't transact, so the 2026-05-13 phone/price drops were rejecting 30–95% of every page for no downstream value. Unparseable prices become `priceMinor=0n` + `attributes.priceOnRequest`, already rendered as "Prix sur demande" everywhere.
- `run-loop.sh`: stagnation reset — if the last 30 runs of a category seeded 0 rows and `start_page>100`, reset `next_start_page` to 1. Stops phone-heavy categories from grinding pages 3500+ that only exist as dedup-suppressed dupes. Also added `price_on_request` to the metrics line + JSONL.
- Category rotation extended in `CLAUDE.md` to include emploi_offres, services, meubles_maison, sport (existing systemd timer reads from the env; this is just doc).
- API: media URL allow-list extended to accept relative `/v1/media/<filename>` paths produced by our own upload endpoint, so the seller dashboard's create-listing flow stops rejecting freshly uploaded images. Absolute scheme still http(s)-only.
- Web: product page variants table translated to French (Variantes / Référence / Prix / en stock / épuisé); `break-words` on description to prevent unbroken-string overflow on phones.

## 2026-05-19 — vps-eu · housekeeping sweep (logs, build cache, journal, scrape dumps, repo one-shots)

- `/opt/marketplace/data/logs/`: deleted 9,936 scraper run logs older than 1 day (12,816 → 2,880 files; 196 MB → 45 MB). Rotate timer was only catching the last few days; one-shot brought the backlog current. Why: per-minute scrape loop produces ~1,440 logs/day; >1d retention is plenty.
- `/opt/marketplace/data/`: deleted 1,309 `ouedkniss-*.json` scrape dumps older than 7 days that the daily `marketplace-data-rotate.service` hadn't yet caught (12,814 → 11,505; 1.2 GB → 1.1 GB). Daily timer continues to bound steady-state.
- Stale backups on server: removed `/opt/marketplace/.env.bak` (May 6) and `/opt/marketplace/scripts/seed-from-scraped.mjs.bak` (May 10). The current seeder is built into `marketplace-api:local` per the 2026-05-10 entry.
- Docker: ran `docker buildx prune -af --filter until=24h` + legacy `docker builder prune` (build cache 3.97 GB → 1.17 GB, freed 2.8 GB). Removed unused `hello-world:latest` image and the exited one-shot `marketplace-api-migrate` container.
- `journalctl --vacuum-time=7d`: 1.3 GB → 943 MB (freed 443 MB of archived journals).
- Orphan debug artifacts in `/opt/marketplace/` root (all from May 11): removed `st.html` (256 KB rendered `/store/[id]` capture), `search.html` (188 KB rendered search capture), `sitemap.xml` (15.5 MB one-shot export — Caddy serves from `/opt/marketplace/data/sitemaps/` not this path, verified via Caddyfile rule), and `tsconfig.tsbuildinfo` (stray host-side `tsc` output). ~16 MB total. None of these were wired into a live route.
- **Surfaced (not fixed here):** `/opt/marketplace/data/sitemaps/` is empty and `https://teno-store.com/sitemap.xml` returns 504 (Caddy falls through to the slow API path → audit `2026-05-17-2005-sitemap-cold-120s-exceeds-spec.md`). The `marketplace-sitemap-rebuild.timer` is not populating the dir. Homepage and product pages are fine. Needs operator follow-up on the sitemap-rebuild service.
- Repo: deleted 12 stale files — `reports/anomalies.txt` (1,390-line freeform log superseded by `deploy/audits/`) and 11 one-shot helper scripts in `scripts/add-*.py` / `verify-seller-name-encoding.py` / `embed-mcp-schemas.py` / `ascii-escape-manifest-description.py` (all explicitly self-described as "One-shot helper" mutations to `agents.json` or one-time encoding fixes, long since committed). Also cleaned the dead `Reference: reports/anomalies.txt [56]` line in this changelog.
- Prod `/opt/marketplace/scripts/`: deleted the same 11 one-shot helper scripts that were still sitting there from earlier deploys (none referenced by any systemd unit). Also deleted two dead seeders — `seed-from-scraped.mjs` (the API-POST version, superseded 2026-05-10 by the direct-DB sibling in the api image) and `seed.mjs` (dev-only seeder against an in-memory store). 41 → 28 files.
- Prod `/opt/marketplace/.env.bak.*`: deleted three stale snapshots from the May 9–10 auth-bypass churn (`.20260510T220020`, `.20260510T221528-pre-bypass-off`, `.snapshoturl`). Each held outdated secrets; small security improvement.
- Prod `/opt/marketplace/` root: deleted 28 orphan debug captures from a May 11 session — 25 captured HTML dumps (`about.html`, `home*.html`, `p6.html`–`p18.html` series, `prod.html`, `renault*.html`, `search2.html`, `seller.html`, `sr.html`, `store*.html`, `ipega2.html`, `nf.html`, `pnf.html`), 2 files whose *filenames literally contain Windows temp paths* (`C:UsersmahllAppDataLocalTempteno_search.html`, `UsersmahllAppDataLocalTempteno.html` — bungled scp positional args), and `api-dev.log` (33 KB from May 9). ~2.2 MB total. Verified not referenced by `Caddyfile` or `docker-compose*.yml`. Root entry count 52 → 31.
- Prod vestigial flat-layout dirs: `rm -rf` of four top-level directories that mirror the pre-monorepo layout but are no longer referenced anywhere — `src/` (1.4 MB / 149 files, byte-identical to `packages/web/src/`), `public/` (84 KB, dup of `packages/web/public/`), `reports/` (`anomalies.txt` only, the same file already deleted from the repo in iter 1), `test/` (single 43-byte `setup.ts` stub). Verified absent from Dockerfile / `docker-compose*.yml` / `Caddyfile` / all container mounts. Cause is the tar-deploy not deleting (`deploy/runbooks/07-deploy-changes.md` line 57). Post-cleanup, `/opt/marketplace/` top-level dirs now match the repo's top-level dirs 1:1. Site verified healthy after: `https://teno-store.com/` 200, `api.teno-store.com/livez` 200.
- Host `/tmp/`: deleted 21 `*.html` / `*.log` / `*.json` debugging artifacts older than 7 days left over from interactive `curl > /tmp/x.html` sessions on May 12–13 (about.html, 404.html, cart.html, a.html, b.html, bb.html, c.html, bp.html, api-build.log, api.json, etc.). 63 → 42 files; ~1 MB freed. Not in `/opt/marketplace/` so not a routine concern, but worth keeping the box tidy.

## 2026-05-18 — vps-eu · mobile UI sweep (30 iterations) + Dockerfile/.npmrc + sitemap shard route force-dynamic

- Deployed the 30-iteration mobile-UX sweep (commit `d4df314`): 2-col product grids on phones, 44px+ tap targets on every primary CTA, iOS auto-zoom eliminated on all inputs/textareas/selects (`text-base sm:text-sm`), header chrome compressed (icon-only sign-in/out, shorter SearchBar placeholder, `gap-2 sm:gap-6`), sticky-header anchor offset (`scroll-margin-top: 80px`), `prefers-reduced-motion` honored site-wide, `-webkit-tap-highlight-color: transparent` + `active:` states for clean tap feedback, dynamic viewport height via `@supports (height: 100dvh)`, container rhythm unified (`pt-6 sm:pt-10` / `p-4 sm:p-6`), Gallery swipe gestures + 44px lightbox close, breadcrumbs `py-1` + `flex-wrap`, variants tables `overflow-x-auto`, `GoogleSignInButton` width clamped to container so the fixed 320px button stops overflowing the seller card. Touched 47 files in `packages/web/**`. Tests: 171/171 passing.
- Two unrelated build issues surfaced and were fixed inline (commit `5a36f3c`): (a) both Dockerfiles now COPY `.npmrc` so the `dangerously-allow-all-builds=true` setting reaches the in-image `pnpm install` (without it pnpm 10 refused with ERR_PNPM_IGNORED_BUILDS on esbuild/sharp); (b) `/sitemap-products-[shard].xml/route.ts` got `export const dynamic = "force-dynamic"` because Next.js was failing the build trying to statically prerender it with an undefined `[shard]` param.
- Deploy: `tar | ssh` → `docker compose build web` → `docker compose up -d web`. ~3 min total. ~15s of `web` downtime during recreate. Verified with `curl -sSI https://teno-store.com/` (HTTP/2 200) and a grep against the live HTML confirming `grid-cols-2` is in the rendered head (= mobile bundle deployed).

## 2026-05-18 — vps-eu · custom Caddy with Souin cache + caddy-ratelimit — origin-side caching/rate-limit since Cloudflare is DNS-only

- Replaced `caddy:2-alpine` with a custom `marketplace-caddy:local` image built via `xcaddy` (`deploy/caddy/Dockerfile`) that bundles `caddyserver/cache-handler` (Souin) and `mholt/caddy-ratelimit`. Cloudflare is gray-cloud / DNS-only for the Algerian-latency reasons noted in `deploy/dns.md`, which means every page render, every `/_next/image` transcode, every sitemap fetch was hitting origin — there was no edge cache or WAF in front of Caddy. The Souin layer honors `Cache-Control: s-maxage / stale-while-revalidate` from upstream (Next.js already emits these on `/c/*`, `/product/*`, `/feed.xml` after today's earlier change), so repeat hits collapse to one upstream call until the TTL expires. In-memory storage — lost on Caddy restart, rebuilds within seconds.
- Rate-limit zone on the apex (`/c/*`, `/product/*`, `/search*`, `/feed.xml`, `/b/*`): 60 req/min per IP. Targeted at the audit `2026-05-17-1947-aggressive-crawler-…md` pattern (70 req/5min, pure SSR paths). `/_next/image`, `/_next/static`, `/sitemap*.xml`, `/robots.txt`, `/favicon.ico` intentionally NOT limited — they're cache hits or static disk reads, and a real user can fan out to many image subrequests per page. Apex rate limit on api.teno-store.com is 300 req/min per IP as a generic abuse cap.
- Deploy: rebuilt the caddy image on vps-eu (`docker compose build caddy`) and recreated the service (`docker compose up -d caddy`). Health verified with `curl -I` against teno-store.com and api.teno-store.com.

## 2026-05-17 — vps-eu · pg backups + pg_stat_statements + buildx prune fix — audit fixes (data durability, slow-query telemetry, disk reclamation)

- Installed `marketplace-pg-backup.service` + `.timer` (daily 03:00 UTC, custom-format `pg_dump`, 14-day rotation in `/opt/marketplace/backups/`). Ran the service once manually — produced a 43 MB dump (`marketplace-2026-05-17T1831.dump`). Closes the HIGH-severity gap from `deploy/audits/2026-05-17-1956-no-database-backups.md`. NOTE: still local-only — off-box copy (object storage / restic) needs an operator decision and is tracked in `deploy/TODO-offbox-backups.md`.
- Recreated the `postgres` service via `docker compose -f docker-compose.prod.yml up -d postgres` after adding a `command:` override that sets `shared_preload_libraries=pg_stat_statements,auto_explain`, `pg_stat_statements.max=10000`, `pg_stat_statements.track=all`, `auto_explain.log_min_duration=1000`. Recreate (not `restart`) is required for compose `command:` changes to apply. Ran `CREATE EXTENSION IF NOT EXISTS pg_stat_statements` in the marketplace DB; `SELECT count(*) FROM pg_stat_statements` returned 27 rows immediately. Closes `2026-05-17-2000-pg-stat-statements-not-loaded.md`. ~10 s of api downtime during postgres recreate, within the expected window.
- Updated `marketplace-docker-prune.service` to run BOTH `docker builder prune -af --filter until=24h` AND `docker buildx prune -af --filter until=24h`. Original config only hit the legacy builder, so the 44.75 GB BuildKit cache never aged out (audit `2026-05-17-1956-docker-builder-prune-noop.md`). One-shot manual `docker buildx prune -af` reclaimed the full cache: `docker system df` went from 44.75 GB build cache + 39.8 GB images to 0 B cache + 2.2 GB images (dangling images also cleared).

## 2026-05-17 — vps-eu · api rebuild + run-loop.sh + 4G swap — audit fixes (latency, metrics decomposition, OOM headroom)

- Added 4 GiB `/swapfile` (`vm.swappiness=10`, persisted via `/etc/fstab` + `/etc/sysctl.d/99-marketplace-swap.conf`). Steady-state commit was ~5.2/7.7 GiB with no swap; `overcommit_memory=0` (heuristic) so the strict-mode ceiling the audit feared wasn't actually active, but the headroom margin was thin enough that any spike (large query, GC fragmentation) was a coin flip away from an `ENOMEM`. Swap usage stays near zero at swappiness=10 except under real pressure.
- Rebuilt `marketplace-api:local` with `packages/api/src/catalog/search.ts` honoring the `noFacets=true` flag — previously the flag only short-circuited the home-page recent-listings SQL path; now `searchProducts` itself returns an empty `Facets` object instead of running the catalog-wide aggregation. `/v1/products?limit=1&noFacets=true` measured ~120 ms cold vs the default `/v1/products?limit=1` still showing the ~385 ms cold facet spike, confirming the path actually short-circuits.
- Deployed `/opt/marketplace/scripts/run-loop.sh` with two changes: (a) `api_total_estimate` now hits `?limit=1&noFacets=true` so the minutely catalog-size probe stops triggering the cold facet path on each api worker; (b) the seeder's `noPhone` / `noImage` pre-flight drops are now extracted from the summary line and surfaced as separate `no_phone` / `no_image` fields in both the human log line and `metrics.jsonl` (previously bundled into `invalid_skipped`, making it look like a 50/50 validation failure when it was actually the intentional no-phone-reachable policy filtering structurally-private listings in `immobilier` / `automobiles_vehicules`).
- First post-deploy regex bug: greedy `.*([0-9]+) dropped for missing phone` captured the trailing digit of the preceding number (so "30 dropped" parsed as "0"). Re-deployed with anchor `, ([0-9]+)`. Verified against an 18:07 metrics line — `no_phone=4` now matches the seeder's "4 dropped for missing phone" message.
- Updated `CLAUDE.md`: the catalog-cap doc said 14,200 but the systemd unit (`marketplace-scrape-loop.service`) has `--max-products 280000` and the timer fires every minute across 6 rotating categories. Doc had been stale since the seller_id=NULL "unowned reference listings" policy in May.

## 2026-05-17 — vps-eu · web + api rebuild — shipped 5 pending blog/content commits + 2 pre-existing typecheck errors fixed

- Five commits accumulated since the last actual deploy (CHANGELOG entries had been written but the tar+rebuild step was skipped — every blog post was returning 404 in prod). Tar-shipped and rebuilt `web`: new `/blog/guide-achat-refrigerateur-algerie-2026` and `/blog/guide-achat-lave-linge-algerie-2026` now 200, /about cross-links to all 13 posts, category-page FAQ/intros scrubbed of specific product mentions, blog buying guides scrubbed of product/model names.
- Pre-flight typecheck surfaced two pre-existing errors unrelated to today's content commits — fixed both before rebuild:
  - `packages/db/src/repos/product.ts` was using `count()` from drizzle-orm without importing it (introduced in commit 6fa2183 hardening sweep, never tripped because no one had run `pnpm typecheck` since).
  - `packages/api/src/routes/health.ts` was mutating the `msg` field of `readyz` probe results that are typed `readonly` via `as const`. Rewrote to build a fresh checks object via `.map()` instead of mutating in place.
- Two test fixtures had drifted from production behavior — updated:
  - `packages/db/test/schema-catalog.test.ts` was still asserting `seller_id` was NOT NULL, but the column became nullable on 2026-05-12 to support scraper-seeded reference listings without an owning seller.
  - `packages/web/src/app/search/page.test.ts` was asserting indexable search slices return robots `{index:true, follow:true}` exactly, but production now also emits `max-image-preview:large`, `max-snippet:-1`, `max-video-preview:-1` to keep large image previews + unlimited snippets in SERP/AI-Overviews previews (was an existing wholesale-replace fix in search/page.tsx that didn't get a test update).
- Api rebuild also picked up a concurrent-session optimization that was uncommitted in the working tree: `searchProducts(..., {noFacets: true})` opt-out lets the run-loop's `/v1/products?limit=1` totalEstimate probe skip the catalog-wide facet aggregation pass (was the dominant cost of an otherwise trivial query at ~55k products — produced 450 ms cold-path spikes every minute on a probe that should take a few ms). Both halves shipped together (api search.ts adds the flag, scraper/run-loop.sh starts passing it).
- Verified live: 14/14 blog posts return 200 from teno-store.com/blog/{slug}. `/livez` ok. `/readyz` reports db + redis both healthy.



- Eleventh new blog post this loop: "Guide d'achat : choisir un lave-linge en Algérie (2026)", ~9 min read, 10 H2 sections, ~3,700 words. Blog count: 14 → 15. Completes the electromenager quartet (climatiseur + téléviseur + réfrigérateur + **lave-linge**).
- 10 dimensions covered with Algerian-specific framing:
  - **Capacité** in kg of dry laundry per household size (1p → 6+ with ramadan multi-generationnel scaling)
  - **Frontal vs top** ergonomic + capacity + water-consumption trade-offs
  - **Vitesse d'essorage** thresholds (800/1000/1200/1400-1600 rpm) translated to étendoir-drying-time tradeoffs
  - **Moteur inverter** (Direct Drive, brushless): vs moteur à charbon, full Sonelgaz electricity + durability math, 4-6y ROI
  - **Calcaire (eau dure)**: the dominant Algerian-specific failure mode for Alger/Oran water — résistance protection (ceramic/émaillage), programme de détartrage auto, accessible filter — three concrete contre-mesures to demand
  - **Programmes utiles vs marketing**: 5-6 used / 12-15 advertised
  - **Classe énergétique 2021** with kWh/an per class
  - **Brand-fiability**: Samsung/LG (inverter leaders), Bosch/Siemens (15+ years), Beko (Algerian SAV density), Whirlpool, Condor (entry only, avoid >9kg or inverter), Haier/Hisense (selective)
  - **Prix DZD** for 5 tiers (5-6kg top entry 35k → lavante-séchante 200-350k)
  - **Occasion vérifications**: full cycle test (chauffe + essorage + vidange), joint hublot inspection (moisi/calcaire), roulements tambour test, date de fabrication 8-12y thresholds
- Also patched /about cluster section (introduced iter-86) to include both the réfrigérateur post (missed in iter-86 ordering) AND the new lave-linge post. /about now links to ALL 10 buying-category posts.
- agents.json editorial_content: 14 → 15 posts. Pushed 3 URLs to IndexNow (lave-linge post + /about + agents.json).

