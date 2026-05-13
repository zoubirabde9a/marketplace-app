// IndexNow protocol client (https://www.indexnow.org).
//
// Pushes URL changes to Bing + Yandex (and downstream: Yahoo, DuckDuckGo,
// Ecosia, Seznam, Naver) within minutes. Google does not participate.
//
// Ownership of the host is verified by serving the key string at
// https://<host>/<key>.txt — see packages/web/public/<KEY>.txt.

const KEY = "81b0a3ff408a96ef5c0381a78aae7f58";
const HOST = "teno-store.com";
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const ENDPOINT = "https://api.indexnow.org/IndexNow";

// IndexNow accepts up to 10,000 URLs per request.
export const INDEXNOW_CHUNK_SIZE = 10_000;

export const INDEXNOW_KEY = KEY;
export const INDEXNOW_HOST = HOST;
export const INDEXNOW_KEY_LOCATION = KEY_LOCATION;

export type IndexNowResult = { ok: boolean; status: number };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Submit a batch of URLs to IndexNow. Chunks automatically at 10,000 URLs.
 * Never throws — failures are logged and surfaced via the returned `ok` flag.
 * Returns the worst (lowest-ok) status seen across chunks.
 */
export async function submitToIndexNow(urls: string[]): Promise<IndexNowResult> {
  if (!urls || urls.length === 0) {
    return { ok: true, status: 0 };
  }

  const batches = chunk(urls, INDEXNOW_CHUNK_SIZE);
  let aggregateOk = true;
  let lastStatus = 0;

  for (const batch of batches) {
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
      // 200 = accepted, 202 = accepted-pending-validation. Both are success.
      const ok = res.ok || res.status === 202;
      lastStatus = res.status;
      if (!ok) {
        aggregateOk = false;
        console.error(`[indexnow] chunk failed: status=${res.status} size=${batch.length}`);
      }
    } catch (err) {
      aggregateOk = false;
      lastStatus = 0;
      console.error(`[indexnow] chunk threw: ${(err as Error).message ?? err}`);
    }
  }

  return { ok: aggregateOk, status: lastStatus };
}
