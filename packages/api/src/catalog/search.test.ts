import { describe, expect, it } from "vitest";
import { searchProducts } from "./search.js";
import type { StoredProduct, StoredSeller } from "../types/store-types.js";
import type { catalog } from "@marketplace/domain";

// Builds a complete SearchQuery from a partial overlay so each test case can
// just declare the fields it cares about. SearchQuery requires sort, limit
// and embeddingsMode at the type level; this helper keeps the tests focused
// on filter/cursor/facet behavior without spelling out the defaults each call.
function q(over: Partial<catalog.SearchQuery>): catalog.SearchQuery {
  return {
    query: "",
    sort: "relevance",
    limit: 25,
    embeddingsMode: "off",
    ...over,
  };
}

function p(overrides: Partial<StoredProduct>): StoredProduct {
  return {
    productId: overrides.productId ?? "00000000-0000-7000-8000-000000000001",
    sellerId: "s",
    titleSanitized: "Sample",
    attributes: {},
    variants: [{ id: "v", sku: "sku", priceMinor: 1000n, currency: "DZD", inStock: true }],
    media: [],
    counterfeitRisk: "low",
    createdAt: 1,
    ...overrides,
  };
}

const sellers = new Map<string, StoredSeller>([
  ["s", { sellerId: "s", displayName: "Shop", ownerAgentId: "a", phones: [], createdAt: 1 }],
]);

describe("searchProducts orchestrator", () => {
  it("returns no hits + zero total when the catalog is empty", () => {
    const r = searchProducts([], sellers, q({ filters: { includeOutOfStock: false } }));
    expect(r.hits).toHaveLength(0);
    expect(r.totalEstimate).toBe(0);
    expect(r.cursor).toBeUndefined();
  });

  it("paginates: limit caps the page; a stable cursor is emitted when more remain", () => {
    const all = Array.from({ length: 5 }, (_, i) =>
      p({ productId: `00000000-0000-7000-8000-00000000000${i + 1}`, createdAt: 5 - i, attributes: { sourcePostedAt: `2026-01-0${i + 1}T00:00:00Z` } }),
    );
    const r = searchProducts(all, sellers, q({
      filters: { includeOutOfStock: false },
      sort: "newest",
      limit: 2,
    }));
    expect(r.hits).toHaveLength(2);
    expect(r.totalEstimate).toBe(5);
    expect(r.cursor).toBeDefined();
  });

  it("does not emit a cursor when the page covers the remaining items", () => {
    const all = Array.from({ length: 3 }, (_, i) =>
      p({ productId: `00000000-0000-7000-8000-00000000000${i + 1}` }),
    );
    const r = searchProducts(all, sellers, q({
      filters: { includeOutOfStock: false },
      sort: "newest",
      limit: 10,
    }));
    expect(r.hits).toHaveLength(3);
    expect(r.cursor).toBeUndefined();
  });

  it("filters before sorting (in-stock false products excluded by default)", () => {
    const all = [
      p({ productId: "00000000-0000-7000-8000-aaaaaaaaaaa1", variants: [{ id: "v", sku: "a", priceMinor: 1n, currency: "DZD", inStock: false }] }),
      p({ productId: "00000000-0000-7000-8000-aaaaaaaaaaa2" }),
    ];
    const r = searchProducts(all, sellers, q({ filters: { includeOutOfStock: false } }));
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.productId).toBe("00000000-0000-7000-8000-aaaaaaaaaaa2");
  });

  it("computes facets across the full input set (not just the page)", () => {
    const all = [
      p({ productId: "00000000-0000-7000-8000-aaaaaaaaaaa1", brand: "Samsung" }),
      p({ productId: "00000000-0000-7000-8000-aaaaaaaaaaa2", brand: "Apple" }),
      p({ productId: "00000000-0000-7000-8000-aaaaaaaaaaa3", brand: "Samsung" }),
    ];
    const r = searchProducts(all, sellers, q({ filters: { includeOutOfStock: false }, limit: 1 }));
    expect(r.hits).toHaveLength(1);
    expect(r.facets.brands).toEqual(
      expect.arrayContaining([
        { value: "Samsung", count: 2 },
        { value: "Apple", count: 1 },
      ]),
    );
  });

  it("resuming with a cursor returns the next page (no overlap with first page)", () => {
    const all = Array.from({ length: 4 }, (_, i) =>
      p({
        productId: `00000000-0000-7000-8000-aaaaaaaaaaa${i + 1}`,
        attributes: { sourcePostedAt: `2026-01-0${4 - i}T00:00:00Z` },
      }),
    );
    const first = searchProducts(all, sellers, q({ filters: { includeOutOfStock: false }, sort: "newest", limit: 2 }));
    expect(first.cursor).toBeDefined();
    const second = searchProducts(all, sellers, q({ filters: { includeOutOfStock: false }, sort: "newest", limit: 2, cursor: first.cursor }));
    expect(second.hits).toHaveLength(2);
    const firstIds = new Set(first.hits.map((h) => h.productId));
    for (const h of second.hits) expect(firstIds.has(h.productId)).toBe(false);
  });
});
