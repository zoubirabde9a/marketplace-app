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
//   SELLER_ID             optional — UUID of an existing seller (organizations.id)
//                         to attach products to. If omitted, the script picks
//                         the oldest existing seller. If none exists, the run
//                         aborts with a hint to run scripts/seed-algerian.mjs
//                         (or `pnpm -F @marketplace/db db:seed`) first.
//   COUNTRY_CODE          default DZ — used for `shipsTo` when the dump has none.
//   DRY_RUN=1             parse and print, don't write anything.
//
// The scraped seller's identity is NEVER copied — only public product data
// (title, image URLs, price text, posting date). See scraper/README.md for
// the legal & privacy posture.

import { readFile } from "node:fs/promises";
import { createDb } from "./client.js";
import { createRepos } from "./repos/index.js";
import { sellerProfiles } from "./schema/seller.js";
import { createLogger } from "@marketplace/shared/logger";

const log = createLogger("scraper.seed-from-scraped");

interface ScrapedItem {
  url?: string;
  title?: string | null;
  description?: string | null;
  images?: string[];
  priceText?: string | null;
  postedAt?: string | null;
  scrapedAt?: string;
}

interface ScrapedDump {
  category?: string;
  count?: number;
  items?: ScrapedItem[];
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
  "OnePlus", "One plus", "iPhone", "I phone", "Apple", "Samsung", "Galaxy",
  "Xiaomi", "Huawei", "Honor", "Vivo", "Oppo", "Realme", "Google Pixel",
  "Google", "Sony", "Lenovo", "Dell", "HP", "Asus", "Acer", "MSI",
  "Logitech", "Jabra", "DJI", "Insta360", "Baseus", "Anker", "JBL", "Bose",
  "Pitaka", "Nokia", "Redmi", "POCO", "Microsoft",
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
};

function inferBrand(title: string | null | undefined): string | undefined {
  if (!title) return undefined;
  const lower = title.toLowerCase();
  for (const brand of KNOWN_BRANDS) {
    const re = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(lower) || lower.includes(brand.toLowerCase())) {
      return BRAND_CANONICAL[brand] ?? brand;
    }
  }
  return undefined;
}

function pickImages(item: ScrapedItem): Array<{ url: string; contentType: string }> {
  const out: Array<{ url: string; contentType: string }> = [];
  for (const url of item.images ?? []) {
    if (typeof url !== "string" || !/^https?:/.test(url)) continue;
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

  const raw = await readFile(inputPath, "utf8");
  const dump = JSON.parse(raw) as ScrapedDump;
  const items = dump.items ?? [];
  log.info(
    `input ${inputPath}: ${items.length} listings, category=${dump.category ?? "?"}` +
      (dryRun ? " [DRY_RUN]" : ""),
  );

  const { db, close } = createDb({ url, applicationName: "seed-from-scraped" });
  const repos = createRepos(db);

  // Resolve seller. Either operator-supplied SELLER_ID, or the oldest
  // existing seller (the synthetic Algerian sellers from seed-algerian.mjs
  // are typically what we want here).
  let sellerId: string;
  if (requestedSellerId) {
    const seller = await repos.sellers.get(requestedSellerId);
    if (!seller) {
      console.error(`SELLER_ID=${requestedSellerId} not found in organizations table.`);
      console.error("Run scripts/seed-algerian.mjs against this DB first, or pass an existing org UUID.");
      await close();
      process.exit(2);
    }
    sellerId = seller.sellerId;
    log.info(`using seller ${sellerId} (${seller.displayName}) [from SELLER_ID env]`);
  } else {
    const all = await db.select().from(sellerProfiles).orderBy(sellerProfiles.createdAt).limit(1);
    if (!all[0]) {
      console.error(
        "No sellers exist in the database. Run `pnpm -F @marketplace/db db:seed` " +
          "or `node scripts/seed-algerian.mjs` first, then re-run this with SELLER_ID set.",
      );
      await close();
      process.exit(2);
    }
    sellerId = all[0].orgId;
    log.info(`using seller ${sellerId} (${all[0].storeName}) [oldest seller; pass SELLER_ID to override]`);
  }

  let ok = 0;
  let skipped = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const title = (it.title ?? "").trim();
    const priceMinor = parsePriceToMinor(it.priceText);
    if (!title || priceMinor === undefined) {
      skipped++;
      log.warn(`skip [${i}] missing title or price (title=${!!title}, price=${it.priceText ?? "null"})`);
      continue;
    }
    const sku = `scraped-${slug(title, 24)}-${i}`;
    const brand = inferBrand(title);
    const attributes: Record<string, string> = {
      source: "ouedkniss-public-listing",
      sourceUrl: it.url ?? "",
      sourceCategory: dump.category ?? "",
    };
    if (it.postedAt) attributes.sourcePostedAt = it.postedAt;

    if (dryRun) {
      log.info(
        `dry-run [${i}] ${title.slice(0, 60)} (DZD ${(Number(priceMinor) / 100).toLocaleString("fr-DZ")})`,
      );
      ok++;
      continue;
    }

    try {
      const created = await repos.products.create({
        sellerId,
        title: title.slice(0, 300),
        ...(brand ? { brand } : {}),
        ...(it.description ? { description: String(it.description).slice(0, 5000) } : {}),
        attributes,
        ...(dump.category ? { categoryIds: [dump.category] } : {}),
        shipsTo: shipsToDefault,
        variants: [{ sku, priceMinor, currency: "DZD" }],
        media: pickImages(it),
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
  log.info(`done: seeded ${ok}, skipped ${skipped}/${items.length}`);
  if (skipped > 0 && ok === 0) process.exit(1);
}

main().catch((err) => {
  log.error({ err }, "seed-from-scraped failed");
  process.exit(1);
});
