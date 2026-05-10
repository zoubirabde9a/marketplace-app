#!/usr/bin/env node
// Probe teno-store.com through Cloudflare to detect the "intermittent ~7.7s"
// failure mode documented in deploy/runbooks/08-cloudflare-intermittent-slowness.md.
//
// Symptom: ~5-10% of requests resolve to a Cloudflare edge IP that cannot reach
// origin on first try, times out after ~5s, retries, succeeds. Total ~7.7s.
// Healthy requests are ~200ms.
//
// Usage:
//   node scripts/probe-cf.mjs                       # 50 requests, default
//   node scripts/probe-cf.mjs --count 200           # more samples
//   node scripts/probe-cf.mjs --url https://api.teno-store.com/livez
//
// Output: per-request line + summary grouped by Cloudflare edge IP. If one
// edge IP shows consistently slow times (≥3s) while others are fast, the
// origin-side path from that PoP is broken.

import { performance } from "node:perf_hooks";
import dns from "node:dns/promises";
import https from "node:https";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, a) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), a[i + 1]]);
    return acc;
  }, []),
);

const TARGET = args.url ?? "https://teno-store.com/";
const COUNT = Number(args.count ?? 50);
const TIMEOUT_MS = Number(args.timeout ?? 15000);

console.log(`probing ${TARGET} × ${COUNT} (timeout ${TIMEOUT_MS}ms)`);
console.log("");

const host = new URL(TARGET).hostname;
const a = await dns.resolve4(host).catch(() => []);
const aaaa = await dns.resolve6(host).catch(() => []);
console.log(`DNS A    : ${a.join(", ") || "(none)"}`);
console.log(`DNS AAAA : ${aaaa.join(", ") || "(none)"}`);
console.log("");

const byIp = new Map();
const slow = [];

for (let i = 1; i <= COUNT; i++) {
  const t0 = performance.now();
  let status = 0;
  let edge = "?";
  let ray = "?";
  let cache = "?";
  let remoteIp = "?";
  try {
    // Fresh https request, no keepAlive, so each iteration gets a new TCP/TLS
    // connection — Cloudflare returns multiple anycast IPs and the OS resolver
    // rotates through them, so we sample different edge IPs / PoPs.
    const u = new URL(TARGET);
    const result = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
          method: "GET",
          headers: { "user-agent": "teno-cf-probe/1.0", host: u.hostname, connection: "close" },
          agent: false,
          timeout: TIMEOUT_MS,
        },
        (res) => {
          remoteIp = res.socket.remoteAddress ?? "?";
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers }));
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
      req.end();
    });
    status = result.statusCode;
    ray = result.headers["cf-ray"] ?? "?";
    cache = result.headers["cf-cache-status"] ?? "?";
    edge = ray.split("-")[1] ?? "?"; // PoP code, e.g. MAD, FRA
  } catch (e) {
    status = -1;
    edge = `ERR:${e.message}`;
  }
  const ms = performance.now() - t0;
  const tag = ms > 3000 ? " !! SLOW" : "";
  console.log(
    `[${String(i).padStart(3)}] ${String(status).padEnd(3)} ${ms.toFixed(0).padStart(5)}ms  pop=${edge}  ip=${remoteIp.padEnd(15)}  cache=${cache}  ray=${ray}${tag}`,
  );
  const key = `${edge} ${remoteIp}`;
  if (!byIp.has(key)) byIp.set(key, { n: 0, totalMs: 0, slowN: 0 });
  const b = byIp.get(key);
  b.n++;
  b.totalMs += ms;
  if (ms > 3000) {
    b.slowN++;
    slow.push({ i, ms, edge, ray });
  }
}

console.log("");
console.log("─── summary by Cloudflare PoP ──────────────────────────");
for (const [pop, b] of [...byIp.entries()].sort((x, y) => y[1].n - x[1].n)) {
  console.log(
    `  ${pop.padEnd(10)}  ${b.n} req   avg ${(b.totalMs / b.n).toFixed(0)}ms   slow(>3s)=${b.slowN}`,
  );
}
if (slow.length) {
  console.log("");
  console.log(`${slow.length}/${COUNT} requests were slow (>3s). Consistent ~7.7s timing across slow requests = Cloudflare connect_timeout + retry to origin.`);
  console.log("→ next: deploy/runbooks/08-cloudflare-intermittent-slowness.md");
} else {
  console.log("");
  console.log("no slow requests this run. Try again with --count 200, or from a different network.");
}
