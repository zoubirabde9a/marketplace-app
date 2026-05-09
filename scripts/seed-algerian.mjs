// Seeds an Algerian-style classifieds catalog into the running API.
//
// Models the Ouedkniss / Jumia DZ pattern: each seller has a phone + WhatsApp
// number, prices are in DZD, products span phones / electronics / used cars /
// fashion. Phone numbers below are NOT real — they are obvious placeholders in
// the +213 555 00 XX XX block so we don't carry real personal data.
//
// Usage (dev, against in-memory store):
//   pnpm dev:api &
//   node scripts/seed-algerian.mjs
//
// Usage (prod, against teno-store.com):
//   MARKETPLACE_BASE=https://api.teno-store.com \
//   SESSION_JWT=<paste session jwt from /v1/auth/google> \
//   node scripts/seed-algerian.mjs
//
// `priceMinor` is in DZD subunits (santeem). 30,000 DZD = "3000000".

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

// Sellers: each has a fake +213 number flagged as placeholder.
const SELLERS = [
  {
    displayName: "Smart Phone DZ — Alger Centre",
    phone: "+213555000101",
    whatsapp: "+213555000101",
    website: "https://example.dz/smartphonedz",
  },
  {
    displayName: "Auto Bazar Oran",
    phone: "+213555000202",
    whatsapp: "+213555000202",
  },
  {
    displayName: "Mode & Style — Constantine",
    phone: "+213555000303",
    whatsapp: "+213555000303",
  },
  {
    displayName: "TechStore Annaba",
    phone: "+213555000404",
    whatsapp: "+213555000404",
  },
  {
    displayName: "Maison & Déco Sétif",
    phone: "+213555000505",
    whatsapp: "+213555000505",
  },
];

// Realistic Algerian retail prices (DZD, 1 DZD ≈ 0.0073 USD as of 2026-05).
// priceMinor is in santeem (1 DZD = 100 santeem).
const PRODUCTS_BY_SELLER = [
  // 0 — Smart Phone DZ (Alger): smartphones
  [
    {
      title: "iPhone 15 Pro Max 256GB - Neuf scellé",
      brand: "Apple",
      attributes: { storage: "256GB", color: "Titane Naturel", condition: "Neuf", wilaya: "Alger", commune: "Alger Centre" },
      categoryIds: ["telephone", "smartphones"],
      shipsTo: ["DZ"],
      priceMinor: "28000000", // 280,000 DZD
    },
    {
      title: "Samsung Galaxy S24 Ultra 512GB",
      brand: "Samsung",
      attributes: { storage: "512GB", color: "Noir Titane", condition: "Neuf", wilaya: "Alger" },
      categoryIds: ["telephone", "smartphones"],
      shipsTo: ["DZ"],
      priceMinor: "23500000", // 235,000 DZD
    },
    {
      title: "Xiaomi Redmi Note 13 Pro 8/256GB",
      brand: "Xiaomi",
      attributes: { storage: "256GB", ram: "8GB", condition: "Neuf", wilaya: "Alger" },
      categoryIds: ["telephone", "smartphones"],
      shipsTo: ["DZ"],
      priceMinor: "4800000", // 48,000 DZD
    },
    {
      title: "iPhone 13 128GB - Occasion comme neuf",
      brand: "Apple",
      attributes: { storage: "128GB", color: "Bleu", condition: "Occasion", wilaya: "Alger" },
      categoryIds: ["telephone", "smartphones"],
      shipsTo: ["DZ"],
      priceMinor: "9500000", // 95,000 DZD
    },
  ],
  // 1 — Auto Bazar Oran: véhicules d'occasion
  [
    {
      title: "Renault Symbol 2018 Diesel 1.5 dCi",
      brand: "Renault",
      attributes: { year: "2018", fuel: "Diesel", mileage_km: "85000", condition: "Occasion", wilaya: "Oran" },
      categoryIds: ["vehicules", "voitures"],
      shipsTo: ["DZ"],
      priceMinor: "115000000", // 1,150,000 DZD
    },
    {
      title: "Hyundai i10 2020 Essence",
      brand: "Hyundai",
      attributes: { year: "2020", fuel: "Essence", mileage_km: "42000", condition: "Occasion", wilaya: "Oran" },
      categoryIds: ["vehicules", "voitures"],
      shipsTo: ["DZ"],
      priceMinor: "168000000", // 1,680,000 DZD
    },
    {
      title: "Peugeot 208 Active 2019",
      brand: "Peugeot",
      attributes: { year: "2019", fuel: "Essence", mileage_km: "63000", condition: "Occasion", wilaya: "Oran" },
      categoryIds: ["vehicules", "voitures"],
      shipsTo: ["DZ"],
      priceMinor: "175000000", // 1,750,000 DZD
    },
  ],
  // 2 — Mode & Style Constantine
  [
    {
      title: "Robe traditionnelle Karakou brodée main",
      brand: "Atelier Constantine",
      attributes: { size: "M", color: "Bordeaux", material: "Velours", wilaya: "Constantine" },
      categoryIds: ["mode", "femme", "traditionnel"],
      shipsTo: ["DZ"],
      priceMinor: "3500000", // 35,000 DZD
    },
    {
      title: "Costume homme 3 pièces - laine",
      brand: "Mode & Style",
      attributes: { size: "L", color: "Gris anthracite", wilaya: "Constantine" },
      categoryIds: ["mode", "homme"],
      shipsTo: ["DZ"],
      priceMinor: "1800000", // 18,000 DZD
    },
    {
      title: "Sac à main cuir véritable",
      brand: "Mode & Style",
      attributes: { color: "Noir", material: "Cuir", wilaya: "Constantine" },
      categoryIds: ["mode", "accessoires"],
      shipsTo: ["DZ"],
      priceMinor: "650000", // 6,500 DZD
    },
  ],
  // 3 — TechStore Annaba: informatique
  [
    {
      title: "MacBook Air M3 13\" 256GB",
      brand: "Apple",
      attributes: { ram: "8GB", storage: "256GB", condition: "Neuf", wilaya: "Annaba" },
      categoryIds: ["informatique", "ordinateurs", "portables"],
      shipsTo: ["DZ"],
      priceMinor: "21500000", // 215,000 DZD
    },
    {
      title: "Lenovo IdeaPad Slim 5 Ryzen 7",
      brand: "Lenovo",
      attributes: { ram: "16GB", storage: "512GB SSD", condition: "Neuf", wilaya: "Annaba" },
      categoryIds: ["informatique", "ordinateurs", "portables"],
      shipsTo: ["DZ"],
      priceMinor: "11800000", // 118,000 DZD
    },
    {
      title: "Écran Samsung 27\" QHD 165Hz Gaming",
      brand: "Samsung",
      attributes: { size: "27\"", resolution: "2560x1440", refresh: "165Hz", wilaya: "Annaba" },
      categoryIds: ["informatique", "ecrans"],
      shipsTo: ["DZ"],
      priceMinor: "5400000", // 54,000 DZD
    },
    {
      title: "Clavier mécanique Logitech G Pro X",
      brand: "Logitech",
      attributes: { layout: "AZERTY FR", switch: "GX Blue", wilaya: "Annaba" },
      categoryIds: ["informatique", "peripheriques"],
      shipsTo: ["DZ"],
      priceMinor: "1450000", // 14,500 DZD
    },
  ],
  // 4 — Maison & Déco Sétif
  [
    {
      title: "Salon marocain 8 places - tissu velours",
      brand: "Maison & Déco",
      attributes: { seats: "8", material: "Velours", color: "Beige doré", wilaya: "Sétif" },
      categoryIds: ["maison", "salon"],
      shipsTo: ["DZ"],
      priceMinor: "12500000", // 125,000 DZD
    },
    {
      title: "Réfrigérateur LG 500L No Frost",
      brand: "LG",
      attributes: { capacity_liters: "500", color: "Inox", wilaya: "Sétif" },
      categoryIds: ["maison", "electromenager"],
      shipsTo: ["DZ"],
      priceMinor: "16500000", // 165,000 DZD
    },
    {
      title: "Tapis berbère fait main 2x3m",
      brand: "Artisanat Sétif",
      attributes: { dimensions: "200x300cm", material: "Laine", wilaya: "Sétif" },
      categoryIds: ["maison", "decoration"],
      shipsTo: ["DZ"],
      priceMinor: "4500000", // 45,000 DZD
    },
  ],
];

