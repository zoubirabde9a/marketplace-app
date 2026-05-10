// Seeds a batch of Algerian-style products with varied posting dates so the
// "Posted N days ago" UI can be exercised against real DB rows. Mirrors what
// scraper/scrape-ouedkniss → scraper/seed-from-scraped would produce, minus the
// actual scrape.
//
// Usage:
//   node scripts/seed-dated-products.mjs

const BASE = process.env.MARKETPLACE_BASE ?? "http://127.0.0.1:3100";
const SESSION_JWT = process.env.SESSION_JWT;

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

const SELLERS = [
  { displayName: "Smart Phone DZ — Alger Centre", phone: "+213555000111", whatsapp: "+213555000111" },
  { displayName: "Auto Bazar Oran (dated)",        phone: "+213555000222", whatsapp: "+213555000222" },
  { displayName: "TechStore Annaba (dated)",       phone: "+213555000333", whatsapp: "+213555000333" },
];

// Products span ages from "just now" to "older than the 3-day cutoff" so we
// can confirm both: (a) the UI renders the right "N days/hours ago" string,
// (b) older items co-exist with fresh ones.
const PRODUCTS = [
  { title: "iPhone 15 Pro 256GB — Neuf scellé", priceMinor: "26500000", category: "telephones", ageHours: 0 },
  { title: "Samsung Galaxy S24 Ultra — Garantie 1 an", priceMinor: "23900000", category: "telephones", ageHours: 1 },
  { title: "Xiaomi Redmi Note 13 Pro 8/256GB", priceMinor: "4800000", category: "telephones", ageHours: 5 },
  { title: "iPhone 13 128GB — Comme neuf", priceMinor: "9500000", category: "telephones", ageHours: 12 },
  { title: "Realme C55 6/128GB", priceMinor: "2800000", category: "telephones", ageHours: 18 },
  { title: "Honor Magic 6 Lite", priceMinor: "5300000", category: "telephones", ageHours: 22 },
  { title: "Oppo A78 4G", priceMinor: "3200000", category: "telephones", ageHours: 24 },
  { title: "MacBook Air M3 13\" 256GB", priceMinor: "21500000", category: "informatique", ageHours: 28 },
  { title: "Lenovo IdeaPad Slim 5 Ryzen 7", priceMinor: "11800000", category: "informatique", ageHours: 36 },
  { title: "Écran Samsung 27\" QHD 165Hz Gaming", priceMinor: "5400000", category: "informatique", ageHours: 40 },
  { title: "Clavier mécanique Logitech G Pro X", priceMinor: "1450000", category: "informatique", ageHours: 48 },
  { title: "Souris Razer DeathAdder V3", priceMinor: "850000", category: "informatique", ageHours: 50 },
  { title: "Renault Symbol 2018 Diesel 1.5 dCi", priceMinor: "115000000", category: "vehicules", ageHours: 56 },
  { title: "Hyundai i10 2020 Essence", priceMinor: "168000000", category: "vehicules", ageHours: 60 },
  { title: "Peugeot 208 Active 2019", priceMinor: "175000000", category: "vehicules", ageHours: 62 },
  { title: "Dacia Sandero Stepway 2021", priceMinor: "189000000", category: "vehicules", ageHours: 66 },
  { title: "Robe traditionnelle Karakou brodée main", priceMinor: "3500000", category: "mode", ageHours: 70 },
  { title: "Costume homme 3 pièces — laine", priceMinor: "1800000", category: "mode", ageHours: 71 },
  // The next two are intentionally older than the scraper's 3-day cutoff so we
  // can see how stale items render in the UI alongside fresh ones.
  { title: "Salon marocain 8 places — velours", priceMinor: "12500000", category: "maison", ageHours: 96 },
  { title: "Tapis berbère fait main 2x3m", priceMinor: "4500000", category: "maison", ageHours: 168 },
];

const STAMP = Date.now().toString(36);
function key(prefix, n) { return `${prefix}-${STAMP}-${String(n).padStart(4, "0")}`; }
function slug(s, max = 24) {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

async function main() {
  console.log(`base: ${BASE}`);

  const sellerIds = [];
  for (let i = 0; i < SELLERS.length; i++) {
    const s = await jf("POST", "/v1/sellers", SELLERS[i], key("dated-s", i));
    sellerIds.push(s.sellerId);
    console.log(`seller ${i}: ${s.sellerId} — ${SELLERS[i].displayName}`);
  }

  const now = Date.now();
  let ok = 0;
  for (let i = 0; i < PRODUCTS.length; i++) {
    const p = PRODUCTS[i];
    const sellerId = sellerIds[i % sellerIds.length];
    const postedAt = new Date(now - p.ageHours * 3600_000).toISOString();
    const body = {
      sellerId,
      title: p.title,
      attributes: {
        source: "ouedkniss-public-listing",
        sourceCategory: p.category,
        sourcePostedAt: postedAt,
      },
      categoryIds: [p.category],
      shipsTo: ["DZ"],
      variants: [{ sku: `dated-${slug(p.title)}-${i}`, priceMinor: p.priceMinor, currency: "DZD" }],
    };
    const r = await jf("POST", "/v1/products", body, key("dated-p", i));
    const dzd = (Number(p.priceMinor) / 100).toLocaleString("fr-DZ");
    console.log(`  ${r.productId} — ${p.title} (DZD ${dzd}) [posted ${p.ageHours}h ago]`);
    ok++;
  }
  console.log(`\nseeded ${ok} dated products across ${sellerIds.length} sellers`);
}

main().catch((e) => { console.error(e); process.exit(1); });
