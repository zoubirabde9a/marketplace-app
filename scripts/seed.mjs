// Seeds a diverse product catalog into the running dev API so the agent
// browse script has something to look at. Idempotent within a single server
// run (the in-memory store is empty on fresh start).

const BASE = process.env.MARKETPLACE_BASE ?? "http://127.0.0.1:3100";

async function jf(method, path, body, idem) {
  const headers = { "content-type": "application/json" };
  if (idem) headers["idempotency-key"] = idem;
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
  { displayName: "Acme Widgets" },
  { displayName: "Globex Tools" },
  { displayName: "Initech Supplies" },
];

const PRODUCTS_BY_SELLER = [
  // Acme — widgets/sprockets, USD
  [
    { title: "Sprocket A", brand: "Acme", attributes: { color: "red", size: "M" }, categoryIds: ["hardware", "fasteners"], shipsTo: ["US", "CA"], priceMinor: 1999, currency: "USD" },
    { title: "Sprocket B", brand: "Acme", attributes: { color: "blue", size: "L" }, categoryIds: ["hardware", "fasteners"], shipsTo: ["US", "CA"], priceMinor: 2499, currency: "USD" },
    { title: "Widget Mini", brand: "Acme", attributes: { color: "black" }, categoryIds: ["hardware"], shipsTo: ["US"], priceMinor: 999, currency: "USD" },
    { title: "Widget Pro", brand: "Acme", attributes: { color: "silver" }, categoryIds: ["hardware"], shipsTo: ["US", "CA", "MX"], priceMinor: 8999, currency: "USD" },
    { title: "Bracket Kit", brand: "Acme", categoryIds: ["hardware", "fasteners"], shipsTo: ["US"], priceMinor: 3499, currency: "USD" },
  ],
  // Globex — tools, mixed currencies
  [
    { title: "Hammer Classic", brand: "Globex", categoryIds: ["tools"], shipsTo: ["US", "CA", "GB"], priceMinor: 1599, currency: "USD" },
    { title: "Drill 18V", brand: "Globex", categoryIds: ["tools", "power-tools"], shipsTo: ["US", "CA"], priceMinor: 12999, currency: "USD" },
    { title: "Drill 18V (EU)", brand: "Globex", categoryIds: ["tools", "power-tools"], shipsTo: ["DE", "FR", "ES"], priceMinor: 11999, currency: "EUR" },
    { title: "Wrench Set", brand: "Globex", categoryIds: ["tools"], shipsTo: ["GB", "IE"], priceMinor: 4599, currency: "GBP" },
  ],
  // Initech — office supplies
  [
    { title: "Stapler Heavy Duty", brand: "Initech", categoryIds: ["office"], shipsTo: ["US"], priceMinor: 2599, currency: "USD" },
    { title: "Red Stapler", brand: "Initech", categoryIds: ["office"], shipsTo: ["US"], priceMinor: 4999, currency: "USD" },
    { title: "Paper Clips Bulk", brand: "Initech", categoryIds: ["office"], shipsTo: ["US", "CA"], priceMinor: 599, currency: "USD" },
    { title: "Notebook A5", brand: "Initech", categoryIds: ["office", "stationery"], shipsTo: ["US", "CA"], priceMinor: 799, currency: "USD" },
  ],
];

function key(prefix, n) {
  return `${prefix}-${Date.now().toString(36)}-${n.toString().padStart(4, "0")}`;
}

async function main() {
  const sellerIds = [];
  for (let i = 0; i < SELLERS.length; i++) {
    const s = await jf("POST", "/v1/sellers", SELLERS[i], key("seed-s", i));
    sellerIds.push(s.sellerId);
    console.log(`seller ${i}: ${s.sellerId} — ${SELLERS[i].displayName}`);
  }

  let n = 0;
  for (let i = 0; i < PRODUCTS_BY_SELLER.length; i++) {
    for (const p of PRODUCTS_BY_SELLER[i]) {
      const body = {
        sellerId: sellerIds[i],
        title: p.title,
        ...(p.brand ? { brand: p.brand } : {}),
        ...(p.attributes ? { attributes: p.attributes } : {}),
        ...(p.categoryIds ? { categoryIds: p.categoryIds } : {}),
        ...(p.shipsTo ? { shipsTo: p.shipsTo } : {}),
        variants: [{ sku: p.title.replace(/\s+/g, "-").toUpperCase(), priceMinor: p.priceMinor, currency: p.currency }],
      };
      const r = await jf("POST", "/v1/products", body, key("seed-p", n++));
      console.log(`  product: ${r.productId} — ${p.title} (${p.currency} ${p.priceMinor / 100})`);
    }
  }
  console.log(`\nseeded ${n} products across ${sellerIds.length} sellers`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
