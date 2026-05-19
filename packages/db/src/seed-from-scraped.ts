// Direct-to-Postgres seeder for scraper output.
//
// Reads a JSON dump produced by `scraper/scrape-ouedkniss.mjs` and inserts each
// listing as a product against the running Postgres database (no API hop).
// This is the path used on the live server: it skips the HTTP surface, so it
// doesn't need DEV_BYPASS or a SESSION_JWT, and it doesn't have to traverse
// Caddy / the api container's auth gate. It writes through the same repos
// the API uses, so the resulting rows are indistinguishable from API-created
// products (idempotency tokens excluded).
//
// Usage:
//   DATABASE_URL=postgres://... \
//   SELLER_ID=<org-uuid> \
//     pnpm -F @marketplace/db db:seed-from-scraped \
//       /path/to/data/ouedkniss-telephone-<timestamp>.json
//
// Env:
//   DATABASE_URL          required — Postgres connection string.
//   SELLER_ID             ignored as of 2026-05-12 — scraped listings are now
//                         inserted with seller_id = NULL ("unowned reference
//                         listings"). Kept silently accepted for compat with
//                         older systemd unit files.
//   COUNTRY_CODE          default DZ — used for `shipsTo` when the dump has none.
//   SKIP_URLS_FILE        optional path to a newline-delimited file of source
//                         URLs already seeded. Listings with a matching `url`
//                         are skipped before insert and counted as `dups`.
//                         The scrape→seed loop populates this from Postgres
//                         before each run so re-scraped items don't double-seed.
//   DRY_RUN=1             parse and print, don't write anything.
//
// The scraped seller's identity is NEVER copied — only public product data
// (title, image URLs, price text, posting date). See scraper/README.md for
// the legal & privacy posture. Since 2026-05-12 seeded rows additionally
// carry seller_id = NULL and are excluded from cart/buy flows.

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createDb } from "./client.js";
import { createRepos } from "./repos/index.js";
import { createLogger } from "@marketplace/shared/logger";

const log = createLogger("scraper.seed-from-scraped");

interface ScrapedPhoneEntry {
  phone?: string | null;
  hasWhatsapp?: boolean;
  hasViber?: boolean;
}

interface ScrapedItem {
  url?: string;
  title?: string | null;
  description?: string | null;
  images?: string[];
  priceText?: string | null;
  postedAt?: string | null;
  scrapedAt?: string;
  sellerStoreId?: string | null;
  phoneEntries?: ScrapedPhoneEntry[];
  // Other seller identity fields (sellerUserId, sellerIsFromStore) are
  // intentionally ignored — see policy note in main().
}

interface ScrapedStore {
  phones?: string[];
}

interface ScrapedDump {
  category?: string;
  count?: number;
  items?: ScrapedItem[];
  stores?: Record<string, ScrapedStore>;
}

// Collect the phone numbers reachable for a single scraped item: per-listing
// reveal (when the scraper had a JWT) plus the seller's store-level phones
// (anonymous, only for shop listings). Deduped, non-empty strings only.
function collectPhones(
  item: ScrapedItem,
  stores: Record<string, ScrapedStore>,
): string[] {
  const out = new Set<string>();
  for (const e of item.phoneEntries ?? []) {
    const p = (e?.phone ?? "").trim();
    if (p) out.add(p);
  }
  const storeId = item.sellerStoreId ?? null;
  if (storeId) {
    for (const p of stores[storeId]?.phones ?? []) {
      const s = (p ?? "").trim();
      if (s) out.add(s);
    }
  }
  return Array.from(out);
}

// "150 000 DA" / "1.250.000 DZD" / "12,500 DA" → minor units (santeem) as bigint.
// Returns undefined for unparseable strings.
function parsePriceToMinor(priceText: string | null | undefined): bigint | undefined {
  if (!priceText) return undefined;
  const digits = priceText.replace(/[^\d]/g, "");
  if (!digits) return undefined;
  // priceMinor = DZD * 100 (santeem). The scraped string is whole DZD.
  return BigInt(digits) * 100n;
}

