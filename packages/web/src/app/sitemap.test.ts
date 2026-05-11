import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sitemap, { __resetSitemapCacheForTests } from "./sitemap";

const okResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

describe("sitemap()", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // Module-level harvest cache (added to dodge a Next 15 ISR
    // misbehaviour — see sitemap.ts) persists across tests; clear it.
    __resetSitemapCacheForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes the static / and /search entries plus per-product entries", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: [{ productId: "abc" }, { productId: "def" }],
        pagination: { cursor: null },
      }),
    );

    const entries = await sitemap();
    const urls = entries.map((e) => e.url);
    // Home URL is bare SITE_URL (no trailing slash) — see sitemap.ts.
    expect(urls.some((u) => /https?:\/\/[^/]+$/.test(u))).toBe(true);
    expect(urls.some((u) => u.endsWith("/search"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/product/abc"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/product/def"))).toBe(true);
  });

  it("paginates with cursor and stops when cursor goes null", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse({ data: [{ productId: "a" }], pagination: { cursor: "c1" } }))
      .mockResolvedValueOnce(okResponse({ data: [{ productId: "b" }], pagination: { cursor: null } }));

    const entries = await sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls.some((u) => u.endsWith("/product/a"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/product/b"))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondInit] = fetchMock.mock.calls[1]!;
    expect(secondInit).toBeDefined();
    expect(String(fetchMock.mock.calls[1]![0])).toContain("cursor=c1");
  });

  it("falls back to static-only entries when fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const entries = await sitemap();
    expect(entries.length).toBeGreaterThanOrEqual(2);
    const urls = entries.map((e) => e.url);
    // Home URL is bare SITE_URL (no trailing slash) — see sitemap.ts.
    expect(urls.some((u) => /https?:\/\/[^/]+$/.test(u))).toBe(true);
    expect(urls.some((u) => u.endsWith("/search"))).toBe(true);
    // No product URLs in fallback
    expect(urls.some((u) => u.includes("/product/"))).toBe(false);
  });

  it("emits one sitemap entry per active brand and per active seller (above min-count floor)", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: [{ productId: "p1" }],
        pagination: { cursor: null },
        facets: {
          brands: [
            { value: "Apple", count: 10 },          // above floor
            { value: "Samsung", count: 5 },         // at floor (>=)
            { value: "ThinBrand", count: 3 },       // below floor — dropped
            { value: "Ghost", count: 0 },           // below floor — dropped
          ],
          sellers: [
            { sellerId: "s-1", displayName: "Smart Phone DZ", count: 7 },  // above floor
            { sellerId: "s-2", displayName: "TechStore", count: 2 },       // below floor — dropped
          ],
        },
      }),
    );

    const entries = await sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls.some((u) => u.endsWith("/search?brand=Apple"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/search?brand=Samsung"))).toBe(true);
    // Below MIN_FACET_COUNT = scrape-source noise, not indexable as own
    // landing (these were tagged as "brands" but are really one-off seller
    // strings, mis-categorised values, etc.).
    expect(urls.some((u) => u.includes("brand=ThinBrand"))).toBe(false);
    expect(urls.some((u) => u.includes("brand=Ghost"))).toBe(false);
    expect(urls.some((u) => u.endsWith("/search?sellerId=s-1"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/search?sellerId=s-2"))).toBe(false);
  });

  it("falls back to static entries when the API responds non-OK", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Server Error",
      json: async () => ({}),
      text: async () => "",
    } as unknown as Response);

    const entries = await sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls.some((u) => u.includes("/product/"))).toBe(false);
    // Home URL is bare SITE_URL (no trailing slash) — see sitemap.ts.
    expect(urls.some((u) => /https?:\/\/[^/]+$/.test(u))).toBe(true);
    expect(urls.some((u) => u.endsWith("/search"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/seller"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/about"))).toBe(true);
    expect(urls.length).toBe(4);
  });
});
