import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INDEXNOW_CHUNK_SIZE,
  INDEXNOW_HOST,
  INDEXNOW_KEY,
  INDEXNOW_KEY_LOCATION,
  submitToIndexNow,
} from "./indexnow";

describe("submitToIndexNow", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns ok with status 0 for empty input without calling fetch", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const res = await submitToIndexNow([]);
    expect(res).toEqual({ ok: true, status: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the correct body shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const urls = ["https://teno-store.com/a", "https://teno-store.com/b"];
    const res = await submitToIndexNow(urls);

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.indexnow.org/IndexNow");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toMatch(/application\/json/);
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      host: INDEXNOW_HOST,
      key: INDEXNOW_KEY,
      keyLocation: INDEXNOW_KEY_LOCATION,
      urlList: urls,
    });
  });

  it("treats HTTP 202 as success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const res = await submitToIndexNow(["https://teno-store.com/x"]);
    expect(res).toEqual({ ok: true, status: 202 });
  });

  it("reports ok=false on non-2xx but does not throw", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 422 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const res = await submitToIndexNow(["https://teno-store.com/x"]);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(422);
  });

  it("swallows fetch rejections", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const res = await submitToIndexNow(["https://teno-store.com/x"]);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
  });

  it("chunks payloads larger than 10,000 URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const total = INDEXNOW_CHUNK_SIZE * 2 + 7;
    const urls = Array.from({ length: total }, (_, i) => `https://teno-store.com/p/${i}`);
    const res = await submitToIndexNow(urls);

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sizes = fetchMock.mock.calls.map((c) => {
      const init = c[1] as RequestInit;
      return JSON.parse(init.body as string).urlList.length;
    });
    expect(sizes).toEqual([INDEXNOW_CHUNK_SIZE, INDEXNOW_CHUNK_SIZE, 7]);
  });

  it("aggregates ok=false if any chunk fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const urls = Array.from({ length: INDEXNOW_CHUNK_SIZE + 1 }, (_, i) => `https://teno-store.com/p/${i}`);
    const res = await submitToIndexNow(urls);
    expect(res.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
