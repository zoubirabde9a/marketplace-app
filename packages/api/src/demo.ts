// One-shot end-to-end demo against a running HTTP server:
//   1. create a seller account
//   2. create two products
//   3. list them
// Run with `pnpm demo` (after `pnpm dev:api` is up on PORT 3100).

const BASE = process.env.MARKETPLACE_BASE ?? "http://127.0.0.1:3100";

type Json = Record<string, unknown>;

async function jsonFetch(method: string, path: string, body?: Json, idempotencyKey?: string): Promise<Json> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}\n${text}`);
  }
  return parsed as Json;
}

function banner(title: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n--- ${title} ---`);
}

function show(label: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`${label}: ${JSON.stringify(value, null, 2)}`);
}

async function main(): Promise<void> {
  banner("1. Health check");
  const health = await jsonFetch("GET", "/livez");
  show("livez", health);

  banner("2. Create seller account");
  const seller = await jsonFetch("POST", "/v1/sellers", { displayName: "Acme Widgets" }, `demo-seller-${Date.now()}`);
  show("seller", seller);
  const sellerId = String(seller["sellerId"]);

  banner("3. Create two products");
  const p1 = await jsonFetch(
    "POST",
    "/v1/products",
    {
      sellerId,
      title: "Sprocket A",
      brand: "Acme",
      attributes: { color: "red", size: "M" },
      variants: [{ sku: "SPR-A-1", priceMinor: 1999, currency: "USD" }],
    },
    `demo-prd-1-${Date.now()}`,
  );
  show("product 1", p1);

  const p2 = await jsonFetch(
    "POST",
    "/v1/products",
    {
      sellerId,
      title: "Widget B",
      brand: "Acme",
      variants: [{ sku: "WID-B-1", priceMinor: 4999, currency: "USD" }],
    },
    `demo-prd-2-${Date.now()}`,
  );
  show("product 2", p2);

  banner("4. List products (search by 'acme')");
  const list = await jsonFetch("GET", "/v1/products?q=acme");
  show("list", list);

  banner("Done");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
