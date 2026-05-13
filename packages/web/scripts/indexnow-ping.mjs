#!/usr/bin/env node
// IndexNow manual ping CLI.
//
// Pushes URLs to Bing + Yandex (and downstream Yahoo, DuckDuckGo, Ecosia) via
// the IndexNow protocol — https://www.indexnow.org. Google ignores IndexNow.
//
// Usage:
//   node packages/web/scripts/indexnow-ping.mjs                       # defaults
//   node packages/web/scripts/indexnow-ping.mjs https://teno-store.com/product/123
//   node packages/web/scripts/indexnow-ping.mjs url1 url2 url3 ...
//
// Env:
//   SITE_URL   default https://teno-store.com

const KEY = "81b0a3ff408a96ef5c0381a78aae7f58";
const SITE = (process.env.SITE_URL ?? "https://teno-store.com").replace(/\/$/, "");
const HOST = new URL(SITE).host;
const KEY_LOCATION = `${SITE}/${KEY}.txt`;
const ENDPOINT = "https://api.indexnow.org/IndexNow";
const CHUNK = 10_000;

const cliUrls = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const urls = cliUrls.length > 0
  ? cliUrls
  : [
      `${SITE}/`,
      `${SITE}/sitemap.xml`,
      `${SITE}/blog`,
      `${SITE}/about`,
    ];

async function submitChunk(batch) {
  const body = JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList: batch,
  });
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body,
    });
    return { ok: res.ok || res.status === 202, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err?.message ?? String(err) };
  }
}

console.log(`indexnow-ping: ${urls.length} URL(s) · host=${HOST} · key=${KEY.slice(0, 8)}…`);
for (const u of urls) console.log(`  → ${u}`);

let okCount = 0;
let lastStatus = 0;
for (let i = 0; i < urls.length; i += CHUNK) {
  const batch = urls.slice(i, i + CHUNK);
  const r = await submitChunk(batch);
  lastStatus = r.status;
  console.log(`chunk ${Math.floor(i / CHUNK) + 1}: size=${batch.length} status=${r.status} ok=${r.ok}${r.error ? ` error=${r.error}` : ""}`);
  if (r.ok) okCount += batch.length;
}

console.log(`indexnow-ping: ${okCount}/${urls.length} accepted (last status=${lastStatus})`);
process.exit(okCount === urls.length ? 0 : 1);
