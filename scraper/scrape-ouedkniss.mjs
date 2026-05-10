// Scrapes Ouedkniss listings via their public GraphQL API into a JSON file.
//
// REWRITE NOTE (2026-05-09): the previous version drove a headless Chromium and
// scraped rendered DOM anchors. That stopped working when Ouedkniss became a
// fully client-rendered SPA — listings are no longer in the initial HTML, and
// the legacy URL pattern /c/<slug>?page=N now redirects to a numeric category
// id and renders an empty results page. The 2026-standard approach for
// SPA/Apollo sites is to call the same GraphQL endpoint the site itself calls.
// We discovered the operation by capturing XHR traffic from the live site.
//
// USE WITH CARE — Ouedkniss's terms of service prohibit automated harvesting
// of seller contact details. This script only requests public listing fields
// (title, description, price, refreshedAt, images, category, city). It does
// NOT request `phone`, `whatsapp`, or `user`-detail fields. Running this in
// production against real sellers may still implicate (a) Ouedkniss ToS,
// (b) Algerian Law 18-07 on protection of personal data, and (c) GDPR if any
// listed seller is in the EU. The default config below is intentionally small
// (1 page, 48 listings). Do not crank it up without legal sign-off.
//
// Setup: nothing beyond Node 20 (built-in fetch).
//
// Usage:
//   node scripts/scrape-ouedkniss.mjs                          # default category
//   CATEGORY=telephones-tablettes PAGES=3 node scripts/scrape-ouedkniss.mjs
//
// Env knobs:
//   CATEGORY=<slug>       Ouedkniss category slug (e.g. telephones-tablettes,
//                         informatique, vehicules, immobilier). Default: telephones-tablettes.
//                         The legacy slug "telephone" is auto-mapped.
//   PAGES=1               number of pages to walk (each page = up to PAGE_SIZE items)
//   PAGE_SIZE=48          items per page (Ouedkniss allows up to 48)
//   MAX_LISTINGS=200      hard cap across all pages
//   MAX_AGE_DAYS=3        skip listings refreshed more than N days ago (0 = no filter).
//                         When > 0, listings with no parseable date are also skipped —
//                         we can't certify their age.
//   BATCH_SIZE=10         emit a "batch n/N" log line every N items (the GraphQL API
//                         already paginates server-side, so batching is purely about
//                         pacing our own requests + log readability).
//   BATCH_PAUSE_MS=4000   pause between page requests (rate-limit politeness)
//
// Output: data/ouedkniss-<category>-<timestamp>.json
//   Each item carries `postedAt` (ISO 8601) — the Ouedkniss `refreshedAt` field.
//
// Then feed the JSON into scripts/seed-from-scraped.mjs.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "..", "data");

// Legacy slug → current slug map. Keeps old invocations working.
// Real slugs come from Ouedkniss's listingMenu GraphQL op (verified 2026-05-09):
// telephones, automobiles_vehicules, immobilier, informatique,
// electronique_electromenager, vetements_mode, sante_beaute, ...
// Sub-categories: telephones-smartphones, telephones-tablets, etc.
const SLUG_ALIASES = {
  telephone: "telephones",
  "telephones-tablettes": "telephones",
  smartphones: "telephones-smartphones",
  tablettes: "telephones-tablets",
};

const CATEGORY_RAW = process.env.CATEGORY ?? "telephones";
const CATEGORY = SLUG_ALIASES[CATEGORY_RAW] ?? CATEGORY_RAW;
const PAGES = Math.max(1, Number(process.env.PAGES ?? 1));
const START_PAGE = Math.max(1, Number(process.env.START_PAGE ?? 1));
const PAGE_SIZE = Math.min(48, Math.max(1, Number(process.env.PAGE_SIZE ?? 48)));
const MAX_LISTINGS = Number(process.env.MAX_LISTINGS ?? 200);
const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS ?? 3);
const BATCH_SIZE = Math.max(1, Number(process.env.BATCH_SIZE ?? 10));
const BATCH_PAUSE_MS = Number(process.env.BATCH_PAUSE_MS ?? 4000);

const GRAPHQL_URL = "https://api.ouedkniss.com/graphql";
const BASE_URL = "https://www.ouedkniss.com";

// Minimal SearchQuery — only the fields we actually surface in the marketplace.
// We deliberately omit `user`, `phone`, anything tied to seller identity.
const SEARCH_QUERY = `query SearchQuery($q: String, $filter: SearchFilterInput) {
  search(q: $q, filter: $filter) {
    announcements {
      data {
        id
        title
        slug
        refreshedAt
        description
        price
        pricePreview
        priceUnit
        defaultMedia(size: MEDIUM) { mediaUrl mimeType }
        medias(size: SMALL) { mediaUrl mimeType }
        category { id slug name }
        cities { id name region { id name } }
      }
      paginatorInfo { lastPage hasMorePages }
    }
  }
}`;

function ageDays(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 86400_000;
}

