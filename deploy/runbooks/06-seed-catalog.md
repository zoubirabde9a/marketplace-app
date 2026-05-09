# Runbook 06 — seed the production catalog

Until the catalog has products, the marketplace home page is a brochure and Google has nothing to index beyond the apex URL. This runbook walks through populating it.

Two paths are available, in increasing order of legal cleanliness:

| Path | Source | Real personal data? | Notes |
|---|---|---|---|
| **A. Synthetic Algerian-style** (default) | Hand-curated in `scripts/seed-algerian.mjs` | No — placeholder `+213 555 00 XX XX` numbers | Safe to run today. ~17 products, 5 sellers. |
| **B. Scraped from Ouedkniss** (advanced) | `scripts/scrape-ouedkniss.mjs` (Playwright) | No (script does NOT scrape phones) | Pulls real titles + prices + images, marries them to synthetic sellers from Path A. |

Path A is the default. Path B requires Playwright on the operator's machine and is bounded to ≤30 listings per run.

---

## Path A — synthetic Algerian-style catalog (recommended first run)

### Prerequisite: a way to authenticate writes

`POST /v1/sellers` and `POST /v1/products` are gated by either an Agent Passport (DPoP-bound) or a marketplace user session. The simplest one-off path is **temporary `DEV_BYPASS=1`** on `vps-eu` for the duration of the seed run.

> Security: `DEV_BYPASS=1` accepts arbitrary `x-mp-*` headers as a synthetic principal. **Never leave it on.** The plan is: enable, run seeder, disable, restart. End-to-end takes < 2 minutes.

### Steps

```bash
# 1. SSH in
ssh vps-eu

# 2. Edit /opt/marketplace/.env, set DEV_BYPASS=1 temporarily
sed -i 's/^DEV_BYPASS=.*/DEV_BYPASS=1/' /opt/marketplace/.env

# 3. Bounce just the api container so it re-reads .env
cd /opt/marketplace
docker compose restart api

# 4. From the operator's laptop (NOT the server), run the seeder pointed at prod.
#    The seeder relies on DEV_BYPASS so no JWT is needed.
exit  # back to laptop

MARKETPLACE_BASE=https://api.teno-store.com \
  node scripts/seed-algerian.mjs

# 5. SSH back in and turn DEV_BYPASS back off
ssh vps-eu
sed -i 's/^DEV_BYPASS=.*/DEV_BYPASS=0/' /opt/marketplace/.env
docker compose restart api
exit

# 6. Verify
curl -s https://api.teno-store.com/v1/products | jq '.pagination.totalEstimate'
# → should now be > 0
curl -s https://teno-store.com/sitemap.xml | grep -c '<url>'
# → should now exceed 2
```

### What this gets you

- 5 sellers across Alger, Oran, Constantine, Annaba, Sétif — each with phone + WhatsApp.
- 17 products spanning smartphones, used cars, traditional/modern fashion, computers, and home goods, all priced in DZD.
- Seller phones are clearly placeholder (`+213 555 00 XX XX`) so we don't carry real personal data.
- Sitemap auto-grows because `packages/web/src/app/sitemap.ts` already pulls from `/v1/products`.

---

## Path B — augmenting with scraped real-world products

Use this **only** to enrich the catalog with realistic product titles + prices + photos. The script does NOT scrape seller phone numbers — those are gated behind a click on Ouedkniss, and copying them would clearly violate Algerian Law 18-07 and Ouedkniss's ToS.

```bash
# On the operator's machine (NOT vps-eu):
pnpm add -D playwright
pnpm exec playwright install chromium

# Default: 3 pages of c/telephone, max 30 listings, ~4s per page, polite.
node scripts/scrape-ouedkniss.mjs

# Or another category:
CATEGORY=informatique PAGES=2 node scripts/scrape-ouedkniss.mjs

# Output goes to data/ouedkniss-<category>-<timestamp>.json.
```

Marrying the scraped JSON to the seeder (TODO):
- Write `scripts/seed-from-scraped.mjs` that reads the JSON, picks one of the synthetic sellers (NOT a real Ouedkniss seller), creates products under that seller using the scraped title / price / image URLs.
- This keeps the legal posture clean: the seller identity is yours; only the product descriptions are inspired by public listings.

---

## Common failures & fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `POST /v1/sellers → 401` | `DEV_BYPASS=0` and no session JWT | Enable `DEV_BYPASS=1` per Path A step 2, or pass `SESSION_JWT=<jwt>` env var. |
| `POST /v1/products → 422` | `priceMinor` not coercible to bigint | Pass it as a string like `"3000000"`, not the number 3000000. |
| `idempotency-key` validation error | key < 8 chars | The seeder uses `${prefix}-${base36}-${0000}` which is always > 8 chars; ignore unless you've edited it. |
| Sitemap still shows 2 URLs after seed | Cache or sitemap pulls from a stale source | `packages/web/src/app/sitemap.ts` reads `/v1/products` at request time — but Cloudflare may cache for ~5 min. Hit `https://teno-store.com/sitemap.xml?cb=$(date +%s)`. |

---

## After seeding succeeds

1. Submit the sitemap to **Google Search Console** (Property → `teno-store.com` → Sitemaps → add `https://teno-store.com/sitemap.xml`). This is the single biggest SEO step right now — without it, Google will eventually find us via crawl, but submission accelerates indexing from "weeks" to "days".
2. Submit to **Bing Webmaster Tools** — same flow.
3. Run a **Google Rich Results Test** on one product URL (`https://search.google.com/test/rich-results`) — confirms the schema.org/Product JSON-LD on the product page is parseable.
4. Decide whether to flip Cloudflare SSL/TLS from `Full` → `Full (strict)` (this was already noted as a follow-up in the 2026-05-08 deploy entry).
