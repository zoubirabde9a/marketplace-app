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
//   OUEDKNISS_JWT=<token> optional Bearer token obtained by solving the reCAPTCHA on
//                         ouedkniss.com once and copying the JWT from a captured
//                         /login-anonymous response (or any subsequent GraphQL call's
//                         Authorization header). When set, the scraper resolves the
//                         per-listing phone via the announcementPhoneGet query and
//                         attaches it to each item as `phoneEntries`. When unset or
//                         the token returns 401/empty, the scraper falls back to
//                         siteBuildGetByStore-only enrichment (shop phones only).
//                         Re-seed when the JWT expires — the scraper logs a clear
//                         warning so the operator knows when that happens.
//   PHONE_FETCH_PAUSE_MS=120  pause between per-listing announcementPhoneGet calls
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
// electronique_electromenager, vetements_mode, ...
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
const OUEDKNISS_JWT = (process.env.OUEDKNISS_JWT ?? "").trim();
const PHONE_FETCH_PAUSE_MS = Number(process.env.PHONE_FETCH_PAUSE_MS ?? 120);

const GRAPHQL_URL = "https://api.ouedkniss.com/graphql";
const BASE_URL = "https://www.ouedkniss.com";
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS ?? 15000);

// fetch + AbortController timeout. Native fetch has no built-in timeout, so a
// dead TCP connection or a hung Ouedkniss endpoint would otherwise stall the
// whole run forever. All scraper HTTP traffic goes through here.
async function fetchWithTimeout(url, init = {}, ms = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`timeout after ${ms}ms`)), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

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
        # Seller identity (public): we capture the Ouedkniss user id so the
        # seeder can group products under one teno-store seller per real
        # Ouedkniss seller. displayName is never reused — the seeder
        # generates a synthetic name. isFromStore + store{id} lets us look
        # up real public phone numbers via siteBuildGetByStore (shop-account
        # listings only — individual-seller phones are auth-gated and not
        # reachable anonymously).
        user { id }
        isFromStore
        store { id }
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
    const res = await fetchWithTimeout(GRAPHQL_URL, {
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

// Convert Ouedkniss's (value, priceUnit) pair into a real DZD-denominated
// integer. priceUnit is a GraphQL enum:
//   UNIT     — value is already in DZD (typical for phones / electronics).
//   MILLION  — Algerian car-pricing slang. 1 "million" = 1,000,000 centimes
//              = 10,000 DZD. So multiply by 10,000.
//   BILLION  — same scale up: 1 "milliard" = 1,000 millions = 10,000,000 DZD.
// Anything else is treated as UNIT (logged below by the seeder if it ever
// stores DZD <1000, which is a useful canary).
const PRICE_UNIT_TO_DZD = {
  UNIT: 1,
  MILLION: 10_000,
  BILLION: 10_000_000,
};

function priceText(item) {
  // pricePreview is the seller-formatted string ("1.250.000") and is null /
  // "0" / empty when the seller didn't set a real price (Échange / Prix
  // négociable / similar). Trust `price` (numeric) as the source of truth
  // and fall back to pricePreview only when price is missing.
  let raw = item.price;
  if (raw == null) {
    raw = item.pricePreview;
  }
  if (raw == null || raw === "" || raw === "0" || Number(raw) === 0) return null;
  const value = typeof raw === "number" ? raw : Number(String(raw).replace(/[^\d]/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  const mult = PRICE_UNIT_TO_DZD[item.priceUnit] ?? 1;
  const dzd = value * mult;
  // Emit a canonical "<dzd> DA" string so the seeder's digit-only parser
  // produces the right priceMinor. No commas / dots so nothing strips wrong.
  return `${dzd} DA`;
}

// Fetch a public Ouedkniss store profile by store id. Returns
// { name, slug, phones[], whatsapp[], emails[], website, facebook,
//   address, lat, lng } or null if the store has no public site-build
// (some store accounts haven't published one).
async function fetchStoreProfile(storeId, attempt = 1) {
  const query = `query FetchByStore($id: ID!) {
    siteBuild: siteBuildGetByStore(storeId: $id) {
      land {
        __typename
        ... on Store {
          id
          storeName: name
          slug
          mainLocation {
            # hasWhatsapp / hasViber are public per-phone booleans Ouedkniss
            # publishes on the shop's site-build page. They let us mark
            # which numbers buyers can WhatsApp/Viber instead of guessing.
            phones { phone hasWhatsapp hasViber }
            emails
            socials { name url }
            location { address lat lng city { name region { name } } }
          }
        }
      }
    }
  }`;
  try {
    const res = await fetchWithTimeout(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "teno-store-research/1.0 (+https://teno-store.com/about)",
      },
      body: JSON.stringify({ operationName: "FetchByStore", query, variables: { id: storeId } }),
    });
    if (!res.ok) throw new Error(`store-fetch ${res.status}`);
    const json = await res.json();
    const land = json.data?.siteBuild?.land;
    if (!land || land.__typename !== "Store") return null;
    const loc = land.mainLocation ?? {};
    // Keep the per-phone metadata Ouedkniss publishes (hasWhatsapp/hasViber)
    // so the seeder can record one row per number with channel flags. Drop
    // entries with no phone string but otherwise preserve order.
    const phoneEntries = (loc.phones ?? [])
      .map((p) => (p?.phone ? { phone: String(p.phone), hasWhatsapp: !!p.hasWhatsapp, hasViber: !!p.hasViber } : null))
      .filter(Boolean);
    const phones = phoneEntries.map((p) => p.phone);
    const emails = (loc.emails ?? []).filter(Boolean);
    const socials = loc.socials ?? [];
    const pick = (name) => socials.find((s) => s?.name === name)?.url?.trim() || null;
    return {
      id: land.id,
      name: land.storeName ?? null,
      slug: land.slug ?? null,
      phones,
      phoneEntries,
      emails,
      website: pick("website"),
      facebook: pick("facebook"),
      whatsapp: pick("whatsapp"),
      telegram: pick("telegram"),
      address: loc.location?.address ?? null,
      city: loc.location?.city?.name ?? null,
      region: loc.location?.city?.region?.name ?? null,
    };
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 800 * attempt));
      return fetchStoreProfile(storeId, attempt + 1);
    }
    throw err;
  }
}