async function searchPage(page, attempt = 1) {
  const body = {
    operationName: "SearchQuery",
    variables: {
      q: null,
      filter: {
        categorySlug: CATEGORY,
        priceRange: [],
        regionIds: [],
        cityIds: [],
        fields: [],
        page,
        count: PAGE_SIZE,
        orderByField: { field: "REFRESHED_AT" },
      },
    },
    query: SEARCH_QUERY,
  };
  try {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "teno-store-research/1.0 (+https://teno-store.com/about)",
        "accept-language": "fr-FR,fr;q=0.9",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`graphql ${res.status}: ${await res.text().catch(() => "")}`);
    const json = await res.json();
    if (json.errors) throw new Error(`graphql errors: ${JSON.stringify(json.errors).slice(0, 300)}`);
    return json.data?.search?.announcements ?? { data: [], paginatorInfo: { hasMorePages: false } };
  } catch (err) {
    if (attempt < 3) {
      const backoff = 1500 * attempt;
      console.log(`  [retry ${attempt}] page ${page} after ${backoff}ms: ${err.message ?? err}`);
      await new Promise((r) => setTimeout(r, backoff));
      return searchPage(page, attempt + 1);
    }
    throw err;
  }
}

function priceText(item) {
  // Ouedkniss returns priceUnit as a GraphQL enum string ("UNIT", "MILLION", etc.).
  // For seeding purposes the seeder only cares about digits, but a human-readable
  // label is nicer. UNIT means "as-is in DZD"; everything else we leave as-is so
  // the seeder logs are still informative.
  const labelFor = (u) => (u === "UNIT" || u == null ? "DA" : `${u}`);
  if (item.pricePreview != null && item.pricePreview !== "" && item.pricePreview !== "0") {
    return `${item.pricePreview} ${labelFor(item.priceUnit)}`;
  }
  if (item.price != null && Number(item.price) > 0) {
    return `${item.price} ${labelFor(item.priceUnit)}`;
  }
  return null;
}

function imagesOf(item) {
  const out = [];
  if (item.defaultMedia?.mediaUrl) {
    out.push(item.defaultMedia.mediaUrl);
  }
  for (const m of item.medias ?? []) {
    if (m?.mediaUrl && !out.includes(m.mediaUrl)) out.push(m.mediaUrl);
  }
  return out;
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  console.log(`[start] category=${CATEGORY} startPage=${START_PAGE} pages=${PAGES} pageSize=${PAGE_SIZE} maxAgeDays=${MAX_AGE_DAYS}`);
  if (CATEGORY !== CATEGORY_RAW) console.log(`        (mapped legacy slug "${CATEGORY_RAW}" -> "${CATEGORY}")`);

  const results = [];
  let tooOld = 0;
  let undated = 0;
  let totalSeen = 0;
  let batchNo = 0;
  let lastPageScraped = START_PAGE - 1;
  let hasMorePages = true;
  const endPage = START_PAGE + PAGES - 1;

  for (let page = START_PAGE; page <= endPage; page++) {
    if (results.length >= MAX_LISTINGS) break;
    console.log(`[page ${page} of ${START_PAGE}..${endPage}] requesting ${PAGE_SIZE} items...`);
    let pageResp;
    try {
      pageResp = await searchPage(page);
    } catch (err) {
      console.error(`  page ${page} failed: ${err.message ?? err}`);
      break;
    }
    lastPageScraped = page;
    hasMorePages = !!pageResp.paginatorInfo?.hasMorePages;
    const items = pageResp.data ?? [];
    console.log(`  got ${items.length} items, hasMore=${pageResp.paginatorInfo?.hasMorePages}`);

    for (const it of items) {
      if (results.length >= MAX_LISTINGS) break;
      totalSeen++;
      const postedAt = it.refreshedAt ? new Date(it.refreshedAt).toISOString() : null;
      if (MAX_AGE_DAYS > 0 && !postedAt) {
        undated++;
        continue;
      }
      if (MAX_AGE_DAYS > 0 && ageDays(postedAt) > MAX_AGE_DAYS) {
        tooOld++;
        continue;
      }

      const url = it.slug ? `${BASE_URL}/annonce/${it.slug}` : `${BASE_URL}/annonce/${it.id}`;
      results.push({
        url,
        scrapedAt: new Date().toISOString(),
        postedAt,
        title: it.title ?? null,
        description: it.description ?? null,
        images: imagesOf(it),
        priceText: priceText(it),
        category: it.category?.slug ?? null,
        cityNames: (it.cities ?? []).map((c) => c.name).filter(Boolean),
        wilayaNames: Array.from(
          new Set(
            (it.cities ?? [])
              .map((c) => c.region?.name)
              .filter(Boolean),
          ),
        ),
      });

      if (results.length % BATCH_SIZE === 0) {
        batchNo++;
        const pct = Math.min(100, Math.round((results.length / MAX_LISTINGS) * 100));
        console.log(`  [batch ${batchNo}] kept ${results.length} so far (${pct}% of cap)`);
      }
    }

    if (!hasMorePages) {
      console.log("  no more pages");
      break;
    }
    if (page < endPage && results.length < MAX_LISTINGS) {
      await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
    }
  }

  console.log(`\n[done] kept ${results.length}, dropped ${tooOld} as older than ${MAX_AGE_DAYS}d, ${undated} undated, of ${totalSeen} seen`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(DATA_DIR, `ouedkniss-${CATEGORY}-${stamp}.json`);
  await writeFile(
    outPath,
    JSON.stringify({
      category: CATEGORY,
      pages: PAGES,
      startPage: START_PAGE,
      lastPageScraped,
      hasMorePages,
      count: results.length,
      items: results,
    }, null, 2),
  );
  console.log(`wrote ${outPath} (${results.length} listings)`);
  console.log("NB: phone numbers are NOT requested — the GraphQL query intentionally omits user/seller-contact fields.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