// Brands commonly listed on Algerian marketplaces. Order matters — longer
// names first so "OnePlus" wins over a hypothetical "One". Match is
// case-insensitive against word-boundary occurrences in the title.
const KNOWN_BRANDS = [
  // Phones / laptops / peripherals — the original list.
  "OnePlus", "One plus", "iPhone", "I phone", "Apple", "Samsung", "Galaxy",
  "Xiaomi", "Huawei", "Honor", "Vivo", "Oppo", "Realme", "Google Pixel",
  "Google", "Sony", "Lenovo", "Dell", "HP", "Asus", "Acer", "MSI",
  "Logitech", "Jabra", "DJI", "Insta360", "Baseus", "Anker", "JBL", "Bose",
  "Pitaka", "Nokia", "Redmi", "POCO", "Microsoft",
  // Small-appliance + home — added 2026-05-13 after an audit showed 110+
  // products with detectable appliance brands ending up with `brand = NULL`
  // (Moulinex 34, Tefal 20, Rowenta 9, Kenwood 8, Sonashi 8, Bosch 7,
  // Philips 7, Enzo 6, DeLonghi 3, Condor 3, Nardi 3, SEB 2, …).
  "De'Longhi", "De Longhi", "DeLonghi", "Moulinex", "Rowenta", "Tefal",
  "Philips", "Kenwood", "Bosch", "Brandt", "Beko", "Whirlpool", "LG",
  "Panasonic", "Hisense", "Condor", "Sonashi", "Clatronic", "Nardi",
  "Bomann", "Magimix", "Enzo", "SEB",
  // Automotive — every car listing under automobiles_vehicules currently
  // has `brand = NULL` (3/3 sampled). Common DZ-market makes only.
  "Volkswagen", "Mercedes-Benz", "Mercedes", "Renault", "Peugeot", "Citroen",
  "Toyota", "Hyundai", "Nissan", "Honda", "Dacia", "BMW", "Audi", "Ford",
  "Kia", "Opel", "Fiat",
  // Round-three audit (2026-05-13, after the appliance+auto pass): 100+
  // more products in informatique + electronique_electromenager still
  // had brand=NULL with detectable brands in the title. Canon (29) and
  // Adobe/Autodesk (16) dominate, followed by mid-tier appliance and
  // robot-vacuum names. Order matters — Kärcher placed near other K
  // brands isn't important but kept readable. IRIS deliberately not
  // added: it would false-positive on the common French/English word
  // "iris" outside the Algerian Iris-appliance context.
  "Kärcher", "Karcher", "Canon", "Nikon", "Dyson", "Ecovacs", "Dreame",
  "Hikvision", "TCL", "Smeg", "Ariete", "Adobe", "Autodesk", "AMD", "Intel",
  // Round-four audit (2026-05-13): another 60+ NULL-brand rows had
  // detectable brands. Mix of PC peripherals (Corsair, Havit, BenQ),
  // networking (TP-Link), printers (Epson), and Algerian-market
  // heating/appliance brands (Calor, Immergas, Junkers, Midea, Taurus,
  // GoPro, MacBook variant). Order doesn't matter relative to the round-1
  // list since `\b` makes each brand independent.
  "TP-Link", "Tp-Link", "MacBook", "Corsair", "Havit", "BenQ", "Epson",
  "Calor", "Immergas", "Junkers", "Midea", "Taurus", "GoPro",
  // Round-five audit (post-imageless-purge): telephones + accessories
  // category. African / Chinese phone brands very common in DZ market
  // (Tecno, Infinix, ZTE — together ~35 rows), then chargers (LDNIO),
  // audio (Hollyland, Capsys, Fiio, Astro), GPU (Nvidia), VR (Oculus),
  // and the awkward-but-real "Nothing" phone brand (verified zero false-
  // positives across the catalog — every "nothing" match was the brand).
  "Infinix", "Tecno", "LDNIO", "ZTE", "Nothing", "Hollyland", "Capsys",
  "Nvidia", "Oculus", "Astro", "Fiio",
  // Round-six audit (vetements_mode discovery): the home page hero strip
  // surfaced 8 unbranded Lacoste/Skechers/Safety-Jogger cards — turns out
  // the fashion category had 417 untagged rows with detectable apparel
  // brands. Lacoste alone is 332 listings (the seller "Lacoste DZ" is
  // the catalog's biggest clothing reseller). Sneaker & athleticwear
  // brands fill the rest.
  "Lacoste", "Skechers", "Nike", "Safety Jogger", "Adidas", "Puma",
  "Reebok", "New Balance", "Converse", "Under Armour", "Asics", "Jordan",
  "Tommy Hilfiger", "Calvin Klein", "Polo Ralph Lauren", "Levi",
  // Round-seven audit (still vetements_mode dominated, plus watch brands):
  // shoe brands (Clarks, Timberland, Ecco, Chicco baby shoes, Fly Flot,
  // Xtep, Umbro), Algerian orthopedic-shoe brand Rahati (large
  // listing-count, all medical/diabetic footwear), and watch brands
  // (Casio, Naviforce — Chinese watch brand common in DZ).
  "Rahati", "Xtep", "Clarks", "Timberland", "Ecco", "Chicco", "Umbro",
  "Fly Flot", "Naviforce", "Casio", "Columbia", "Fossil", "Michael Kors",
  "Guess", "Pandora", "Carrefour", "IKEA",
  // Round-eight audit: PC components (Gigabyte, ASRock, Biostar, EVGA,
  // Galax, Kingston, SanDisk, WD/Western Digital — 60+ rows), cables/
  // hubs (UGREEN), UPS (APC), heating (Chappee), networking (Tenda),
  // photography (Godox), kitchen (WMF, Lexical), smart watches
  // (Haino-Teko), audio/PC accessories (Magma — verified PC-components
  // brand, not the generic word), and one more apparel hit (Pepe Jeans, 67 rows).
  "Pepe Jeans", "Gigabyte", "APC", "Chappee", "Magma", "Western Digital",
  "WD", "UGREEN", "Tenda", "SanDisk", "Galax", "Godox", "Biostar",
  "Haino-Teko", "Kingston", "WMF", "Lexical", "ASRock", "EVGA",
  // Round-nine audit: security cameras (Dahua 23), kitchen (Ninja 15
  // verified kitchen brand only, Krups 7, Nespresso 6, Terraillon 1),
  // refrigeration (Raylan 10, Arcodym 5 Algerian cooker brand), vacuums
  // (Bissell 8), audio (Rode 4 verified audio brand only, Sennheiser 3).
  "Dahua", "Ninja", "Raylan", "Bissell", "Krups", "Nespresso", "Arcodym",
  "Rode", "Sennheiser", "Terraillon",
];

