# Teno Store — production status (2026-05-10)

A snapshot of where the deployment is, what's healthy, what's blocked, and what to do next when you pick this up.

## Live

- **Site:** https://teno-store.com — 200, ~400 ms TTFB through Cloudflare.
- **API:** https://api.teno-store.com/livez — `{"status":"ok"}`.
- **www:** https://www.teno-store.com → 301 → apex.
- **TLS:** valid Let's Encrypt cert covering apex / www / api. HTTP/2 + HTTP/3 advertised.
- **DNS:** Cloudflare-proxied (orange cloud) for all three names.
- **Server:** netcup VPS in Nuremberg, arm64, Debian 13, ufw + fail2ban + unattended-upgrades active.
- **Stack:** Caddy + Next.js (web) + Fastify (api) + Postgres 17 + pgvector, all in Docker Compose on `vps-eu`.
- **Seller listing UI:** fully functional at `/seller/*` for logged-in humans.

See `servers.md` for the full machine inventory and `dns.md` for DNS records.

## Catalog

- **Live size (2026-05-10): ~3,200 products** sourced from real Ouedkniss listings via the scrape-and-seed loop (`scraper/run-loop.sh`, scheduled). The 17-product seed from 2026-05-08 was a smoke test; the current catalog is real-world data attached to a synthetic Algerian seller (`Smart Phone DZ`).
- **Sitemap** at `/sitemap.xml` lists every product with a real per-row `<lastmod>` (verified 2026-05-10: 3,068 `<loc>` entries the moment we checked, climbing as the loop runs).
- **No duplicate sellers in the source of truth** (verified 2026-05-08 against `vps-eu` Postgres): `identity.organizations` and `seller.seller_profiles` are joined 1:1; `catalog.products` references them cleanly. Product-level dedup is handled by the seeder's `SKIP_URLS_FILE` (see `deploy/CHANGELOG.md` 2026-05-10) — repeated scrape runs over the same Ouedkniss listings no longer create content-duplicates.

## Search-engine discovery (2026-05-10)

- **`site:teno-store.com` returns 1 indexed page**: only the apex. **Zero of the ~3,200 product URLs** are in Google's index yet. The cached snippet is stale Arabic content, almost certainly from a prior owner of the domain — it will be replaced once Google recrawls.
- **IndexNow submission DONE** (2026-05-10): all 3,206 URLs from the sitemap pushed to Bing/Yandex/Seznam/Naver via `scripts/indexnow-submit.mjs`. Host key file at `https://teno-store.com/81b0a3ff408a96ef5c0381a78aae7f58.txt`. Bing also feeds DuckDuckGo and ChatGPT-search.
- **Google Search Console submission STILL TODO** — gated on the operator's Google login. Without it, Google's crawl rate for an unknown domain is 1–2 pages/month. With it, full coverage of 3k+ URLs in 2–4 weeks. See the four-step checklist below.

## Gated on you

These need a login I don't have:

| Action | Where | Why it matters |
|---|---|---|
| Submit `https://teno-store.com/sitemap.xml` to Google Search Console | search.google.com/search-console | Cuts time-to-index from weeks to days. Verify ownership via DNS TXT in Cloudflare. |
| Submit to Bing Webmaster Tools | bing.com/webmasters | Same as above, smaller traffic share. |
| Run a product URL through Google Rich Results Test | search.google.com/test/rich-results | Confirms `Product` JSON-LD parses; only useful **after** seeding. |
| Flip Cloudflare SSL/TLS from `Full` → `Full (strict)` | Cloudflare dashboard | Caddy certs are valid; the bootstrap reason for `Full` is gone. One dropdown. |
| Set up nightly Postgres backup → Backblaze B2 | `vps-eu` (with B2 keys) | Currently no backups — single VPS loss = total data loss. Plan in `protocols.md` § Backups. |
| Set up UptimeRobot on `/livez` | uptimerobot.com (free tier) | Get paged when the site is down. |

## Documented for next time

Everything in `/deploy/` is a fresh-eyes-friendly source of truth. Quick links:

- [`README.md`](./README.md) — index + conventions
- [`servers.md`](./servers.md) — every machine, every IP, every port
- [`dns.md`](./dns.md) — Cloudflare records + settings
- [`seo.md`](./seo.md) — what's indexed, what's left, brand collision with TeNo jewelry
- [`protocols.md`](./protocols.md) — what we use & why
- [`CHANGELOG.md`](./CHANGELOG.md) — append-only timeline of every server change
- [`runbooks/01-provision-vps.md`](./runbooks/01-provision-vps.md) → buying & receiving a VPS
- [`runbooks/02-ssh-bootstrap.md`](./runbooks/02-ssh-bootstrap.md) → key-based SSH
- [`runbooks/03-harden-server.md`](./runbooks/03-harden-server.md) → ufw + fail2ban + unattended-upgrades + Docker / Compose plugin
- [`runbooks/05-deploy-app.md`](./runbooks/05-deploy-app.md) → first-time bring-up of the marketplace stack
- [`runbooks/06-seed-catalog.md`](./runbooks/06-seed-catalog.md) → populate the catalog (Algerian-style)
- [`runbooks/07-deploy-changes.md`](./runbooks/07-deploy-changes.md) → ship a code change to vps-eu
- [`runbooks/08-cloudflare-intermittent-slowness.md`](./runbooks/08-cloudflare-intermittent-slowness.md) → diagnose & fix the "site sometimes hangs ~7.7s" Cloudflare-edge pattern (open as of 2026-05-09)
- [`runbooks/99-disaster-recovery.md`](./runbooks/99-disaster-recovery.md) → recovery from server loss / DB corruption / Let's Encrypt lockout / hijack / lost key

## Scripts at the repo root

- `scripts/seed-algerian.mjs` — 5 sellers + 17 products in DZD. Phones are clearly synthetic (`+213 555 00 XX XX`).
- `scraper/scrape-ouedkniss.mjs` — Playwright-based, bounded, *does not* scrape personal data. Run on operator's laptop. See [`scraper/README.md`](../scraper/README.md).
- `scraper/seed-from-scraped.mjs` — bridges scraper output to the API under one of your synthetic sellers.

## Suggested next 3 actions, in order

1. **Submit the (now product-rich) `sitemap.xml` to Google Search Console.** Sitemap is fixed; the SEO unblock is real now, but Google won't notice until you submit it.
2. **Set up nightly Postgres backups to B2.** A backup-less production DB is a ticking clock — no urgency until there's user data, but the first restoreable backup should exist before that day arrives.
3. **Flip Cloudflare SSL/TLS from `Full` → `Full (strict)`** — Caddy certs are valid; the bootstrap reason for `Full` is gone. One dropdown.

Everything else (CI, automatic deploys, Search Console verification, brand-collision mitigation, French-language SEO) is downstream of those three.
