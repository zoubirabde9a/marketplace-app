import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetSearchCacheForTests, searchProductsCached } from "./searchCache";
import * as api from "./api";

// Inject a fake search response by mocking the underlying `searchProducts`.
// Keeps the test free of fetch / Next / cookie scaffolding.
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return { ...actual, searchProducts: vi.fn() };
});

function fakeResponse(overrides: Partial<api.SearchResponse> = {}): api.SearchResponse {
  return {
    data: [],
    pagination: { cursor: null, totalEstimate: 0 },
    facets: { brands: [], currencies: [], sellers: [], categories: [], priceRanges: [] },
    ...overrides,
  };
}

beforeEach(() => {
  __resetSearchCacheForTests();
  vi.clearAllMocks();
});

describe("searchProductsCached", () => {
  it("caches the underlying searchProducts result (single fetch for back-to-back calls)", async () => {
    vi.mocked(api.searchProducts).mockResolvedValue(fakeResponse({ pagination: { cursor: null, totalEstimate: 12 } }));
    const a = await searchProductsCached({ q: "iphone" });
    const b = await searchProductsCached({ q: "iphone" });
    expect(a).toEqual(b);
    expect(api.searchProducts).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent in-flight callers onto a single fetch", async () => {
    vi.mocked(api.searchProducts).mockResolvedValue(fakeResponse({ pagination: { cursor: null, totalEstimate: 5 } }));
    const [a, b, c] = await Promise.all([
      searchProductsCached({ q: "samsung" }),
      searchProductsCached({ q: "samsung" }),
      searchProductsCached({ q: "samsung" }),
    ]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(api.searchProducts).toHaveBeenCalledTimes(1);
  });

  it("refuses to cache an obviously-broken empty response", async () => {
    vi.mocked(api.searchProducts).mockResolvedValue(fakeResponse());
    await searchProductsCached({ q: "rarething" });
    await searchProductsCached({ q: "rarething" });
    // Both calls had to re-fetch because the cache rejected the empty result.
    expect(api.searchProducts).toHaveBeenCalledTimes(2);
  });

  it("caches a 'zero hits but totalEstimate>0' response (genuine zero-shown-page result)", async () => {
    vi.mocked(api.searchProducts).mockResolvedValue(fakeResponse({ pagination: { cursor: null, totalEstimate: 42 } }));
    await searchProductsCached({ q: "x" });
    await searchProductsCached({ q: "x" });
    expect(api.searchProducts).toHaveBeenCalledTimes(1);
  });

  it("treats arrays in sellerId/category as order-insensitive for cache keys", async () => {
    vi.mocked(api.searchProducts).mockResolvedValue(fakeResponse({ pagination: { cursor: null, totalEstimate: 3 } }));
    await searchProductsCached({ sellerId: ["a", "b"] });
    await searchProductsCached({ sellerId: ["b", "a"] });
    expect(api.searchProducts).toHaveBeenCalledTimes(1);
  });
});
