// Agent-friendly browser/tester for GET /v1/products.
//
// Goals:
//   1. Show an agent how to scroll/paginate and apply every documented filter.
//   2. Pretty-print each result so an agent can read it without re-formatting.
//   3. After each call, print the exact URL to run for the "next page" or
//      "next refinement", so an agent can chain calls without guessing.
//   4. End with a clear PASS/FAIL summary for each filter and feature so the
//      agent (and the human running this) knows what is actually working.
//
// Usage:
//   node scripts/agent-browse.mjs            # run full test battery
//   node scripts/agent-browse.mjs interactive q=acme        # one-shot query
//   node scripts/agent-browse.mjs interactive q=widget priceMax=2000 sort=price_asc

const BASE = process.env.MARKETPLACE_BASE ?? "http://127.0.0.1:3100";

function buildUrl(params) {
  const u = new URL("/v1/products", BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const x of v) u.searchParams.append(k, x);
    else u.searchParams.set(k, String(v));
  }
  return u;
}

async function fetchProducts(params) {
  const url = buildUrl(params);
  const res = await fetch(url);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { ok: res.ok, status: res.status, url: url.toString(), body };
}

function fmtMoney(minor, currency) {
  if (minor === undefined || minor === null) return "-";
  const n = Number(minor) / 100;
  return `${currency ?? ""} ${n.toFixed(2)}`.trim();
}

function table(rows) {
  if (rows.length === 0) return "  (no rows)";
  const cols = Object.keys(rows[0]);
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  const line = (vals) => "  " + vals.map((v, i) => String(v ?? "").padEnd(widths[i])).join("  ");
  return [line(cols), line(widths.map((w) => "-".repeat(w))), ...rows.map((r) => line(cols.map((c) => r[c])))].join("\n");
}

function summarize(body) {
  const data = body?.data ?? [];
  const rows = data.map((p) => ({
    productId: p.productId,
    title: p.title?.value ?? "?",
    brand: p.brand ?? "-",
    price: fmtMoney(p.priceMinor, p.currency),
    inStock: p.inStock ? "y" : "n",
    seller: p.sellerId,
  }));
  return { rows, totalEstimate: body?.pagination?.totalEstimate ?? 0, cursor: body?.pagination?.cursor ?? null };
}

function nextHint(params, cursor) {
  if (!cursor) return "  (no next page — server returned no cursor)";
  const next = { ...params, cursor };
  return "  next page command:\n    curl -sS '" + buildUrl(next).toString() + "'";
}

async function showQuery(label, params) {
  const res = await fetchProducts(params);
  console.log(`\n=== ${label} ===`);
  console.log(`  URL: ${res.url}`);
  console.log(`  HTTP: ${res.status}`);
  if (!res.ok) {
    console.log(`  ERROR body: ${JSON.stringify(res.body)}`);
    return { ...res, summary: null };
  }
  const sum = summarize(res.body);
  console.log(`  totalEstimate: ${sum.totalEstimate}    returned: ${sum.rows.length}    cursor: ${sum.cursor ?? "none"}`);
  console.log(table(sum.rows));
  console.log(nextHint(params, sum.cursor));
  return { ...res, summary: sum };
}

// ---- Test battery ----------------------------------------------------------

