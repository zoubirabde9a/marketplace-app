# Scraper

Scripts for pulling real-world product data from Algerian classifieds (currently
just **Ouedkniss**) and feeding it into the marketplace catalog under one of our
own synthetic sellers.

> **Run on the operator's laptop only — never on `vps-eu`.** Playwright pulls down
> a full Chromium and the scraper is bounded by design (default ≤ 30 listings
> per run); both are operator-tooling concerns, not production runtime concerns.
>
> The seeders that consume the scrape *can* run anywhere — see "Two seeding paths"
> below for the API-vs-direct-DB choice.

---

## Files in this folder

| File | What it does |
|---|---|
| [`scrape-ouedkniss.mjs`](./scrape-ouedkniss.mjs) | Playwright-driven scraper. Walks category index pages until it has **N** candidate listings, fetches each, and extracts title, description, og-images, price text, JSON-LD blobs, and posting date. Writes a JSON dump to `data/ouedkniss-<category>-<timestamp>.json`. **Does NOT scrape seller phone numbers.** |
| [`seed-from-scraped.mjs`](./seed-from-scraped.mjs) | **API-mode seeder.** Reads a JSON dump from the scraper and POSTs each listing as a product under one of our own synthetic sellers. Goes through the API's auth + validation; needs `DEV_BYPASS=1` or a `SESSION_JWT`. Use this against dev or when you want the API to validate inputs. |
| _(in `packages/db/src/seed-from-scraped.ts`)_ | **Direct-DB seeder.** Same input, but writes through the `@marketplace/db` repos straight into Postgres. Skips Caddy and the API auth gate — the script you run on the live server. Invoked via `pnpm -F @marketplace/db db:seed-from-scraped <json>`. |

---

## Legal & privacy posture

Ouedkniss's terms of service prohibit automated harvesting of seller contact
details. Running these scripts in production against real sellers can violate:

- (a) **Ouedkniss ToS**,
- (b) **Algerian Law 18-07** on the protection of personal data, and
- (c) **GDPR** if any listed seller is in the EU.

The default config is intentionally tiny (`N=30` listings) and the scraper
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
# Default: c/telephone, target N=30 listings, 3-day freshness filter.
node scraper/scrape-ouedkniss.mjs

# Or another category, with a higher target:
CATEGORY=informatique N=50 node scraper/scrape-ouedkniss.mjs

# Drop the freshness filter if you don't care how old listings are:
MAX_AGE_DAYS=0 N=20 node scraper/scrape-ouedkniss.mjs
```

Output goes to `data/ouedkniss-<category>-<timestamp>.json`. The scraper keeps
walking category index pages and topping up post-filter listings until it has
`N` items or `MAX_PAGES` is hit (whichever comes first).

### 3. Seed from the scrape — pick a path

You have two ways to load the JSON into the catalog. They are functionally
equivalent in what ends up in Postgres; they differ in **how** they get there.

#### Two seeding paths

| | **API mode** (`scraper/seed-from-scraped.mjs`) | **Direct-DB mode** (`packages/db/src/seed-from-scraped.ts`) |
|---|---|---|
| Talks to | `POST /v1/products` over HTTP | Postgres directly via `@marketplace/db` repos |
| Needs | API running + `DEV_BYPASS=1` or `SESSION_JWT` | Just `DATABASE_URL` |
| Validation | Full API request validation (zod schemas, auth, idempotency) | Same DB constraints, **no zod / no auth** |
| Where it runs | Operator laptop pointed at any base URL | Anywhere with DB reachability — operator laptop OR `vps-eu` |
| Idempotency | API-side `idempotency-key` (no duplicates on re-run) | None — re-running creates duplicates unless you wipe first |
| Use when | Hitting an API you don't run (staging, prod with auth on) | Running on the live server, or you want zero API hops |

**Rule of thumb:** if the box you're running the seeder on can `psql` the
database, prefer direct-DB. It's one fewer thing to authenticate and one fewer
thing that can return 5xx mid-batch.

#### Path 3a — API mode

First make sure synthetic sellers exist (run `scripts/seed-algerian.mjs` if not),
then grab a `sellerId` from its log and pass it as `SELLER_ID`:

```bash
SELLER_ID=<uuid-of-a-synthetic-seller> \
  MARKETPLACE_BASE=https://api.teno-store.com \
  node scraper/seed-from-scraped.mjs data/ouedkniss-telephone-<timestamp>.json
```

If the API requires auth, also set `SESSION_JWT` (or temporarily enable
`DEV_BYPASS=1` on the server per [runbook 06](../deploy/runbooks/06-seed-catalog.md)).

#### Path 3b — Direct-DB mode (recommended on the live server)

Run from anywhere that can reach the Postgres instance — most commonly
SSH'ing into `vps-eu` and pointing at the bind-mounted compose Postgres:

```bash
# On vps-eu (Postgres is exposed on the docker network as `postgres:5432`,
# but the host can reach it as 127.0.0.1:5432 if you've added a bind, or
# you can just exec inside the api container which already has DATABASE_URL).
ssh vps-eu
cd /opt/marketplace

# Option 1: run inside the api container (DATABASE_URL is already in env)
docker compose -f docker-compose.prod.yml exec api \
  pnpm -F @marketplace/db db:seed-from-scraped /tmp/ouedkniss-telephone-<ts>.json

