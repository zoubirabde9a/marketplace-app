#!/usr/bin/env node
// Stress test the public search UI. Runs N concurrent workers, each firing
// search requests as fast as it gets a response. Reports per-query latency
// percentiles and error counts.

const BASE = process.env.BASE_URL || 'https://teno-store.com';
const CONCURRENCY = Number(process.env.CONCURRENCY || 10);
const DURATION_S = Number(process.env.DURATION_S || 30);
const QUERIES = [
  'iphone', 'samsung', 'xiaomi', 'redmi', 'huawei',
  'oppo', 'realme', 'pixel', 'nokia', 'oneplus',
  'galaxy', 'note', 'pro', 'max', 'ultra',
];

const results = [];
let errors = 0;
let stop = false;

async function worker(id) {
  while (!stop) {
    const q = QUERIES[Math.floor(Math.random() * QUERIES.length)];
    const url = `${BASE}/search?q=${encodeURIComponent(q)}`;
    const t0 = performance.now();
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'stress-search/1.0' } });
      await res.arrayBuffer();
      const ms = performance.now() - t0;
      results.push({ q, ms, status: res.status });
      if (!res.ok) errors++;
    } catch (e) {
      errors++;
      results.push({ q, ms: performance.now() - t0, status: 0, err: e.message });
    }
  }
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p / 100))];
}

console.log(`stress: ${CONCURRENCY} workers x ${DURATION_S}s against ${BASE}/search`);
const start = Date.now();
const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i));
setTimeout(() => { stop = true; }, DURATION_S * 1000);
await Promise.all(workers);
const elapsed = (Date.now() - start) / 1000;

const ms = results.map(r => r.ms);
const ok = results.filter(r => r.status === 200).length;
console.log(`\nresults: ${results.length} reqs in ${elapsed.toFixed(1)}s = ${(results.length / elapsed).toFixed(1)} req/s`);
console.log(`status:  200=${ok}  errors=${errors}`);
console.log(`latency: min=${Math.min(...ms).toFixed(0)}ms  p50=${pct(ms, 50).toFixed(0)}ms  p90=${pct(ms, 90).toFixed(0)}ms  p99=${pct(ms, 99).toFixed(0)}ms  max=${Math.max(...ms).toFixed(0)}ms`);

const byQ = {};
for (const r of results) {
  (byQ[r.q] ||= []).push(r.ms);
}
console.log('\nper-query p50 / p90 / max:');
for (const [q, arr] of Object.entries(byQ)) {
  console.log(`  ${q.padEnd(10)} n=${String(arr.length).padStart(3)}  p50=${pct(arr, 50).toFixed(0)}ms  p90=${pct(arr, 90).toFixed(0)}ms  max=${Math.max(...arr).toFixed(0)}ms`);
}