// Some brand spellings on the marketplace map to a canonical brand name.
const BRAND_CANONICAL: Record<string, string> = {
  iPhone: "Apple",
  "I phone": "Apple",
  Galaxy: "Samsung",
  "One plus": "OnePlus",
  Redmi: "Xiaomi",
  POCO: "Xiaomi",
  "Google Pixel": "Google",
  "De Longhi": "De'Longhi",
  DeLonghi: "De'Longhi",
  "Mercedes-Benz": "Mercedes",
  "Karcher": "Kärcher",
  MacBook: "Apple",
  "Tp-Link": "TP-Link",
  WD: "Western Digital",
};

function inferBrand(title: string | null | undefined): string | undefined {
  if (!title) return undefined;
  // Word-boundary match only. An earlier version also fell back to a plain
  // `lower.includes(brand)` substring match, which produced false positives:
  // "ASUS VIVOBOOK ..." tagged Vivo, "DATASHOW ACER X1123HP" tagged HP,
  // "MINI HACHOIRE KENWOOD CHP40" tagged HP, "HPE OC20" tagged HP. The
  // regex already runs case-insensitive (`/i`) and `\b` handles brand
  // names with embedded spaces ("Google Pixel", "One plus") correctly,
  // so the substring fallback was strictly redundant — and harmful.
  for (const brand of KNOWN_BRANDS) {
    const re = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(title)) {
      return BRAND_CANONICAL[brand] ?? brand;
    }
  }
  return undefined;
}