# Option 2: from a workspace checkout on the host, against the docker Postgres
DATABASE_URL=postgres://marketplace:$POSTGRES_PASSWORD@127.0.0.1:5432/marketplace \
  pnpm -F @marketplace/db db:seed-from-scraped \
    /opt/marketplace/data/ouedkniss-telephone-<ts>.json
```

If `SELLER_ID` is unset, the seeder picks the **oldest existing seller** —
useful when you've just run `seed-algerian.mjs` and want everything to land
under the first synthetic seller. Pass `SELLER_ID=<uuid>` to override.

Use `DRY_RUN=1` to see what would be inserted without writing anything.

---

## `scrape-ouedkniss.mjs` — env knobs

| Var | Default | Meaning |
|---|---|---|
| `CATEGORY` | `telephone` | Ouedkniss category slug (`/c/<category>`) |
| `N` | `30` | Target post-filter listing count. The scraper paginates until it has N items or `MAX_PAGES` is hit. |
| `MAX_PAGES` | `20` | Hard cap on category index pages walked, to avoid runaway pagination if the site has fewer than `N` fresh items. |
| `MAX_AGE_DAYS` | `3` | Skip listings posted more than N days ago (`0` = no filter). When > 0, listings whose posting date can't be parsed are also skipped — we can't certify their age. |
| `DELAY_MS` | `4000` | Pause between index pages (ms) |
| `LISTING_DELAY_MS` | `2500` | Pause between individual listing fetches (ms) |
| `BATCH_SIZE` | `10` | Process listings in batches of N |
| `BATCH_PAUSE_MS` | `8000` | Pause between batches (ms) — gives rate limits a breather |
| `MAX_LISTINGS` | _(alias for `N`)_ | Back-compat — read if `N` is unset |
| `PAGES` | _(alias for `MAX_PAGES`)_ | Back-compat — read if `MAX_PAGES` is unset |

The scraper uses the user-agent
`teno-store-research/1.0 (+https://teno-store.com/about)` and locale `fr-FR`,
runs Chromium headless, and sets `waitUntil: networkidle` on category pages
(Ouedkniss is a Vue SPA).

### Output JSON shape

```jsonc
{
  "category": "telephone",
  "targetCount": 30,         // value of N at scrape time
  "pagesWalked": 4,          // index pages actually fetched
  "count": 30,               // post-filter listings written
  "items": [
    {
      "url": "https://www.ouedkniss.com/annonce/...",
      "scrapedAt": "2026-05-10T08:00:00.000Z",
      "postedAt":  "2026-05-09T14:23:00.000Z",  // null if unparseable
      "title": "iPhone 15 Pro 256GB ...",
      "description": "...",
      "images": ["https://...jpg", ...],
      "priceText": "180 000 DA",
      "structuredData": [{ ...JSON-LD blobs from the page... }],
      "timeAttrs": ["2026-05-09T14:23:00+01:00"],
      "relativeText": "Publiée il y a 1 jour"
    }
  ]
}
```

---

## `seed-from-scraped.mjs` — env knobs (API mode)

| Var | Default | Meaning |
|---|---|---|
| `MARKETPLACE_BASE` | `http://127.0.0.1:3100` | API base URL |
| `SESSION_JWT` | _(unset)_ | Optional Bearer token for authenticated runs |
| `SELLER_ID` | **required** | UUID of the synthetic seller these products attach to |

---

## `db:seed-from-scraped` — env knobs (direct-DB mode)

| Var | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | **required** | Postgres connection string |
| `SELLER_ID` | _(oldest seller)_ | UUID of an existing org / seller to attach products to. If unset the script picks the oldest seller; if there are none, it aborts with a hint to run `db:seed` first. |
| `COUNTRY_CODE` | `DZ` | Used for `shipsTo` when the dump has no value of its own |
| `DRY_RUN` | _(unset)_ | When `1`, parse and print what would be written, but don't touch the DB |

---

## Behaviour notes (both seeders)

- Brand is inferred from the title via a known-brand list with canonical
  remappings (e.g. `Redmi`/`POCO` → `Xiaomi`, `iPhone`/`Galaxy` → `Apple`/`Samsung`).
- Prices are parsed from text like `"150 000 DA"` / `"1.250.000 DZD"` and
  emitted as `priceMinor` (santeem, i.e. DZD × 100).
- Each product carries a `source: "ouedkniss-public-listing"` attribute plus
  `sourceUrl`, `sourceCategory`, and (when present) `sourcePostedAt` for
  traceability.
- Up to 5 image URLs per listing are forwarded as `media` entries.
- Listings missing either a title or a parseable price are skipped (logged
  but counted as `skipped`, not `failed`).

---

## Adding a new scraper

The current architecture pins the scraper to Ouedkniss specifically, but the
seeders are source-agnostic — they only care about the JSON dump shape (see
"Output JSON shape" above). To add a second source (e.g. Jumia DZ):

1. Write a new `scrape-<source>.mjs` that emits the same JSON shape
   (`{ category, count, items: [{ url, title, description, images, priceText,
   postedAt, ... }] }`). Reuse `parsePostedAt`/`ageDays` from
   `scrape-ouedkniss.mjs` if the date semantics match.
2. Both seeders will Just Work on the dump, since they key off `title`,
   `priceText`, `images`, `description`, and the optional `postedAt`/`url`
   fields. The `sourceCategory` attribute on the resulting product will reflect
   whatever `category` the dump declares.
3. Update this README's "Files in this folder" table and add a row to the
   posture section listing that source's ToS / privacy considerations.

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
