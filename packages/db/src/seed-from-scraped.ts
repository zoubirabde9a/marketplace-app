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
//   SKIP_URLS_FILE        optional path to a newline-delimited file of source
//                         URLs already seeded. Listings with a matching `url`
//                         are skipped before insert and counted as `dups`.
//                         The scrape→seed loop populates this from Postgres
//                         before each run so re-scraped items don't double-seed.
//   DRY_RUN=1             parse and print, don't write anything.
//
// The scraped seller's identity is NEVER copied — only public product data
// (title, image URLs, price text, posting date). See scraper/README.md for
// the legal & privacy posture.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
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
  // Per-listing seller identity (added 2026-05-11). All three may be null
  // for legacy dumps; the seeder falls back to env SELLER_ID in that case.
  sellerUserId?: string | null;
  sellerIsFromStore?: boolean;
  sellerStoreId?: string | null;
}

interface ScrapedStore {
  id: string;
  name?: string | null;
  slug?: string | null;
  phones?: string[];
  emails?: string[];
  website?: string | null;
  whatsapp?: string | null;
  facebook?: string | null;
  telegram?: string | null;
  address?: string | null;
  city?: string | null;
  region?: string | null;
}

interface ScrapedDump {
  category?: string;
  count?: number;
  items?: ScrapedItem[];
  stores?: Record<string, ScrapedStore>;
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

// Per-listing seller key. Shop accounts have a store id (preferred —
// same key across both their store page and their listings); individual
// sellers only have a user id. Returns null when neither is present
// (legacy dumps), which sends the listing to the fallback seller.
function sellerKey(item: ScrapedItem): string | null {
  if (item.sellerIsFromStore && item.sellerStoreId) {
    return `okk-store-${item.sellerStoreId}`;
  }
  if (item.sellerUserId) {
    return `okk-user-${item.sellerUserId}`;
  }
  return null;
}

// Synthetic seller display name. Operator policy: real Ouedkniss
// displayNames are never copied. The 5-char suffix is the first 5 chars
// of sha1(key) so the same Ouedkniss seller always gets the same name
// across runs (sellers may exist before the seller-profile row does).
function syntheticName(key: string, kind: "store" | "user"): string {
  const tag = createHash("sha1").update(key).digest("hex").slice(0, 5).toUpperCase();
  return kind === "store" ? `Vendeur Pro ${tag}` : `Vendeur ${tag}`;
}

// Pick the first phone that parses as Algerian-shaped. Ouedkniss stores
// most numbers as "+213XXXXXXXXX" (12 digits after +). We prefer that
// shape but accept anything non-empty as a last resort.
function pickPhone(phones: string[] | undefined): string | undefined {
  if (!phones?.length) return undefined;
  const dz = phones.find((p) => /^\+213\d{9}$/.test((p ?? "").replace(/\s+/g, "")));
  if (dz) return dz.replace(/\s+/g, "");
  const any = phones.find(Boolean);
  return any ? any.trim() : undefined;
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
  log.info(
    `input ${inputPath}: ${items.length} listings, category=${dump.category ?? "?"}` +
      (dryRun ? " [DRY_RUN]" : ""),
  );

  const { db, close } = createDb({ url, applicationName: "seed-from-scraped" });
  const repos = createRepos(db);
  const stores = dump.stores ?? {};

  // Optional fallback for listings whose seller fields are missing (e.g.
  // legacy dumps from before the scraper captured seller identity). When
  // SELLER_ID is set, those listings land on that seller; when not, they
  // are skipped (counted as invalid).
  let fallbackSellerId: string | undefined;
  if (requestedSellerId) {
    const seller = await repos.sellers.get(requestedSellerId);
    if (!seller) {
      console.error(`SELLER_ID=${requestedSellerId} not found in organizations table.`);
      await close();
      process.exit(2);
    }
    fallbackSellerId = seller.sellerId;
    log.info(`fallback seller ${seller.sellerId} (${seller.displayName}) for items without seller info`);
  } else {
    log.info("no SELLER_ID set; items without seller info will be skipped");
  }

  // Per-listing seller resolution. Each unique Ouedkniss seller (a store id
  // for shop accounts, a user id for individual sellers) maps to one
  // teno-store seller. The mapping is materialized in `storeSlug` (which
  // is already a unique column) so we can look up the same seller across
  // runs without keeping a side table:
  //   shop account     → storeSlug = "okk-store-<storeId>"
  //   individual user  → storeSlug = "okk-user-<userId>"
  // Cache the resolution per run to avoid re-querying for repeat sellers.
  const sellerCache = new Map<string, string>();
  // Lazy resolution: only paid for the sellers that actually own a listing
  // that survives validation. Returns undefined if the listing has no
  // seller key and no fallback is configured (caller should skip).
  async function resolveSeller(item: ScrapedItem): Promise<string | undefined> {
    const key = sellerKey(item);
    if (!key) return fallbackSellerId;
    const cached = sellerCache.get(key);
    if (cached) return cached;
    const existing = await db
      .select()
      .from(sellerProfiles)
      .where(eq(sellerProfiles.storeSlug, key))
      .limit(1);
    if (existing[0]) {
      sellerCache.set(key, existing[0].orgId);
      return existing[0].orgId;
    }
    // Brand-new seller. Display name is always synthetic (per operator
    // policy, never the real Ouedkniss displayName). Phone/whatsapp/website
    // are only set when the store-enrichment step produced public values;
    // null otherwise (no synthetic phones — operator policy).
    const isShop = item.sellerIsFromStore === true && item.sellerStoreId;
    const display = syntheticName(key, isShop ? "store" : "user");
    const store = isShop && item.sellerStoreId ? stores[item.sellerStoreId] : undefined;
    const phone = pickPhone(store?.phones);
    const whatsapp = store?.whatsapp ?? phone;
    const website = store?.website ?? undefined;
    const created = await repos.sellers.create({
      displayName: display,
      ownerAgentId: `scraper:${key}`,
      ...(phone ? { phone } : {}),
      ...(whatsapp ? { whatsapp } : {}),
      ...(website ? { website } : {}),
    });
    // Override the auto-generated storeSlug with our deterministic key so
    // future runs find this seller by key. Then store the supportEmail if
    // we have one (the create() repo path doesn't accept it).
    const email = store?.emails?.[0];
    await db
      .update(sellerProfiles)
      .set({
        storeSlug: key,
        ...(email ? { supportEmail: email } : {}),
      })
      .where(eq(sellerProfiles.orgId, created.sellerId));
    sellerCache.set(key, created.sellerId);
    log.info(
      `seller created: ${key} → ${created.sellerId} (${display})` +
        (phone ? ` phone=${phone}` : " no-phone") +
        (isShop ? " [shop]" : " [individual]"),
    );
    return created.sellerId;
  }

  let ok = 0;
  let skipped = 0;
  let dups = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const sourceUrl = (it.url ?? "").trim();
    if (sourceUrl && skipUrls.has(sourceUrl)) {
      dups++;
      continue;
    }
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

    const sellerId = await resolveSeller(it);
    if (!sellerId) {
      skipped++;
      log.warn(`skip [${i}] no seller (sellerKey=null and no SELLER_ID fallback set)`);
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
  // Plain-text summary on stdout (separate from pino JSON) so the
  // run-loop.sh shell parser can grep this exact shape — same line
  // shape the legacy HTTP seeder emitted.
  console.log(
    `seeded ${ok} products, skipped ${skipped}/${items.length} (${dups} as already-seeded duplicates)`,
  );
  log.info(`done: seeded ${ok}, skipped ${skipped}/${items.length}, dups ${dups}`);
  if (ok === 0 && skipped > 0 && dups === 0) process.exit(1);
}

main().catch((err) => {
  log.error({ err }, "seed-from-scraped failed");
  process.exit(1);
});
