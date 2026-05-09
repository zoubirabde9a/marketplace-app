// Reads a JSON file produced by `scripts/scrape-ouedkniss.mjs` and posts each
// listing as a product under one of OUR sellers (the synthetic Algerian sellers
// from `seed-algerian.mjs`). The scraped seller's identity is NEVER copied —
// only public product data (title, image URLs, price text) is reused.
//
// Usage:
//   node scripts/seed-from-scraped.mjs data/ouedkniss-telephone-2026-05-08T...json
//
// Env:
//   MARKETPLACE_BASE  default http://127.0.0.1:3100
//   SESSION_JWT       optional Bearer token for authed prod runs
//   SELLER_ID         required — UUID of the seller these products attach to.
//                     Run seed-algerian.mjs first; copy a sellerId from its log.

import { readFile } from "node:fs/promises";

const BASE = process.env.MARKETPLACE_BASE ?? "http://127.0.0.1:3100";
const SESSION_JWT = process.env.SESSION_JWT;
const SELLER_ID = process.env.SELLER_ID;

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("usage: node scripts/seed-from-scraped.mjs <path-to-scraped-json>");
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

  let ok = 0;
  let skipped = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const title = (it.title ?? "").trim();
    const priceMinor = parsePriceToMinor(it.priceText);
    if (!title || !priceMinor) {
      skipped++;
      continue;
    }
    const sku = `scraped-${slug(title, 24)}-${i}`;
    const body = {
      sellerId: SELLER_ID,
      title: title.slice(0, 300),
      ...(it.description ? { description: String(it.description).slice(0, 5000) } : {}),
      attributes: {
        source: "ouedkniss-public-listing",
        sourceUrl: it.url ?? "",
        sourceCategory: dump.category ?? "",
        ...(it.postedAt ? { sourcePostedAt: it.postedAt } : {}),
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
  console.log(`\nseeded ${ok} products, skipped ${skipped}/${items.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
