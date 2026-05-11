#!/usr/bin/env node
// End-to-end MCP smoke test. Mirrors the streamable-HTTP handshake the Claude
// Code MCP client performs, then exercises the seller-write tools end-to-end.
//
//   node scripts/test-mcp.mjs
//
// Env:
//   MCP_URL   - default https://api.teno-store.com/mcp
//   MCP_TOKEN - admin shared secret (default: hardcoded prod value)
//   AGENT_ID  - default agt_mcp_smoke

import { randomUUID } from "node:crypto";

const URL_ = process.env.MCP_URL ?? "https://api.teno-store.com/mcp";
const TOKEN = process.env.MCP_TOKEN ?? "634de6fee2936f1feacf839346f6dfdf70d864d2f20bb0432be5f723689405e4";
const AGENT_ID = process.env.AGENT_ID ?? "agt_mcp_smoke";
const ORIGIN = new URL(URL_).origin;

let failures = 0;
function check(label, ok, detail) {
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

async function http(method, path, { headers = {}, body } = {}) {
  const url = path.startsWith("http") ? path : ORIGIN + path;
  const res = await fetch(url, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}

async function rpc(method, params, id = 1) {
  return http("POST", URL_, {
    headers: {
      "accept": "application/json, text/event-stream",
      "x-mp-mcp-token": TOKEN,
      "x-mp-agent-id": AGENT_ID,
    },
    body: { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) },
  });
}

console.log(`MCP target: ${URL_}\n`);

// --- 1. Transport probes (must NOT 401, or CC escalates to OAuth) ---
const probeGet = await http("GET", URL_, { headers: { accept: "text/event-stream" } });
check("GET /mcp returns 405 (no SSE)", probeGet.status === 405, `got ${probeGet.status}`);

const probeDel = await http("DELETE", URL_);
check("DELETE /mcp returns 405", probeDel.status === 405, `got ${probeDel.status}`);

// --- 2. JSON-RPC handshake ---
const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke", version: "1.0" },
}, 1);
check(
  "initialize → 200 with tools capability",
  init.status === 200 && init.json?.result?.capabilities?.tools !== undefined,
  init.status !== 200 ? `HTTP ${init.status}` : JSON.stringify(init.json?.result?.serverInfo),
);

const notif = await rpc("notifications/initialized", undefined, undefined);
// notifications have no id; rpc() sets id:1 by default — drop it for the wire test
const notif2 = await http("POST", URL_, {
  headers: { accept: "application/json", "x-mp-mcp-token": TOKEN },
  body: { jsonrpc: "2.0", method: "notifications/initialized" },
});
check("notifications/initialized → 202", notif2.status === 202, `got ${notif2.status}`);

// --- 3. Tool discovery ---
const list = await rpc("tools/list", undefined, 2);
const toolNames = (list.json?.result?.tools ?? []).map((t) => t.name).sort();
check(
  "tools/list returns the two write tools",
  toolNames.includes("seller.create_account") && toolNames.includes("product.create_listing"),
  toolNames.join(","),
);

// --- 4. Write path: create a transient seller via MCP ---
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const displayName = `mcp-smoke-${stamp}`;
const createSeller = await rpc(
  "tools/call",
  { name: "seller.create_account", arguments: { displayName } },
  3,
);
let sellerId;
try {
  const inner = JSON.parse(createSeller.json?.result?.content?.[0]?.text ?? "{}");
  sellerId = inner.sellerId;
} catch {}
check(
  `seller.create_account creates "${displayName}"`,
  createSeller.status === 200 && !!sellerId,
  createSeller.status !== 200
    ? `HTTP ${createSeller.status}: ${createSeller.text.slice(0, 200)}`
    : `sellerId=${sellerId}`,
);

// --- 5. Create a product under that seller ---
let productId;
if (sellerId) {
  const sku = `MCPSMOKE-${stamp.slice(-8)}`;
  const createProduct = await rpc(
    "tools/call",
    {
      name: "product.create_listing",
      arguments: {
        sellerId,
        title: "MCP Smoke Test Phone",
        brand: "Acme",
        variants: [{ sku, priceMinor: 100000, currency: "DZD", inStock: true }],
      },
    },
    4,
  );
  try {
    const inner = JSON.parse(createProduct.json?.result?.content?.[0]?.text ?? "{}");
    productId = inner.productId;
  } catch {}
  check(
    "product.create_listing creates a product",
    createProduct.status === 200 && !!productId,
    createProduct.status !== 200
      ? `HTTP ${createProduct.status}: ${createProduct.text.slice(0, 200)}`
      : `productId=${productId}`,
  );
}

// --- 6. Verify via the public REST surface ---
if (sellerId) {
  const verify = await http("GET", `/v1/sellers/${sellerId}`);
  check(
    "GET /v1/sellers/<id> sees the smoke seller",
    verify.status === 200 && verify.json?.displayName === displayName,
    `productCount=${verify.json?.productCount}`,
  );
}

// --- 7. Summary ---
console.log("");
console.log(`Smoke artefact: seller ${sellerId ?? "(none)"}${productId ? ", product " + productId : ""}`);
console.log(failures === 0 ? "ALL PASS" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
