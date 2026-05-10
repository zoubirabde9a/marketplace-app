// API-mode seeder: reads a JSON file produced by `scraper/scrape-ouedkniss.mjs`
// and POSTs each listing as a product under one of OUR sellers (the synthetic
// Algerian sellers from `scripts/seed-algerian.mjs`). The scraped seller's
// identity is NEVER copied — only public product data (title, image URLs,
// price text) is reused.
//
// Goes through the API auth/validation surface, so on a non-local target you
// need either DEV_BYPASS=1 on the server or a SESSION_JWT in env.
//
// If you're on the live server (vps-eu) and want to skip the HTTP hop, prefer
// the direct-DB sibling instead:
//   pnpm -F @marketplace/db db:seed-from-scraped <path-to-scraped-json>
// (its source lives at `packages/db/src/seed-from-scraped.ts`; same JSON shape).
//
// Usage:
//   node scraper/seed-from-scraped.mjs data/ouedkniss-telephone-2026-05-08T...json
//
// Env:
//   MARKETPLACE_BASE  default http://127.0.0.1:3100
//   SESSION_JWT       optional Bearer token for authed prod runs
//   SELLER_ID         required — UUID of the seller these products attach to.
//                     Run seed-algerian.mjs first; copy a sellerId from its log.
//   SKIP_URLS_FILE    optional path to a newline-delimited file of sourceUrls
//                     to skip. Listings whose `url` matches a line are skipped
//                     before the POST. Populate it from Postgres before running:
//                       docker exec marketplace-postgres psql -U marketplace \
//                         -d marketplace -At -c \
//                         "SELECT attributes->>'sourceUrl' FROM catalog.products \
//                          WHERE seller_id='<SELLER_ID>' AND attributes ? 'sourceUrl';" \
//                         > data/skip_urls.txt

import { readFile } from "node:fs/promises";

const BASE = process.env.MARKETPLACE_BASE ?? "http://127.0.0.1:3100";
const SESSION_JWT = process.env.SESSION_JWT;
const SELLER_ID = process.env.SELLER_ID;
const SKIP_URLS_FILE = process.env.SKIP_URLS_FILE;

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("usage: node scraper/seed-from-scraped.mjs <path-to-scraped-json>");
  process.exit(2);
}
if (!SELLER_ID) {
  console.error("SELLER_ID env var is required (a UUID from seed-algerian.mjs's output).");
  process.exit(2);
}

async function jf(method, path, body, idem) {
  const headers = { "content-type": "application/json" };
  if (idem) headers["idempotency-key"] = idem;
  if (SESSION_JWT) headers["authorization"] = `Bearer ${SESSION_JWT}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}\n${text}`);
  return text ? JSON.parse(text) : {};
}

// "150 000 DA" / "1.250.000 DZD" / "12,500 DA" → minor units (santeem) as a string
function parsePriceToMinor(priceText) {
  if (!priceText) return null;
  const digits = priceText.replace(/[^\d]/g, "");
  if (!digits) return null;
  // priceMinor = DZD * 100 (santeem). The scraped string is whole DZD.
  return `${digits}00`;
}

// Brands commonly listed on Algerian marketplaces. Order matters — longer
// names first so "OnePlus" wins over a hypothetical "One". Match is
// case-insensitive against word-boundary occurrences in the title.
const KNOWN_BRANDS = [
  "OnePlus", "One plus", "iPhone", "I phone", "Apple", "Samsung", "Galaxy",
  "Xiaomi", "Huawei", "Honor", "Vivo", "Oppo", "Realme", "Google Pixel",
  "Google", "Sony", "Lenovo", "Dell", "HP", "Asus", "Acer", "MSI",
  "Logitech", "Jabra", "DJI", "Insta360", "Baseus", "Anker", "JBL", "Bose",
  "Pitaka", "Nokia", "Redmi", "POCO", "Microsoft",
];