// Resolve the seller-published phones for a single listing via Ouedkniss's
// authenticated announcementPhoneGet GraphQL op. Requires a Bearer JWT in
// OUEDKNISS_JWT (obtained by solving the recaptcha-Token /login-anonymous
// handshake in a browser once). Returns an array of {phone, hasWhatsapp,
// hasViber, hasTelegram} (possibly empty) on success, null on auth failure.
async function fetchListingPhones(announcementId, jwtState, attempt = 1) {
  if (!OUEDKNISS_JWT || jwtState.disabled) return [];
  try {
    const res = await fetchWithTimeout(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${OUEDKNISS_JWT}`,
        origin: BASE_URL,
        referer: `${BASE_URL}/`,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      },
      body: JSON.stringify({
        operationName: "UnhidePhone",
        variables: { id: String(announcementId) },
        query: `query UnhidePhone($id: ID!) {
          phones: announcementPhoneGet(id: $id) {
            id phone phoneExt hasViber hasWhatsapp hasTelegram
          }
        }`,
      }),
    });
    if (res.status === 401 || res.status === 403) {
      jwtState.disabled = true;
      console.log(`[phones] JWT rejected (status ${res.status}); falling back to no-phone for remaining listings. Re-seed OUEDKNISS_JWT.`);
      return null;
    }
    if (!res.ok) throw new Error(`phone-fetch ${res.status}`);
    const json = await res.json();
    if (json.errors) {
      const code = json.errors?.[0]?.extensions?.code;
      if (code === "UNAUTHENTICATED" || code === "FORBIDDEN") {
        jwtState.disabled = true;
        console.log(`[phones] JWT rejected (errors=${JSON.stringify(json.errors).slice(0, 120)}); falling back. Re-seed OUEDKNISS_JWT.`);
        return null;
      }
      throw new Error(`phone-fetch errors: ${JSON.stringify(json.errors).slice(0, 200)}`);
    }
    const list = (json.data?.phones ?? []).filter((p) => p?.phone);
    return list.map((p) => ({
      phone: String(p.phone),
      hasWhatsapp: !!p.hasWhatsapp,
      hasViber: !!p.hasViber,
      hasTelegram: !!p.hasTelegram,
    }));
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 400 * attempt));
      return fetchListingPhones(announcementId, jwtState, attempt + 1);
    }
    console.log(`  [phones] listing ${announcementId}: ${err.message ?? err}`);
    return [];
  }
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
  const stores = {};
  let lastPageScraped = START_PAGE - 1;
  let hasMorePages = true;
  // Always write what we have, even if a later phase throws. The run-loop
  // shell parser reads the JSON to advance state and seed; losing partial
  // results to a transient crash means the next iteration re-walks the
  // same pages and skip-urls dedupes them — wasted work, no progress.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(DATA_DIR, `ouedkniss-${CATEGORY}-${stamp}.json`);
  const writePartialOutput = async (note = "") => {
    try {
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
          stores,
        }, null, 2),
      );
      console.log(`wrote ${outPath} (${results.length} listings, ${Object.keys(stores).length} stores)${note ? " — " + note : ""}`);
    } catch (err) {
      console.error(`failed to write ${outPath}: ${err?.message ?? err}`);
    }
  };
  let tooOld = 0;
  let undated = 0;
  let totalSeen = 0;
  let batchNo = 0;
  lastPageScraped = START_PAGE - 1;
  const endPage = START_PAGE + PAGES - 1;

  let pageFailures = 0;
  let itemFailures = 0;
  try {
  for (let page = START_PAGE; page <= endPage; page++) {
    if (results.length >= MAX_LISTINGS) break;
    console.log(`[page ${page} of ${START_PAGE}..${endPage}] requesting ${PAGE_SIZE} items...`);
    let pageResp;
    try {
      pageResp = await searchPage(page);
    } catch (err) {
      pageFailures++;
      console.error(`  page ${page} failed: ${err.message ?? err}; continuing with next page`);
      // Keep going — a single page-level failure (rate limit, transient 5xx,
      // network blip) shouldn't blow up the whole run. We still advance
      // lastPageScraped so run-loop state moves forward instead of looping
      // on the same dead page. If every page in the slice fails, we exit
      // with whatever we collected.
      lastPageScraped = page;
      continue;
    }
    lastPageScraped = page;
    hasMorePages = !!pageResp.paginatorInfo?.hasMorePages;
    const items = pageResp.data ?? [];
    console.log(`  got ${items.length} items, hasMore=${pageResp.paginatorInfo?.hasMorePages}`);

    for (const it of items) {
      if (results.length >= MAX_LISTINGS) break;
      totalSeen++;
      try {
      const postedAt = it.refreshedAt ? new Date(it.refreshedAt).toISOString() : null;
      if (MAX_AGE_DAYS > 0 && !postedAt) {
        undated++;
        continue;
      }
      if (MAX_AGE_DAYS > 0 && ageDays(postedAt) > MAX_AGE_DAYS) {
        tooOld++;
        continue;
      }

      // Canonical Ouedkniss listing URL on the live SPA is "<slug>-d<id>".
      // The legacy "/annonce/<slug>" form we used to emit doesn't render
      // any content on the current site (it serves the SPA shell but the
      // router has no matching route). Always prefer the canonical form;
      // fall back to "/<id>" if no slug is present.
      const url = it.slug && it.id
        ? `${BASE_URL}/${it.slug}-d${it.id}`
        : it.id
          ? `${BASE_URL}/${it.id}`
          : `${BASE_URL}/annonce/${it.slug ?? ""}`;
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
        ouedknissId: it.id ?? null,
        sellerUserId: it.user?.id ?? null,
        sellerIsFromStore: !!it.isFromStore,
        sellerStoreId: it.store?.id ?? null,
      });

      if (results.length % BATCH_SIZE === 0) {
        batchNo++;
        const pct = Math.min(100, Math.round((results.length / MAX_LISTINGS) * 100));
        console.log(`  [batch ${batchNo}] kept ${results.length} so far (${pct}% of cap)`);
      }
      } catch (err) {
        itemFailures++;
        console.error(`  item ${it?.id ?? "?"}: ${err?.message ?? err}; skipping`);
        continue;
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

  // ─── per-listing phone enrichment ──────────────────────────────────────
  // Authenticated path via announcementPhoneGet. Without a JWT this loop is
  // a no-op; with one it fills `phoneEntries` per item (one anonymous-login
  // JWT unlocks reveal across the whole run). 401/403 disables further
  // attempts gracefully — the seeder still writes products, just without
  // contact info, and the operator re-seeds the JWT.
  if (OUEDKNISS_JWT && results.length > 0) {
    console.log(`[phones] fetching per-listing phones for ${results.length} listings (JWT ${OUEDKNISS_JWT.slice(0, 12)}...)`);
    const jwtState = { disabled: false };
    let withPhone = 0;
    let withoutPhone = 0;
    for (let i = 0; i < results.length; i++) {
      if (jwtState.disabled) break;
      const item = results[i];
      if (!item.ouedknissId) continue;
      try {
        const entries = await fetchListingPhones(item.ouedknissId, jwtState);
        if (entries === null) break;
        if (entries.length > 0) {
          item.phoneEntries = entries;
          withPhone++;
        } else {
          withoutPhone++;
        }
      } catch (err) {
        // fetchListingPhones already retries internally and returns []; any
        // exception here is a programmer error (unexpected shape, etc.).
        // Don't let it sink the whole enrichment pass.
        console.log(`  [phones] unexpected error on ${item.ouedknissId}: ${err?.message ?? err}`);
      }
      if (PHONE_FETCH_PAUSE_MS > 0 && i < results.length - 1) {
        await new Promise((r) => setTimeout(r, PHONE_FETCH_PAUSE_MS));
      }
    }
    console.log(`[phones] enriched ${withPhone} listings, ${withoutPhone} had no phone, ${jwtState.disabled ? "JWT-DISABLED" : "ok"}`);
  } else if (!OUEDKNISS_JWT) {
    console.log("[phones] OUEDKNISS_JWT not set; skipping per-listing phone reveal (shops still get phones via siteBuildGetByStore)");
  }

  // ─── store enrichment ──────────────────────────────────────────────────
  // For each unique store id we observed, fetch the public store profile
  // via siteBuildGetByStore. mainLocation.phones, emails, and socials are
  // public on Ouedkniss (rendered on the shop's own page) — no auth needed.
  // Anonymous announcementPhoneGet returns [] (gated), so this is the only
  // anonymous path to real seller phones. Per-listing phones from
  // individual (non-shop) sellers stay null.
  const storeIds = Array.from(
    new Set(results.map((r) => r.sellerStoreId).filter(Boolean)),
  );
  if (storeIds.length) {
    console.log(`[stores] enriching ${storeIds.length} unique stores...`);
    for (let i = 0; i < storeIds.length; i++) {
      const sid = storeIds[i];
      try {
        const enriched = await fetchStoreProfile(sid);
        if (enriched) stores[sid] = enriched;
      } catch (err) {
        console.log(`  store ${sid}: ${err.message ?? err}`);
      }
      // Polite pause between store fetches (one per unique shop, so the
      // count is well under the per-page listing count).
      if (i < storeIds.length - 1) await new Promise((r) => setTimeout(r, 200));
    }
    const withPhone = Object.values(stores).filter((s) => s.phones?.length).length;
    console.log(`[stores] enriched ${Object.keys(stores).length}, with-phone=${withPhone}`);
  }

  if (pageFailures || itemFailures) {
    console.log(`[resilience] pageFailures=${pageFailures} itemFailures=${itemFailures} (partial output preserved)`);
  }
  } finally {
    // Always flush output — success path and crash path alike. The
    // run-loop shell parser reads this file to advance state; losing it
    // means the next iteration re-walks the same pages.
    try { await writePartialOutput(); } catch {}
  }
}

main().catch((e) => {
  // main() already wrote partial output in its finally block (if any items
  // were collected). All we do here is log and exit non-zero so run-loop's
  // retry layer kicks in.
  console.error(`scrape failed: ${e?.message ?? e}`);
  process.exit(1);
});
