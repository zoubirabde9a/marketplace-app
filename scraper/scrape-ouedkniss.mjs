// Scrapes Ouedkniss listing pages with Playwright (Chromium) into a JSON file.
//
// USE WITH CARE — Ouedkniss's terms of service prohibit automated harvesting
// of seller contact details. This script is here as a reference; running it
// in production against real sellers may violate (a) Ouedkniss ToS,
// (b) Algerian Law 18-07 on protection of personal data, and (c) GDPR if any
// listed seller is in the EU. The default config below is intentionally tiny
// (3 pages, 30 listings). Do not crank it up without legal sign-off.
//
// Setup (one-off, on the operator's machine — NOT on vps-eu):
//   pnpm add -D playwright
//   pnpm exec playwright install chromium
//
// Usage:
//   node scraper/scrape-ouedkniss.mjs                   # default: c/telephone, 30 listings
//   N=50 node scraper/scrape-ouedkniss.mjs              # target 50 post-filter listings
//   CATEGORY=informatique N=20 node scraper/scrape-ouedkniss.mjs
//
// Env knobs:
//   N=30                  target post-filter listing count. The scraper walks
//                         category index pages until it has N candidate URLs
//                         (or MAX_PAGES is hit), then fetches each. If
//                         MAX_AGE_DAYS filtering drops some, it walks more
//                         index pages and tops up — the goal is to return N
//                         items, not to "try N and see what survives".
//                         (`MAX_LISTINGS` is honoured as a back-compat alias.)
//   MAX_PAGES=20          hard cap on category index pages to avoid runaway
//                         pagination if the site has fewer than N fresh items.
//   MAX_AGE_DAYS=3        skip listings posted more than N days ago (0 = no filter).
//                         When > 0, listings with no parseable posting date are
//                         also skipped — we can't certify their age.
//   DELAY_MS=4000         pause between index page fetches (be polite).
//   LISTING_DELAY_MS=2500 pause between individual listing fetches.
//   BATCH_SIZE=10         process listings in batches of N, pausing BATCH_PAUSE_MS between.
//   BATCH_PAUSE_MS=8000   pause between batches (gives rate limits a breather).
//
// Output: data/ouedkniss-<category>-<timestamp>.json
//   Each item carries `postedAt` (ISO 8601) when the date could be parsed.
//
// Feed the JSON into one of:
//   * scraper/seed-from-scraped.mjs        — POSTs to a running API
//   * pnpm -F @marketplace/db db:seed-from-scraped <json>
//                                          — writes directly to Postgres
//                                            (use this on the live server)

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "..", "data");

const CATEGORY = process.env.CATEGORY ?? "telephone";
// `N` is the canonical knob; `MAX_LISTINGS` is kept as a back-compat alias.
const TARGET_COUNT = Number(process.env.N ?? process.env.MAX_LISTINGS ?? 30);
const MAX_PAGES = Number(process.env.MAX_PAGES ?? process.env.PAGES ?? 20);
const PER_PAGE_DELAY_MS = Number(process.env.DELAY_MS ?? 4000); // be a polite scraper
const LISTING_DELAY_MS = Number(process.env.LISTING_DELAY_MS ?? 2500);
const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS ?? 3);
const BATCH_SIZE = Math.max(1, Number(process.env.BATCH_SIZE ?? 10));
const BATCH_PAUSE_MS = Number(process.env.BATCH_PAUSE_MS ?? 8000);

const BASE_URL = "https://www.ouedkniss.com";

