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
//   node scripts/scrape-ouedkniss.mjs            # default: c/telephone, 3 pages
//   CATEGORY=informatique PAGES=2 node scripts/scrape-ouedkniss.mjs
//
// Env knobs:
//   MAX_AGE_DAYS=3        skip listings posted more than N days ago (0 = no filter)
//   BATCH_SIZE=10         process listings in batches of N, pausing BATCH_PAUSE_MS between
//   BATCH_PAUSE_MS=8000   pause between batches (gives rate limits a breather)
//
// Output: data/ouedkniss-<category>-<timestamp>.json
//   Each item carries `postedAt` (ISO 8601) when the date could be parsed.
//
// Then feed the JSON into a future seeder (TODO) that POSTs to /v1/sellers
// and /v1/products against the live API.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "..", "data");

const CATEGORY = process.env.CATEGORY ?? "telephone";
const PAGES = Number(process.env.PAGES ?? 3);
const PER_PAGE_DELAY_MS = Number(process.env.DELAY_MS ?? 4000); // be a polite scraper
const LISTING_DELAY_MS = Number(process.env.LISTING_DELAY_MS ?? 2500);
const MAX_LISTINGS = Number(process.env.MAX_LISTINGS ?? 30);
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

  const listingUrls = new Set();

  // Phase 1: collect listing URLs from category index pages.
  for (let i = 1; i <= PAGES; i++) {
    const url = `${BASE_URL}/c/${CATEGORY}?page=${i}`;
    console.log(`[index] ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    // Ouedkniss uses Vue + v-cards; the listing anchors point at /annonce/...
    const hrefs = await page.$$eval("a[href*='/annonce/']", (els) => els.map((a) => a.href));
    for (const h of hrefs) listingUrls.add(h.split("?")[0]);
    if (listingUrls.size >= MAX_LISTINGS) break;
    await page.waitForTimeout(PER_PAGE_DELAY_MS);
  }
  console.log(`collected ${listingUrls.size} unique listing URLs (cap ${MAX_LISTINGS})`);

  // Phase 2: visit each listing and extract structured fields.
  // Listings are processed in batches of BATCH_SIZE with a pause between batches
  // (so the scraper takes work in chunks rather than one continuous burst).
  const results = [];
  let tooOld = 0;
  const urlList = Array.from(listingUrls).slice(0, MAX_LISTINGS);
  for (let bStart = 0; bStart < urlList.length; bStart += BATCH_SIZE) {
    const batch = urlList.slice(bStart, bStart + BATCH_SIZE);
    const batchNo = Math.floor(bStart / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(urlList.length / BATCH_SIZE);
    console.log(`[batch ${batchNo}/${totalBatches}] ${batch.length} listings`);
    for (let i = 0; i < batch.length; i++) {
      const url = batch[i];
      const n = bStart + i + 1;
      try {
        console.log(`  [listing ${n}] ${url}`);
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
        if (MAX_AGE_DAYS > 0 && postedAt && ageDays(postedAt) > MAX_AGE_DAYS) {
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
    if (bStart + BATCH_SIZE < urlList.length) {
      console.log(`  batch done, pausing ${BATCH_PAUSE_MS}ms`);
      await page.waitForTimeout(BATCH_PAUSE_MS);
    }
  }
  console.log(`kept ${results.length}, dropped ${tooOld} as older than ${MAX_AGE_DAYS}d`);

  await browser.close();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(DATA_DIR, `ouedkniss-${CATEGORY}-${stamp}.json`);
  await writeFile(outPath, JSON.stringify({ category: CATEGORY, pages: PAGES, count: results.length, items: results }, null, 2));
  console.log(`\nwrote ${outPath} (${results.length} listings)`);
  console.log("NB: phone numbers are NOT scraped — the 'Voir le numéro' reveal is gated.");
  console.log("    Doing so would clearly cross from research-fair-use into ToS / privacy violation.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
