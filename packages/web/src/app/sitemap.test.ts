import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sitemap from "./sitemap";

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
    expect(urls.some((u) => u.endsWith("/"))).toBe(true);
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
    expect(urls.some((u) => u.endsWith("/"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/search"))).toBe(true);
    // No product URLs in fallback
    expect(urls.some((u) => u.includes("/product/"))).toBe(false);
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
    expect(urls.some((u) => u.endsWith("/"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/search"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/seller"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/about"))).toBe(true);
    expect(urls.length).toBe(4);
  });
});