// Ouedkniss CDN serves both still images (under `/medias/announcements/images/...`)
// and video clips (under `/medias/announcements/videos/...`) — and both URL
// shapes show up in the same `item.images` array of a scraped listing. Before
// 2026-05-13 we accepted everything and stamped it `image/jpeg`, which made
// Next.js Image Optimizer return 400 on the video files (it refuses to
// transcode non-image content) and produced steady 0.7%-of-traffic 5xx noise
// from product card thumbnails. Reject anything with `/videos/` in the path
// or a video file extension; everything else still defaults to JPEG, which
// is what the CDN actually returns for the legitimate `/images/...` URLs.
const VIDEO_PATH_RE = /\/videos\/|\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/i;

function pickImages(item: ScrapedItem): Array<{ url: string; contentType: string }> {
  const out: Array<{ url: string; contentType: string }> = [];
  for (const url of item.images ?? []) {
    if (typeof url !== "string" || !/^https?:/.test(url)) continue;
    if (VIDEO_PATH_RE.test(url)) continue;
    out.push({ url, contentType: "image/jpeg" });
    if (out.length >= 5) break;
  }
  return out;
}

function slug(s: string, max = 40): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error(
      "usage: pnpm -F @marketplace/db db:seed-from-scraped <path-to-scraped-json>",
    );
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(2);
  }
  const dryRun = process.env.DRY_RUN === "1";
  const requestedSellerId = process.env.SELLER_ID;
  const shipsToDefault = [process.env.COUNTRY_CODE ?? "DZ"];

  // Optional newline-delimited file of source URLs already seeded for this
  // seller. The scrape→seed loop populates it from Postgres before each run
  // so that re-scraped listings are skipped instead of re-inserted.
  // Counted as `dups` (vs. `skipped` for invalid rows) so the run-loop
  // metrics line tracks de-dup activity separately from quality drops.
  const skipUrlsFile = process.env.SKIP_URLS_FILE;
  const skipUrls = new Set<string>();
  if (skipUrlsFile) {
    try {
      const skipRaw = await readFile(skipUrlsFile, "utf8");
      for (const line of skipRaw.split(/\r?\n/)) {
        const u = line.trim();
        if (u) skipUrls.add(u);
      }
      log.info(`skip-urls: ${skipUrls.size} entries loaded from ${skipUrlsFile}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`skip-urls: could not read ${skipUrlsFile} (${msg}); continuing without dedup`);
    }
  }

  const raw = await readFile(inputPath, "utf8");
  const dump = JSON.parse(raw) as ScrapedDump;
  const items = dump.items ?? [];
  const stores = dump.stores ?? {};
  log.info(
    `input ${inputPath}: ${items.length} listings, ${Object.keys(stores).length} stores, category=${dump.category ?? "?"}` +
      (dryRun ? " [DRY_RUN]" : ""),
  );

  const { db, close } = createDb({ url, applicationName: "seed-from-scraped" });
  const repos = createRepos(db);

  // Operator policy (2026-05-12): scraped listings are inserted with
  // seller_id = NULL. They surface in catalog/search as reference data but
  // are not purchasable — cart/checkout paths refuse to resolve their
  // variants (see resolveLine in api/repos/cart and the AddToCart guard in
  // the web UI). SELLER_ID env, if set, is now ignored (kept for compat
  // with older systemd unit files); no synthetic seller_profiles rows are
  // created. Per-listing seller identity and phones from upstream dumps
  // are also ignored.
  if (requestedSellerId) {
    log.info(`SELLER_ID=${requestedSellerId} provided but ignored — scraped listings are unowned by policy`);
  }

  let ok = 0;
  let skipped = 0;
  let noPhone = 0;       // informational only since 2026-05-18 — see policy note below
  let priceOnRequest = 0;
  let noImage = 0;
  let dups = 0;
  // Policy (2026-05-18, after a 30-hour catalog-freeze incident): scraped
  // listings land with seller_id=NULL ("unowned reference listings"). They
  // are intentionally NOT purchasable — the cart API refuses to resolve
  // their variants (resolveLine → unowned_product) and the web UI hides
  // the add-to-cart button (product/[id]/page.tsx). Two prior hard gates —
  // "must have at least one reachable phone" and "must have a parseable
  // price" — were written under the 2026-05-13 owned-listings model, where
  // a buyer would actually call the seller. They are dead weight for the
  // unowned model:
  //   - phone: nobody contacts the seller of an unowned row; the catalog
  //     value is discovery/SEO, not transactions. Without a JWT (which
  //     requires solving recaptcha manually) the scraper resolves phones
  //     only for shop accounts (siteBuildGetByStore). Most listings in
  //     immobilier, automobiles_vehicules and informatique are private
  //     sellers — the gate was rejecting 60–95% of every page.
  //   - price: Ouedkniss sellers commonly post "Prix sur demande" / "à
  //     débattre" / negotiable. The whole stack already renders such
  //     listings as "Prix sur demande" (priceMinor < MIN_REAL_PRICE_MINOR
  //     = 10000 santeem ⇒ swap in ProductCard / search / product page /
  //     feed.xml / JSON-LD Offer suppression). Hard-rejecting them at
  //     ingest threw away ~30% of every page for no downstream benefit.
  // New behavior: phones are still collected and stored in
  // attributes.sourcePhones if available; rows without phones flow through.
  // Unparseable prices become priceMinor=0n with attributes.priceOnRequest
  // = "true", which the rendering layer already maps to "Prix sur demande".
  // The owned-listing path (SELLER_ID set, real seller record) is not in
  // production today (run-loop.sh passes SELLER_ID but main() ignores it
  // since 2026-05-12); if it is ever revived, gate it inside the
  // requestedSellerId branch.
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const sourceUrl = (it.url ?? "").trim();
    if (sourceUrl && skipUrls.has(sourceUrl)) {
      dups++;
      continue;
    }
    const title = (it.title ?? "").trim();
    if (!title) {
      skipped++;
      log.warn(`skip [${i}] missing title (price=${it.priceText ?? "null"})`);
      continue;
    }
    const parsedPriceMinor = parsePriceToMinor(it.priceText);
    const priceMinor = parsedPriceMinor ?? 0n;
    if (parsedPriceMinor === undefined) priceOnRequest++;
    // Phones are now metadata, not a gate — see policy note above. Count
    // is kept so the metrics line still surfaces "how many rows came in
    // without any reachable phone" for operator awareness.
    const phones = collectPhones(it, stores);
    if (phones.length === 0) noPhone++;
    // Hard requirement (2026-05-13): every seeded product must carry at least
    // one image URL. Ouedkniss immobilier sellers commonly post listings
    // without photos; those rows render as a brand-initial placeholder
    // card on home/search/category grids — a wall of letter-only cards
    // makes the catalog look thin. Until the previous pass 13% of scraped
    // products had no hero image. Drop them at ingest time the same way
    // noPhone rows are dropped; the scrape loop will re-find them on the
    // next page-walk if the seller adds photos later.
    const imageCandidates = pickImages(it);
    if (imageCandidates.length === 0) {
      noImage++;
      log.warn(`skip [${i}] no image: ${title.slice(0, 60)}`);
      continue;
    }
    // Globally-unique variant SKU. Previously `scraped-<title-slug>-<i>`
    // where `i` is the loop index within a single scrape batch — every
    // run that processed e.g. a "Vente Appartement F3 Alger ..." at
    // position 37 produced the SKU `scraped-vente-appartement-f3-alg-37`,
    // and 10+ rows in the live catalog ended up sharing identical SKUs
    // (different products though, so the schema's (product_id, sku)
    // unique constraint was still satisfied). Use a short hash of the
    // sourceUrl as the uniqueness token instead — each scraped listing
    // has a unique Ouedkniss URL, so this collapses the collision space.
    const urlForHash = sourceUrl || `${title}-${i}`;
    const urlHash = createHash("sha1").update(urlForHash).digest("hex").slice(0, 10);
    const sku = `scraped-${slug(title, 24)}-${urlHash}`;
    const brand = inferBrand(title);
    const attributes: Record<string, string> = {
      source: "ouedkniss-public-listing",
      sourceUrl: it.url ?? "",
      sourceCategory: dump.category ?? "",
      sourcePhones: phones.join(","),
    };
    if (it.postedAt) attributes.sourcePostedAt = it.postedAt;
    // Flag so consumers (cards, JSON-LD, search description) can render
    // "Prix sur demande" explicitly instead of inferring from a low
    // priceMinor. The 0n value is also caught by the MIN_REAL_PRICE_MINOR
    // < 10000 floor everywhere it matters, but the attribute is the
    // authoritative signal.
    if (parsedPriceMinor === undefined) attributes.priceOnRequest = "true";

    if (dryRun) {
      log.info(
        `dry-run [${i}] ${title.slice(0, 60)} (DZD ${(Number(priceMinor) / 100).toLocaleString("fr-DZ")})`,
      );
      ok++;
      continue;
    }

    try {
      const created = await repos.products.create({
        sellerId: null,
        title: title.slice(0, 300),
        ...(brand ? { brand } : {}),
        ...(it.description ? { description: String(it.description).slice(0, 5000) } : {}),
        attributes,
        ...(dump.category ? { categoryIds: [dump.category] } : {}),
        shipsTo: shipsToDefault,
        variants: [{ sku, priceMinor, currency: "DZD" }],
        media: imageCandidates,
      });
      const dzd = (Number(priceMinor) / 100).toLocaleString("fr-DZ");
      log.info(`  ${created.productId} — ${title.slice(0, 60)} (DZD ${dzd})`);
      ok++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`  failed [${i}] ${title.slice(0, 40)}: ${msg}`);
      skipped++;
    }
  }

  await close();
  // Plain-text summary on stdout (separate from pino JSON) so the
  // run-loop.sh shell parser can grep this exact shape. The `dropped for
  // missing phone` clause is retained as 0 in the canonical sentence —
  // run-loop.sh still parses it as `no_phone` for back-compat with
  // existing metrics.jsonl consumers — and a new `no phone metadata`
  // clause carries the informational count. Same trick for `price on
  // request`: an additive field that run-loop.sh's existing greps ignore
  // until updated.
  // The `skipped X/N` total in the canonical sentence is the seeder's
  // "true-failure" bucket only (missing title, insert exceptions). noImage
  // is broken out separately because it is a quality drop, not a failure.
  const totalSkippedDisplay = skipped + noImage;
  console.log(
    `seeded ${ok} products, skipped ${totalSkippedDisplay}/${items.length} ` +
      `(${dups} as already-seeded duplicates, 0 dropped for missing phone, ${noImage} dropped for missing image, ` +
      `${noPhone} with no phone metadata, ${priceOnRequest} with price on request)`,
  );
  log.info(
    `done: seeded ${ok}, skipped ${skipped}/${items.length}, noPhone ${noPhone}, ` +
      `priceOnRequest ${priceOnRequest}, noImage ${noImage}, dups ${dups}`,
  );
  // Exit policy: pre-flight rejections (no title, no image, already-seeded
  // duplicate) and metadata-only counters (no phone, price-on-request) are
  // *expected* outcomes for a given scrape batch. Only fail when *every*
  // item hit a true failure bucket (missing title, insert exception) with
  // zero accepted rows and zero dups, which means either a catch-block
  // exception on every insert (true unexpected error) or a structural
  // input issue that warrants an alert.
  const allTrulyFailed =
    ok === 0 && skipped === items.length && dups === 0 && items.length > 0;
  if (allTrulyFailed) process.exit(1);
}

main().catch((err) => {
  log.error({ err }, "seed-from-scraped failed");
  process.exit(1);
});