// Stable idempotency keys: re-running the seeder must NOT create duplicates.
// Keys must therefore be deterministic (no Date.now()).
function key(prefix, n) {
  return `${prefix}-${n.toString().padStart(4, "0")}`;
}

function slugify(s) {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function main() {
  console.log(`base: ${BASE}`);
  if (!SESSION_JWT && !BASE.includes("127.0.0.1") && !BASE.includes("localhost")) {
    console.warn("WARN: hitting a non-local base URL without SESSION_JWT — POST /v1/sellers will 401 unless DEV_BYPASS=1 on the server.");
  }

  const sellerIds = [];
  for (let i = 0; i < SELLERS.length; i++) {
    const s = await jf("POST", "/v1/sellers", SELLERS[i], key("alg-s", i));
    sellerIds.push(s.sellerId);
    console.log(`seller ${i}: ${s.sellerId} — ${SELLERS[i].displayName} (${SELLERS[i].phone})`);
  }

  let n = 0;
  for (let i = 0; i < PRODUCTS_BY_SELLER.length; i++) {
    for (const p of PRODUCTS_BY_SELLER[i]) {
      const sku = `${slugify(SELLERS[i].displayName).slice(0, 16)}-${slugify(p.title).slice(0, 24)}-${n}`;
      const body = {
        sellerId: sellerIds[i],
        title: p.title,
        ...(p.brand ? { brand: p.brand } : {}),
        ...(p.attributes ? { attributes: p.attributes } : {}),
        ...(p.categoryIds ? { categoryIds: p.categoryIds } : {}),
        ...(p.shipsTo ? { shipsTo: p.shipsTo } : {}),
        variants: [{ sku, priceMinor: p.priceMinor, currency: "DZD" }],
      };
      const r = await jf("POST", "/v1/products", body, key("alg-p", n++));
      const dzd = (Number(p.priceMinor) / 100).toLocaleString("fr-DZ");
      console.log(`  product: ${r.productId} — ${p.title} (DZD ${dzd})`);
    }
  }
  console.log(`\nseeded ${n} products across ${sellerIds.length} Algerian-style sellers`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
