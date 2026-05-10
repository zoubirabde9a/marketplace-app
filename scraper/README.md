# Scraper

Scripts for pulling real-world product data from Algerian classifieds (currently
just **Ouedkniss**) and feeding it into the marketplace catalog under one of our
own synthetic sellers.

> **Run on the operator's laptop only — never on `vps-eu`.** Playwright pulls down
> a full Chromium and the scraper is bounded by design (≤30 listings per default
> run); both are operator-tooling concerns, not production runtime concerns.

---

## Files in this folder

| File | What it does |
|---|---|
| [`scrape-ouedkniss.mjs`](./scrape-ouedkniss.mjs) | Playwright-driven scraper. Walks N category index pages, then visits each listing and extracts title, description, og-images, price text, JSON-LD blobs, and posting date. Writes a JSON dump to `data/ouedkniss-<category>-<timestamp>.json`. **Does NOT scrape seller phone numbers.** |
| [`seed-from-scraped.mjs`](./seed-from-scraped.mjs) | Reads a JSON dump from the scraper and POSTs each listing as a product under one of our own synthetic sellers (e.g. those created by `scripts/seed-algerian.mjs`). The scraped seller's identity is never copied — only public product data (title, image URLs, price text). |

---

## Legal & privacy posture

Ouedkniss's terms of service prohibit automated harvesting of seller contact
details. Running these scripts in production against real sellers can violate:

- (a) **Ouedkniss ToS**,
- (b) **Algerian Law 18-07** on the protection of personal data, and
- (c) **GDPR** if any listed seller is in the EU.

The default config is intentionally tiny (3 pages, 30 listings) and the scraper
**deliberately does not extract phone numbers** — the "Voir le numéro" reveal is
gated behind a click on Ouedkniss, and copying it at scale crosses from
research-fair-use into clear ToS / privacy violation territory.

The chosen posture: real product titles, prices, and images are reproducible
under our own synthetic sellers; **no real personal data of unrelated third
parties is ever carried**. If we ever want real seller phones, that requires
explicit consent from each seller, not scraping.

---

## End-to-end usage

### 1. Install Playwright (one-off, operator's machine)

```bash
pnpm add -D playwright
pnpm exec playwright install chromium
```

### 2. Scrape

```bash
# Default: 3 pages of c/telephone, max 30 listings, ~4s per page, polite.
node scraper/scrape-ouedkniss.mjs

# Or another category:
CATEGORY=informatique PAGES=2 node scraper/scrape-ouedkniss.mjs
```

Output goes to `data/ouedkniss-<category>-<timestamp>.json`.

### 3. Seed from the scrape

First make sure synthetic sellers exist (run `scripts/seed-algerian.mjs` if not),
then grab a `sellerId` from its log and pass it as `SELLER_ID`:

```bash
SELLER_ID=<uuid-of-a-synthetic-seller> \
  MARKETPLACE_BASE=https://api.teno-store.com \
  node scraper/seed-from-scraped.mjs data/ouedkniss-telephone-<timestamp>.json
```

If the API requires auth, also set `SESSION_JWT` (or temporarily enable
`DEV_BYPASS=1` on the server per [runbook 06](../deploy/runbooks/06-seed-catalog.md)).

---

## `scrape-ouedkniss.mjs` — env knobs

| Var | Default | Meaning |
|---|---|---|
| `CATEGORY` | `telephone` | Ouedkniss category slug (`/c/<category>`) |
| `PAGES` | `10` | Number of category index pages to walk |
| `DELAY_MS` | `4000` | Pause between index pages (ms) |
| `LISTING_DELAY_MS` | `2500` | Pause between individual listing fetches (ms) |
| `MAX_LISTINGS` | `200` | Hard cap on listings collected |
| `MAX_AGE_DAYS` | `3` | Skip listings posted more than N days ago (`0` = no filter). When > 0, listings whose posting date can't be parsed are also skipped — we can't certify their age. |
| `BATCH_SIZE` | `10` | Process listings in batches of N |
| `BATCH_PAUSE_MS` | `8000` | Pause between batches (ms) — gives rate limits a breather |

The scraper uses the user-agent
`teno-store-research/1.0 (+https://teno-store.com/about)` and locale `fr-FR`,
runs Chromium headless, and sets `waitUntil: networkidle` on category pages
(Ouedkniss is a Vue SPA).

---

## `seed-from-scraped.mjs` — env knobs

| Var | Default | Meaning |
|---|---|---|
| `MARKETPLACE_BASE` | `http://127.0.0.1:3100` | API base URL |
| `SESSION_JWT` | _(unset)_ | Optional Bearer token for authenticated runs |
| `SELLER_ID` | **required** | UUID of the synthetic seller these products attach to |

Behaviour notes:

- Brand is inferred from the title via a known-brand list with canonical
  remappings (e.g. `Redmi`/`POCO` → `Xiaomi`, `iPhone`/`Galaxy` → `Apple`/`Samsung`).
- Prices are parsed from text like `"150 000 DA"` / `"1.250.000 DZD"` and
  emitted as `priceMinor` (santeem, i.e. DZD × 100) as a string.
- Each product carries a `source: "ouedkniss-public-listing"` attribute plus
  `sourceUrl`, `sourceCategory`, and (when present) `sourcePostedAt` for
  traceability.
- Up to 5 image URLs per listing are forwarded as `media` entries.

---

## Related documentation

- **[`deploy/runbooks/06-seed-catalog.md`](../deploy/runbooks/06-seed-catalog.md)** —
  full runbook for populating the production catalog. Path A is synthetic-only
  (`scripts/seed-algerian.mjs`); Path B uses the scripts in this folder.
- **[`deploy/CHANGELOG.md`](../deploy/CHANGELOG.md)** — see the 2026-05-08 entry
  for the original rationale behind the scraper's design (privacy posture,
  bounded defaults, no phone scraping).
- **[`deploy/STATUS.md`](../deploy/STATUS.md)** — current state of the
  production catalog and what was last seeded.
