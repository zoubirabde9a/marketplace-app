import { describe, expect, it } from "vitest";
import { computeFacets } from "./facets.js";
import type { FilterContext } from "./filter.js";
import type { StoredProduct, StoredSeller } from "../types/store-types.js";

const ctx = (filters: FilterContext["filters"] = { includeOutOfStock: false }): FilterContext => ({
  q: "",
  filters,
  fuzzy: false,
});

function p(overrides: Partial<StoredProduct>): StoredProduct {
  return {
    productId: "p-" + Math.random().toString(36).slice(2, 10),
    sellerId: "s-1",
    titleSanitized: "Test",
    attributes: {},
    variants: [{ id: "v", sku: "sku", priceMinor: 1000n, currency: "DZD", inStock: true }],
    media: [],
    counterfeitRisk: "low",
    createdAt: 1,
    ...overrides,
  };
}

const sellers = new Map<string, StoredSeller>([
  ["s-1", { sellerId: "s-1", displayName: "Shop One", ownerAgentId: "a", phones: [], createdAt: 1 }],
  ["s-2", { sellerId: "s-2", displayName: "Shop Two", ownerAgentId: "a", phones: [], createdAt: 1 }],
]);

describe("computeFacets", () => {
  it("counts brands, currencies, sellers, categories across all rows that pass the other filters", () => {
    const all = [
      p({ brand: "Samsung", sellerId: "s-1", categoryIds: ["telephones"] }),
      p({ brand: "Samsung", sellerId: "s-1", categoryIds: ["telephones"] }),
      p({ brand: "Apple", sellerId: "s-2", categoryIds: ["telephones", "smartphones"] }),
    ];
    const f = computeFacets(all, ctx(), sellers);
    expect(f.brands).toEqual(
      expect.arrayContaining([
        { value: "Samsung", count: 2 },
        { value: "Apple", count: 1 },
      ]),
    );
    expect(f.sellers).toEqual(
      expect.arrayContaining([
        { sellerId: "s-1", displayName: "Shop One", count: 2 },
        { sellerId: "s-2", displayName: "Shop Two", count: 1 },
      ]),
    );
    expect(f.categories).toEqual(
      expect.arrayContaining([
        { value: "telephones", count: 3 },
        { value: "smartphones", count: 1 },
      ]),
    );
  });

  it("drops the brand filter when computing the brand facet (drill-aware)", () => {
    // The contract: facets show 'alternatives I could pivot to', so the
    // brand facet's count should ignore the active brand filter and report
    // every brand in the otherwise-matching set.
    const all = [
      p({ brand: "Samsung", sellerId: "s-1" }),
      p({ brand: "Apple", sellerId: "s-1" }),
    ];
    const f = computeFacets(all, ctx({ includeOutOfStock: false, brand: "Samsung" }), sellers);
    const brands = f.brands.map((b) => b.value).sort();
    expect(brands).toEqual(["Apple", "Samsung"]);
  });

  it("counts each currency once per product (multi-currency variants don't double-count)", () => {
    const all = [
      p({
        variants: [
          { id: "v1", sku: "a", priceMinor: 100n, currency: "DZD", inStock: true },
          { id: "v2", sku: "b", priceMinor: 200n, currency: "DZD", inStock: true },
          { id: "v3", sku: "c", priceMinor: 1n, currency: "EUR", inStock: true },
        ],
      }),
    ];
    const f = computeFacets(all, ctx(), sellers);
    expect(f.currencies).toEqual(
      expect.arrayContaining([
        { value: "DZD", count: 1 },
        { value: "EUR", count: 1 },
      ]),
    );
  });

  it("produces price-range min/max per currency across all variants", () => {
    const all = [
      p({ variants: [{ id: "v1", sku: "a", priceMinor: 1500n, currency: "DZD", inStock: true }] }),
      p({ variants: [{ id: "v2", sku: "b", priceMinor: 9999n, currency: "DZD", inStock: true }] }),
      p({ variants: [{ id: "v3", sku: "c", priceMinor: 100n, currency: "USD", inStock: true }] }),
    ];
    const f = computeFacets(all, ctx(), sellers);
    const dzd = f.priceRanges.find((r) => r.currency === "DZD");
    const usd = f.priceRanges.find((r) => r.currency === "USD");
    expect(dzd).toEqual({ currency: "DZD", minMinor: 1500n, maxMinor: 9999n });
    expect(usd).toEqual({ currency: "USD", minMinor: 100n, maxMinor: 100n });
  });

  it("filters price-range to the active currency only", () => {
    const all = [
      p({ variants: [{ id: "v1", sku: "a", priceMinor: 1500n, currency: "DZD", inStock: true }] }),
      p({ variants: [{ id: "v2", sku: "c", priceMinor: 100n, currency: "USD", inStock: true }] }),
    ];
    const f = computeFacets(all, ctx({ includeOutOfStock: false, currency: "DZD" }), sellers);
    expect(f.priceRanges).toEqual([{ currency: "DZD", minMinor: 1500n, maxMinor: 1500n }]);
  });

  it("omits displayName when the seller isn't in the sellers map", () => {
    const all = [p({ sellerId: "s-ghost", brand: "Acme" })];
    const f = computeFacets(all, ctx(), sellers);
    const entry = f.sellers.find((s) => s.sellerId === "s-ghost");
    expect(entry).toBeDefined();
    expect((entry as { displayName?: string }).displayName).toBeUndefined();
  });
});
