import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetSitemapCacheForTests,
  buildCategoryEntries,
  buildProductShard,
  buildStaticEntries,
  getSitemapHarvest,
  productShardCount,
  renderSitemapIndex,
  renderUrlset,
  URLS_PER_PRODUCT_SHARD,
} from "./sitemap";

const okResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

describe("sitemap lib", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    __resetSitemapCacheForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("harvest paginates with cursor and emits brand / seller / category entries above the count floor", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: [{ productId: "p1" }, { productId: "p2" }],
        pagination: { cursor: null },
        facets: {
          brands: [
            { value: "Apple", count: 10 },
            { value: "ThinBrand", count: 3 },
          ],
          sellers: [
            { sellerId: "s-1", count: 7 },
            { sellerId: "s-2", count: 2 },
          ],
          categories: [{ value: "telephones", count: 50 }],
        },
      }),
    );
    const harvest = await getSitemapHarvest();
    expect(harvest.products.map((p) => p.productId)).toEqual(["p1", "p2"]);
    expect(harvest.brands).toContain("Apple");
    expect(harvest.brands).not.toContain("ThinBrand");
    expect(harvest.sellerIds).toContain("s-1");
    expect(harvest.sellerIds).not.toContain("s-2");
    expect(harvest.categories).toContain("telephones");

    const categoryXml = renderUrlset(buildCategoryEntries(harvest, new Date()));
    expect(categoryXml).toContain("/search?brand=Apple");
    expect(categoryXml).toContain("/store/s-1");
    expect(categoryXml).toContain("/c/telephones");
  });

  it("static entries include the home and key landing pages", () => {
    const entries = buildStaticEntries(new Date());
    const locs = entries.map((e) => e.loc);
    expect(locs.some((u) => /https?:\/\/[^/]+$/.test(u))).toBe(true);
    expect(locs.some((u) => u.endsWith("/search"))).toBe(true);
    expect(locs.some((u) => u.endsWith("/blog"))).toBe(true);
  });

  it("product shards slice the harvest by URLS_PER_PRODUCT_SHARD and shard count rounds up", () => {
    const harvest = {
      products: Array.from({ length: URLS_PER_PRODUCT_SHARD + 5 }, (_, i) => ({
        productId: `p${i}`,
        lastModified: new Date(),
      })),
      brands: [],
      sellerIds: [],
      categories: [],
    };
    expect(productShardCount(harvest)).toBe(2);
    const first = buildProductShard(harvest, 0, new Date());
    const second = buildProductShard(harvest, 1, new Date());
    expect(first).toHaveLength(URLS_PER_PRODUCT_SHARD);
    expect(second).toHaveLength(5);
  });

  it("index links to static + categories + every product shard", () => {
    const xml = renderSitemapIndex([
      { loc: "https://example.test/sitemap-static.xml", lastmod: "2026-05-17T00:00:00.000Z" },
      { loc: "https://example.test/sitemap-categories.xml", lastmod: "2026-05-17T00:00:00.000Z" },
      { loc: "https://example.test/sitemap-products-1.xml", lastmod: "2026-05-17T00:00:00.000Z" },
    ]);
    expect(xml).toContain("<sitemapindex");
    expect(xml).toContain("sitemap-static.xml");
    expect(xml).toContain("sitemap-products-1.xml");
  });
});