// Parse the listing's posting date out of whatever the page exposes:
// 1) JSON-LD `datePublished` (most reliable), 2) <time datetime="..."> tags,
// 3) French relative-time text ("il y a 2 jours", "Aujourd'hui", "Hier").
// Returns an ISO string or null.
function parsePostedAt(structuredData, timeAttrs, relativeText) {
  for (const sd of structuredData ?? []) {
    const candidates = Array.isArray(sd) ? sd : [sd];
    for (const c of candidates) {
      const v = c?.datePublished ?? c?.dateCreated ?? c?.uploadDate;
      if (typeof v === "string") {
        const d = new Date(v);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
      }
    }
  }
  for (const t of timeAttrs ?? []) {
    if (typeof t !== "string" || !t) continue;
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const txt = (relativeText ?? "").toLowerCase();
  const now = new Date();
  if (/aujourd['’]?hui/.test(txt)) return now.toISOString();
  if (/\bhier\b/.test(txt)) return new Date(now.getTime() - 86400_000).toISOString();
  const m = txt.match(/il y a\s+(\d+)\s*(minute|heure|jour|semaine|mois)/);
  if (m) {
    const n = Number(m[1]);
    const unitMs = { minute: 60_000, heure: 3600_000, jour: 86400_000, semaine: 7 * 86400_000, mois: 30 * 86400_000 }[m[2]];
    if (unitMs) return new Date(now.getTime() - n * unitMs).toISOString();
  }
  return null;
}

function ageDays(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 86400_000;
}

async function main() {
  const playwright = await import("playwright").catch(() => null);
  if (!playwright) {
    console.error("playwright not installed. Run:\n  pnpm add -D playwright\n  pnpm exec playwright install chromium");
    process.exit(2);
  }
  const { chromium } = playwright;

  await mkdir(DATA_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) teno-store-research/1.0 (+https://teno-store.com/about)",
    locale: "fr-FR",
  });
  const page = await ctx.newPage();

  const seenUrls = new Set();
  const pendingUrls = []; // URLs not yet fetched, in collection order
  let pagesWalked = 0;
  let pagesEmpty = 0;
  const results = [];
  let tooOld = 0;
  let listingNo = 0;

  // Walk one category index page and append any new /annonce/ URLs to pendingUrls.
  // Returns the number of new URLs added.
  async function collectIndexPage() {
    pagesWalked++;
    const url = `${BASE_URL}/c/${CATEGORY}?page=${pagesWalked}`;
    console.log(`[index ${pagesWalked}/${MAX_PAGES}] ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    // Ouedkniss uses Vue + v-cards; listing anchors point at /annonce/...
    const hrefs = await page.$$eval("a[href*='/annonce/']", (els) => els.map((a) => a.href));
    let added = 0;
    for (const h of hrefs) {
      const u = h.split("?")[0];
      if (!seenUrls.has(u)) {
        seenUrls.add(u);
        pendingUrls.push(u);
        added++;
      }
    }
    return added;
  }

  // Visit a single listing URL, extract structured fields, append to results
  // unless filtered out by MAX_AGE_DAYS.
  async function fetchListing(url) {
    listingNo++;
    try {
      console.log(`  [listing ${listingNo}] ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(800); // let Vue hydrate

      const data = await page.evaluate(() => {
        const t = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
        const og = (k) => document.querySelector(`meta[property="og:${k}"]`)?.content ?? null;
        const sd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
          .map((s) => { try { return JSON.parse(s.textContent ?? "null"); } catch { return null; } })
          .filter(Boolean);
        const title = og("title") ?? t("h1");
        const description = og("description") ?? t("[class*=description]");
        const images = Array.from(document.querySelectorAll("meta[property='og:image']")).map((m) => m.content);
        const priceMatch = document.body.textContent?.match(/(\d[\d\s.,]{2,})\s*(DA|DZD)/);
        // Posting-date signals: <time datetime="..."> attrs, plus any visible
        // text near "Publiée"/"Mis à jour" labels for relative-time fallback.
        const timeAttrs = Array.from(document.querySelectorAll("time[datetime]"))
          .map((el) => el.getAttribute("datetime"))
          .filter(Boolean);
        const labelEl = Array.from(document.querySelectorAll("body *"))
          .find((el) => /publi[ée]e|mis[e]? à jour/i.test(el.textContent ?? ""));
        const relativeText = labelEl?.textContent?.trim() ?? null;
        return {
          title,
          description,
          images,
          priceText: priceMatch?.[0] ?? null,
          structuredData: sd,
          timeAttrs,
          relativeText,
        };
      });
      const postedAt = parsePostedAt(data.structuredData, data.timeAttrs, data.relativeText);
      if (MAX_AGE_DAYS > 0 && !postedAt) {
        tooOld++;
        console.log(`    skipped (no parseable posting date — cannot verify ≤ ${MAX_AGE_DAYS}d)`);
      } else if (MAX_AGE_DAYS > 0 && ageDays(postedAt) > MAX_AGE_DAYS) {
        tooOld++;
        console.log(`    skipped (posted ${ageDays(postedAt).toFixed(1)}d ago, > ${MAX_AGE_DAYS}d)`);
      } else {
        results.push({ url, scrapedAt: new Date().toISOString(), postedAt, ...data });
      }
    } catch (err) {
      console.error(`  failed: ${err.message ?? err}`);
    }
    await page.waitForTimeout(LISTING_DELAY_MS);
  }

  // Top-up loop: keep walking index pages and fetching listings until either
  // (a) we have TARGET_COUNT post-filter results, or (b) MAX_PAGES is hit and
  // we run out of pending URLs. Three consecutive empty index pages also
  // breaks out — Ouedkniss returned no new listings, so paginating further
  // is wasted work.
  while (results.length < TARGET_COUNT) {
    if (pendingUrls.length === 0) {
      if (pagesWalked >= MAX_PAGES) break;
      const added = await collectIndexPage();
      if (added === 0) {
        pagesEmpty++;
        if (pagesEmpty >= 3) break;
      } else {
        pagesEmpty = 0;
      }
      await page.waitForTimeout(PER_PAGE_DELAY_MS);
      continue;
    }

    const batch = pendingUrls.splice(0, BATCH_SIZE);
    console.log(`[batch] ${batch.length} listings (have ${results.length}/${TARGET_COUNT})`);
    for (const url of batch) {
      await fetchListing(url);
      if (results.length >= TARGET_COUNT) break;
    }
    if (pendingUrls.length > 0 && results.length < TARGET_COUNT) {
      console.log(`  batch done, pausing ${BATCH_PAUSE_MS}ms`);
      await page.waitForTimeout(BATCH_PAUSE_MS);
    }
  }
  console.log(
    `kept ${results.length}/${TARGET_COUNT}, dropped ${tooOld} (>${MAX_AGE_DAYS}d), walked ${pagesWalked} index page(s)`,
  );
  if (results.length < TARGET_COUNT) {
    console.log(
      `note: only ${results.length} listings matched the filter — try raising MAX_PAGES, lowering MAX_AGE_DAYS, or picking a busier CATEGORY`,
    );
  }

  await browser.close();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(DATA_DIR, `ouedkniss-${CATEGORY}-${stamp}.json`);
  await writeFile(
    outPath,
    JSON.stringify(
      {
        category: CATEGORY,
        targetCount: TARGET_COUNT,
        pagesWalked,
        count: results.length,
        items: results,
      },
      null,
      2,
    ),
  );
  console.log(`\nwrote ${outPath} (${results.length} listings)`);
  console.log("NB: phone numbers are NOT scraped — the 'Voir le numéro' reveal is gated.");
  console.log("    Doing so would clearly cross from research-fair-use into ToS / privacy violation.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