// Some brand spellings on the marketplace map to a canonical brand name.
const BRAND_CANONICAL = {
  iPhone: "Apple",
  "I phone": "Apple",
  Galaxy: "Samsung",
  "One plus": "OnePlus",
  Redmi: "Xiaomi",
  POCO: "Xiaomi",
  "Google Pixel": "Google",
};

function inferBrand(title) {
  if (!title) return null;
  const lower = title.toLowerCase();
  for (const brand of KNOWN_BRANDS) {
    const re = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(lower) || lower.includes(brand.toLowerCase())) {
      return BRAND_CANONICAL[brand] ?? brand;
    }
  }
  return null;
}

function pickImages(item) {
  const out = [];
  for (const url of item.images ?? []) {
    if (typeof url !== "string") continue;
    if (!/^https?:/.test(url)) continue;
    out.push({ url, contentType: "image/jpeg" });
    if (out.length >= 5) break;
  }
  return out;
}

function key(prefix, n) {
  return `${prefix}-${Date.now().toString(36)}-${n.toString().padStart(4, "0")}`;
}

function slug(s, max = 40) {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

async function main() {
  const raw = await readFile(inputPath, "utf8");
  const dump = JSON.parse(raw);
  const items = dump.items ?? [];
  console.log(`base: ${BASE}`);
  console.log(`seller: ${SELLER_ID}`);
  console.log(`input: ${inputPath} (${items.length} listings, category=${dump.category ?? "?"})`);

  let skipUrls = new Set();
  if (SKIP_URLS_FILE) {
    try {
      const txt = await readFile(SKIP_URLS_FILE, "utf8");
      for (const line of txt.split(/\r?\n/)) {
        const u = line.trim();
        if (u) skipUrls.add(u);
      }
      console.log(`skip-urls: ${skipUrls.size} entries from ${SKIP_URLS_FILE}`);
    } catch (e) {
      console.warn(`skip-urls: failed to read ${SKIP_URLS_FILE}: ${e.message}`);
    }
  }

  let ok = 0;
  let skipped = 0;
  let dupSkipped = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const title = (it.title ?? "").trim();
    const priceMinor = parsePriceToMinor(it.priceText);
    if (!title || !priceMinor) {
      skipped++;
      continue;
    }
    if (it.url && skipUrls.has(it.url)) {
      dupSkipped++;
      continue;
    }
    const urlSlug = it.url
      ? slug(it.url.replace(/^https?:\/\/[^/]+\//, "").replace(/\?.*$/, ""), 56)
      : "";
    const sku = urlSlug
      ? `scraped-${urlSlug}`
      : `scraped-${slug(title, 24)}-${i}`;
    const brand = inferBrand(title);
    const body = {
      sellerId: SELLER_ID,
      title: title.slice(0, 300),
      ...(brand ? { brand } : {}),
      ...(it.description ? { description: String(it.description).slice(0, 5000) } : {}),
      attributes: {
        sourceUrl: it.url ?? "",
        ...(it.postedAt ? { sourcePostedAt: it.postedAt } : {}),
        ...(it.cityNames?.length ? { city: it.cityNames.join(", ") } : {}),
        ...(it.wilayaNames?.length ? { wilaya: it.wilayaNames.join(", ") } : {}),
      },
      categoryIds: dump.category ? [dump.category] : undefined,
      shipsTo: ["DZ"],
      variants: [{ sku, priceMinor, currency: "DZD" }],
      media: pickImages(it),
    };
    try {
      const r = await jf("POST", "/v1/products", body, key("scrap-p", i));
      const dzd = (Number(priceMinor) / 100).toLocaleString("fr-DZ");
      console.log(`  ${r.productId} — ${title.slice(0, 60)} (DZD ${dzd})`);
      ok++;
    } catch (err) {
      console.error(`  failed [${i}] ${title.slice(0, 40)}: ${err.message ?? err}`);
      skipped++;
    }
  }
  console.log(`\nseeded ${ok} products, skipped ${skipped}/${items.length} (${dupSkipped} as already-seeded duplicates)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
