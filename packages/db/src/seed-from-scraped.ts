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
  let noPhone = 0;
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
    // Hard requirement (2026-05-13): every seeded product must carry at least
    // one phone number reachable by a buyer. Listings the scraper couldn't
    // resolve a phone for — neither per-listing reveal nor store-level —
    // are dropped before insert. This is the only way a buyer can actually
    // contact the seller, so a phoneless row is dead inventory.
    const phones = collectPhones(it, stores);
    if (phones.length === 0) {
      noPhone++;
      log.warn(`skip [${i}] no phone reachable (storeId=${it.sellerStoreId ?? "-"}, listingPhones=${it.phoneEntries?.length ?? 0}): ${title.slice(0, 60)}`);
      continue;
    }
    const sku = `scraped-${slug(title, 24)}-${i}`;
    const brand = inferBrand(title);
    const attributes: Record<string, string> = {
      source: "ouedkniss-public-listing",
      sourceUrl: it.url ?? "",
      sourceCategory: dump.category ?? "",
      sourcePhones: phones.join(","),
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
        sellerId: null,
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
    `seeded ${ok} products, skipped ${skipped + noPhone}/${items.length} (${dups} as already-seeded duplicates, ${noPhone} dropped for missing phone)`,
  );
  log.info(`done: seeded ${ok}, skipped ${skipped}/${items.length}, noPhone ${noPhone}, dups ${dups}`);
  if (ok === 0 && (skipped > 0 || noPhone > 0) && dups === 0) process.exit(1);
}

main().catch((err) => {
  log.error({ err }, "seed-from-scraped failed");
  process.exit(1);
});
