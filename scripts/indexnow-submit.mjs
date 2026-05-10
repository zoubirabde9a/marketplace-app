#!/usr/bin/env node
// Submit URLs to IndexNow (https://www.indexnow.org/) — pushes the catalog to
// Bing, Yandex, Seznam, and Naver without any operator-side login. Bing in
// particular feeds DuckDuckGo and ChatGPT search, so this is the highest-
// leverage discovery push we can do without Google Search Console access.
//
// Default mode: read the live /sitemap.xml, extract every <loc>, and POST in
// chunks of 10,000 (the IndexNow per-request cap) to https://api.indexnow.org.
//
// Pass URLs on stdin (one per line) to override the sitemap source — useful
// for the scrape-and-seed loop, which knows exactly which products are new.
//
// Usage:
//   node scripts/indexnow-submit.mjs                    # full sitemap
//   echo "https://teno-store.com/product/<id>" | \
//     node scripts/indexnow-submit.mjs --stdin           # ad-hoc
//
// Env:
//   SITE_URL   default https://teno-store.com
//   KEY        default 81b0a3ff408a96ef5c0381a78aae7f58 (must match the .txt
//              file at /packages/web/public/<KEY>.txt)
//   DRY_RUN    set to 1 to print what would be sent without POSTing

import { readFileSync } from "node:fs";

const SITE = (process.env.SITE_URL ?? "https://teno-store.com").replace(/\/$/, "");
const KEY = process.env.KEY ?? "81b0a3ff408a96ef5c0381a78aae7f58";
const HOST = new URL(SITE).host;
const KEY_LOCATION = `${SITE}/${KEY}.txt`;
const ENDPOINT = "https://api.indexnow.org/indexnow";
const DRY_RUN = process.env.DRY_RUN === "1";
const STDIN_MODE = process.argv.includes("--stdin");

async function loadUrlsFromSitemap() {
  const res = await fetch(`${SITE}/sitemap.xml`);
  if (!res.ok) throw new Error(`sitemap fetch failed: ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

async function loadUrlsFromStdin() {
  const data = readFileSync(0, "utf8");
  return data.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

async function submitChunk(urls) {
  const body = JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList: urls });
  if (DRY_RUN) {
    console.log(`DRY_RUN: would POST ${urls.length} URLs to ${ENDPOINT}`);
    console.log(`first: ${urls[0]}`);
    console.log(`last:  ${urls[urls.length - 1]}`);
    return { ok: true, status: 0 };
  }
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body,
  });
  // 200/202 = accepted; 422 = invalid key/host; 429 = rate-limited.
  return { ok: res.ok || res.status === 202, status: res.status };
}

const urls = STDIN_MODE ? await loadUrlsFromStdin() : await loadUrlsFromSitemap();
if (urls.length === 0) {
  console.error("no URLs to submit");
  process.exit(2);
}

console.log(`indexnow: ${urls.length} URLs · host=${HOST} · key=${KEY.slice(0, 8)}…`);

// Bing's IndexNow endpoint returns 403 when a brand-new key submits 10k URLs
// in a single shot. Smaller chunks with a brief pacing delay avoid that and
// are well within the documented per-host rate limit (~10k/day).
const CHUNK = Number(process.env.CHUNK ?? 500);
const PAUSE_MS = Number(process.env.PAUSE_MS ?? 1000);
let ok = 0;
for (let i = 0; i < urls.length; i += CHUNK) {
  const slice = urls.slice(i, i + CHUNK);
  const r = await submitChunk(slice);
  console.log(`  chunk ${i / CHUNK + 1}: ${slice.length} URLs · status=${r.status}`);
  if (r.ok) ok += slice.length;
  if (i + CHUNK < urls.length) await new Promise((res) => setTimeout(res, PAUSE_MS));
}
console.log(`indexnow: ${ok}/${urls.length} accepted`);