async function runBattery() {
  const results = [];
  function record(name, ok, note) { results.push({ name, ok, note: note ?? "" }); }

  // 1. Browse-all (no q, no filters) — pure catalog stroll.
  let r = await showQuery("[1] Browse all (no q, no filters)", { limit: 100 });
  record("browse-all returns every seeded product", (r.summary?.rows.length ?? 0) === 13);

  // 2. Pagination: ask for 5 at a time, follow the cursor.
  r = await showQuery("[2a] Pagination page 1 (limit=5)", { limit: 5 });
  const cursor = r.summary?.cursor;
  if (cursor) {
    const r2 = await showQuery("[2b] Pagination page 2 (using cursor)", { limit: 5, cursor });
    record("cursor pagination advances", r2.summary && r2.summary.rows[0]?.productId !== r.summary.rows[0]?.productId);
  } else {
    record("cursor pagination advances", false, "server did not return a cursor");
  }

  // 3. Brand filter.
  r = await showQuery("[3] Filter by brand=Acme", { brand: "Acme", limit: 50 });
  record(
    "brand filter applies",
    r.summary && r.summary.rows.length > 0 && r.summary.rows.every((x) => x.brand === "Acme"),
    r.summary ? `returned brands: ${[...new Set(r.summary.rows.map((x) => x.brand))].join(", ")}` : "",
  );

  // 4. Price range filter.
  r = await showQuery("[4] Filter priceMin=1000 priceMax=3000", { priceMin: 1000, priceMax: 3000, limit: 50 });
  const inRange = r.summary?.rows.every((x) => {
    const m = x.price.match(/(\d+\.\d+)/);
    if (!m) return false;
    const minor = Math.round(parseFloat(m[1]) * 100);
    return minor >= 1000 && minor <= 3000;
  });
  record("price range filter applies", !!inRange && (r.summary?.rows.length ?? 0) > 0);

  // 5. Currency filter.
  r = await showQuery("[5] Filter currency=EUR", { currency: "EUR", limit: 50 });
  record(
    "currency filter applies",
    r.summary && r.summary.rows.length > 0 && r.summary.rows.every((x) => x.price.startsWith("EUR")),
    r.summary ? `returned currencies: ${[...new Set(r.summary.rows.map((x) => x.price.split(" ")[0]))].join(", ")}` : "",
  );

  // 6. Sort: price ascending across the entire catalog.
  r = await showQuery("[6] Sort by price_asc", { sort: "price_asc", limit: 50 });
  let sorted = true;
  if (r.summary) {
    const prices = r.summary.rows.map((x) => parseFloat((x.price.match(/(\d+\.\d+)/) ?? ["0"])[0]));
    for (let i = 1; i < prices.length; i++) if (prices[i] < prices[i - 1]) { sorted = false; break; }
  }
  record("sort=price_asc actually sorts", sorted && (r.summary?.rows.length ?? 0) > 1);

  // 7. Limit clamp / boundary.
  r = await showQuery("[7] limit=2 (boundary)", { limit: 2 });
  record("limit honored", r.summary?.rows.length === 2);

  // 8. Bad params — should 4xx problem+JSON, not 500.
  r = await fetchProducts({ limit: 9999 });
  console.log(`\n=== [8] Bad input limit=9999 ===\n  URL: ${r.url}\n  HTTP: ${r.status}\n  body: ${JSON.stringify(r.body).slice(0, 200)}`);
  record(
    "rejects out-of-range limit with 4xx problem+json",
    r.status === 400 && r.body?.type?.includes("/errors/validation"),
  );

  // 9. Combined filter+sort+pagination — the realistic "agent does its job" case.
  r = await showQuery("[9] Combined: brand=Acme priceMax=4000 sort=price_asc limit=3", {
    brand: "Acme",
    priceMax: 4000,
    sort: "price_asc",
    limit: 3,
  });
  let combinedOk = false;
  if (r.summary && r.summary.rows.length > 0) {
    const allAcme = r.summary.rows.every((x) => x.brand === "Acme");
    const allUnder = r.summary.rows.every((x) => {
      const m = x.price.match(/(\d+\.\d+)/);
      return m ? Math.round(parseFloat(m[1]) * 100) <= 4000 : false;
    });
    const prices = r.summary.rows.map((x) => parseFloat((x.price.match(/(\d+\.\d+)/) ?? ["0"])[0]));
    let asc = true;
    for (let i = 1; i < prices.length; i++) if (prices[i] < prices[i - 1]) { asc = false; break; }
    combinedOk = allAcme && allUnder && asc;
  }
  record("combined filter+sort+limit works", combinedOk);

  // 10. No-match query.
  r = await showQuery("[10] No-match query (q='zzznothing')", { q: "zzznothing" });
  record("empty result returns 200 + empty data[]", r.ok && (r.summary?.rows.length ?? -1) === 0);

  // 11. Attribute filter: products with color=red.
  r = await showQuery("[11] Attribute filter attr.color=red", { "attr.color": "red", limit: 50 });
  record(
    "attribute filter applies",
    r.summary && r.summary.rows.length > 0,
    r.summary ? `returned ${r.summary.rows.length} matching products` : "",
  );

  // 12. Attribute-aware text search ("red" should find color=red even if title doesn't say red).
  r = await showQuery("[12] Text search hits attribute values (q=red)", { q: "red", limit: 50 });
  record(
    "text search includes attributes",
    r.summary && r.summary.rows.some((x) => x.title === "Sprocket A"),
    r.summary ? `found titles: ${r.summary.rows.map((x) => x.title).join(", ")}` : "",
  );

  // 13. Sellers list endpoint.
  const sellersRes = await fetch(`${BASE}/v1/sellers`);
  const sellersBody = await sellersRes.json();
  console.log(`\n=== [13] GET /v1/sellers ===\n  HTTP: ${sellersRes.status}\n  total: ${sellersBody?.pagination?.totalEstimate}`);
  for (const s of sellersBody?.data ?? []) console.log(`    ${s.sellerId}  ${s.displayName.padEnd(20)}  productCount=${s.productCount}`);
  record(
    "GET /v1/sellers returns 3 sellers with productCount",
    sellersRes.ok && sellersBody.data.length === 3 && sellersBody.data.every((s) => typeof s.productCount === "number" && s.productCount > 0),
  );

  // 14. Single seller lookup.
  const oneId = sellersBody?.data?.[0]?.sellerId;
  if (oneId) {
    const oneRes = await fetch(`${BASE}/v1/sellers/${oneId}`);
    const oneBody = await oneRes.json();
    console.log(`\n=== [14] GET /v1/sellers/${oneId} ===\n  HTTP: ${oneRes.status}\n  body: ${JSON.stringify(oneBody)}`);
    record("GET /v1/sellers/:id returns seller", oneRes.ok && oneBody.sellerId === oneId);
  } else {
    record("GET /v1/sellers/:id returns seller", false, "no seller from list");
  }

  // 15. Unknown seller → 404 problem+JSON.
  const missRes = await fetch(`${BASE}/v1/sellers/sel_does_not_exist`);
  const missBody = await missRes.json().catch(() => ({}));
  console.log(`\n=== [15] GET /v1/sellers/sel_does_not_exist ===\n  HTTP: ${missRes.status}\n  body: ${JSON.stringify(missBody).slice(0, 200)}`);
  record("unknown seller → 404 problem+json", missRes.status === 404 && missBody?.type?.includes("/errors/not-found"));

  // 16. Multi-page stable cursor: walk every page in chunks of 4 and confirm
  //     we cover all 13 products with no duplicates.
  const seen = new Set();
  let nextCursor;
  let pageCount = 0;
  do {
    const params = { limit: 4, ...(nextCursor ? { cursor: nextCursor } : {}) };
    const pr = await fetchProducts(params);
    pageCount++;
    for (const p of pr.body?.data ?? []) {
      if (seen.has(p.productId)) {
        record("multi-page cursor: no duplicates", false, `dup ${p.productId} on page ${pageCount}`);
        seen.add("__DUP__");
      }
      seen.add(p.productId);
    }
    nextCursor = pr.body?.pagination?.cursor ?? null;
  } while (nextCursor && pageCount < 10);
  console.log(`\n=== [16] Stable cursor: walked ${pageCount} pages, saw ${seen.size} unique products ===`);
  if (!seen.has("__DUP__")) record("multi-page cursor: no duplicates", true, `${pageCount} pages, ${seen.size} unique products`);
  record("multi-page cursor: covers full catalog", seen.size === 13);

  // 17. Drill-aware facets: with brand=Acme active, the brands facet should
  //     still surface Globex and Initech as alternatives.
  r = await showQuery("[17] Drill-aware facets (brand=Acme)", { brand: "Acme", limit: 5 });
  const facetBrands = (r.body?.facets?.brands ?? []).map((b) => b.value);
  record(
    "brands facet shows alternatives even when brand filter is active",
    facetBrands.includes("Acme") && facetBrands.includes("Globex") && facetBrands.includes("Initech"),
    `facet brands: [${facetBrands.join(", ")}]`,
  );

  // 18. Category filter.
  r = await showQuery("[18] Filter category=tools", { category: "tools", limit: 50 });
  record(
    "category filter applies",
    r.summary && r.summary.rows.length > 0 && r.body.data.every((x) => (x.categoryIds ?? []).includes("tools")),
    r.summary ? `returned ${r.summary.rows.length} products` : "",
  );

  // 19. shipsTo filter (DE) — only the Drill 18V (EU) ships to Germany.
  r = await showQuery("[19] Filter shipsTo=DE", { shipsTo: "DE", limit: 50 });
  record(
    "shipsTo filter applies",
    r.summary && r.summary.rows.length === 1 && r.summary.rows[0]?.title === "Drill 18V (EU)",
  );

  // 20. Categories facet present and includes the seeded categories.
  r = await showQuery("[20] Categories facet exposed", { limit: 5 });
  const facetCats = (r.body?.facets?.categories ?? []).map((c) => c.value);
  record(
    "categories facet present and populated",
    facetCats.includes("hardware") && facetCats.includes("tools") && facetCats.includes("office"),
    `categories facet: [${facetCats.join(", ")}]`,
  );

  // 21. Fuzzy search: typo "widgit" should still find Widget products.
  const strict = await fetchProducts({ q: "widgit", limit: 50 });
  const strictCount = strict.body?.data?.length ?? 0;
  const fuzzy = await fetchProducts({ q: "widgit", fuzzy: "true", limit: 50 });
  const fuzzyTitles = (fuzzy.body?.data ?? []).map((x) => x.title.value);
  console.log(`\n=== [21] Fuzzy: q='widgit' strict=${strictCount} hits, fuzzy=${fuzzyTitles.length} hits ===`);
  console.log(`  fuzzy titles: ${fuzzyTitles.join(", ")}`);
  record(
    "fuzzy=true tolerates a 1-char typo",
    strictCount === 0 && fuzzyTitles.some((t) => t.toLowerCase().includes("widget")),
  );

  // 22. Batch-by-id endpoint.
  const list2 = await fetchProducts({ limit: 3 });
  const ids = (list2.body?.data ?? []).map((x) => x.productId);
  const batchUrl = new URL(`${BASE}/v1/products/_batch`);
  for (const id of ids) batchUrl.searchParams.append("id", id);
  batchUrl.searchParams.append("id", "prd_does_not_exist");
  const batchRes = await fetch(batchUrl);
  const batchBody = await batchRes.json();
  console.log(`\n=== [22] GET /v1/products/_batch ===\n  HTTP: ${batchRes.status}\n  data.length: ${batchBody?.data?.length}\n  notFound: ${JSON.stringify(batchBody?.notFound)}`);
  record(
    "batch endpoint returns hits + notFound[]",
    batchRes.ok
      && Array.isArray(batchBody.data)
      && batchBody.data.length === ids.length
      && batchBody.data.every((p, i) => p.productId === ids[i])
      && batchBody.notFound.length === 1
      && batchBody.notFound[0] === "prd_does_not_exist",
  );

  // 23. Detail endpoint round-trip.
  const list = await fetchProducts({ q: "Sprocket", limit: 1 });
  const id = list.body?.data?.[0]?.productId;
  if (id) {
    const det = await fetch(`${BASE}/v1/products/${id}`);
    const detText = await det.text();
    const detBody = JSON.parse(detText);
    const ok = det.ok && detBody.productId === id && typeof detBody.sellerDisplayName === "string";
    console.log(`\n=== [23] Detail GET /v1/products/${id} ===\n  HTTP: ${det.status}\n  sellerDisplayName: ${detBody.sellerDisplayName}`);
    record("detail endpoint returns matching product (with sellerDisplayName)", ok);
  } else {
    record("detail endpoint returns matching product (with sellerDisplayName)", false, "no product to look up");
  }

  // ---- Summary --------------------------------------------------------------
  console.log("\n=========================================================");
  console.log("  TEST SUMMARY");
  console.log("=========================================================");
  for (const r of results) {
    const tag = r.ok ? "PASS" : "FAIL";
    console.log(`  [${tag}] ${r.name}${r.note ? "  — " + r.note : ""}`);
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n  ${passed}/${results.length} passed`);
  if (passed < results.length) process.exitCode = 1;
}

// ---- Interactive one-shot --------------------------------------------------

async function runInteractive(argv) {
  const params = {};
  for (const a of argv) {
    const eq = a.indexOf("=");
    if (eq < 0) continue;
    const k = a.slice(0, eq);
    const v = a.slice(eq + 1);
    if (params[k] === undefined) params[k] = v;
    else params[k] = Array.isArray(params[k]) ? [...params[k], v] : [params[k], v];
  }
  if (!params.q) {
    console.error("usage: node scripts/agent-browse.mjs interactive q=<text> [brand=...] [priceMin=...] [priceMax=...] [currency=...] [sort=...] [limit=...] [cursor=...]");
    process.exit(2);
  }
  await showQuery(`interactive q=${params.q}`, params);
}

const [, , mode, ...rest] = process.argv;
if (mode === "interactive") runInteractive(rest);
else runBattery();
