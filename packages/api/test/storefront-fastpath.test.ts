// Verifies the storefront fast path added 2026-05-12: a no-q + single
// sellerId search must call repo.idsBySeller and SKIP repo.loadAll. Before
// this shortcut the storefront for any seller (empty or not) forced a
// catalog-wide load on cold cache.

import { describe, expect, it, vi } from "vitest";
import { makeProductReader } from "../src/routes/products.js";
import type { StoredProduct, StoredSeller } from "../src/types/store-types.js";
import type { catalog } from "@marketplace/domain";

function makeSeller(id: string): StoredSeller {
  return {
    sellerId: id,
    displayName: "Test Shop",
    ownerAgentId: "agt_test",
    phones: [],
    countryCode: "DZ",
    createdAt: Date.now(),
  };
}

function makeProduct(id: string, sellerId: string): StoredProduct {
  return {
    productId: id,
    sellerId,
    titleSanitized: `Product ${id}`,
    attributes: {},
    variants: [{ id: `${id}-v`, sku: `sku-${id}`, priceMinor: 1000n, currency: "DZD", inStock: true }],
    media: [{ id: `${id}-m`, url: "default.jpg", contentType: "image/jpeg" }],
    counterfeitRisk: "low",
    createdAt: Date.now(),
  };
}

const noQSellerQuery: catalog.SearchQuery = {
  query: "",
  filters: { includeOutOfStock: false, sellerIds: ["00000000-0000-7000-8000-000000000001"] },
};

describe("storefront fast path (no q + single sellerId)", () => {
  it("uses idsBySeller and skips loadAll", async () => {
    const sellerId = "00000000-0000-7000-8000-000000000001";
    const sellers = new Map([[sellerId, makeSeller(sellerId)]]);
    const product = makeProduct("00000000-0000-7000-8000-000000000aaa", sellerId);

    const loadAll = vi.fn().mockResolvedValue({ products: [], sellers });
    const loadSellers = vi.fn().mockResolvedValue(sellers);
    const idsBySeller = vi.fn().mockResolvedValue([product.productId]);
    const getProductsByIds = vi.fn().mockResolvedValue([product]);

    const reader = makeProductReader({
      loadAll,
      loadSellers,
      idsBySeller,
      getProductsByIds,
      loadOne: vi.fn(),
    });
    const result = await reader.search(noQSellerQuery);

    expect(idsBySeller).toHaveBeenCalledWith(sellerId, expect.any(Number));
    expect(loadAll).not.toHaveBeenCalled();
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.productId).toBe(product.productId);
  });

  it("returns an empty result without hydrating when the seller has no products", async () => {
    const sellerId = "00000000-0000-7000-8000-000000000002";
    const sellers = new Map([[sellerId, makeSeller(sellerId)]]);

    const loadAll = vi.fn().mockResolvedValue({ products: [], sellers });
    const loadSellers = vi.fn().mockResolvedValue(sellers);
    const idsBySeller = vi.fn().mockResolvedValue([]);
    const getProductsByIds = vi.fn().mockResolvedValue([]);

    const reader = makeProductReader({
      loadAll,
      loadSellers,
      idsBySeller,
      getProductsByIds,
      loadOne: vi.fn(),
    });
    const result = await reader.search({
      ...noQSellerQuery,
      filters: { ...noQSellerQuery.filters, sellerIds: [sellerId] },
    });

    expect(idsBySeller).toHaveBeenCalledWith(sellerId, expect.any(Number));
    expect(getProductsByIds).not.toHaveBeenCalled();
    expect(loadAll).not.toHaveBeenCalled();
    expect(result.hits).toHaveLength(0);
  });

  it("falls back to loadAll for multi-seller filters (facet coverage still needs the full catalog)", async () => {
    const sellerA = "00000000-0000-7000-8000-000000000003";
    const sellerB = "00000000-0000-7000-8000-000000000004";
    const sellers = new Map([[sellerA, makeSeller(sellerA)], [sellerB, makeSeller(sellerB)]]);

    const loadAll = vi.fn().mockResolvedValue({ products: [], sellers });
    const loadSellers = vi.fn().mockResolvedValue(sellers);
    const idsBySeller = vi.fn();
    const getProductsByIds = vi.fn().mockResolvedValue([]);

    const reader = makeProductReader({
      loadAll,
      loadSellers,
      idsBySeller,
      getProductsByIds,
      loadOne: vi.fn(),
    });
    await reader.search({
      query: "",
      filters: { includeOutOfStock: false, sellerIds: [sellerA, sellerB] },
    });

    expect(idsBySeller).not.toHaveBeenCalled();
    expect(loadAll).toHaveBeenCalled();
  });

  it("falls back to loadAll when no sellerId filter is set (regular browse)", async () => {
    const sellers = new Map<string, StoredSeller>();
    const loadAll = vi.fn().mockResolvedValue({ products: [], sellers });
    const idsBySeller = vi.fn();
    const reader = makeProductReader({
      loadAll,
      loadSellers: vi.fn().mockResolvedValue(sellers),
      idsBySeller,
      getProductsByIds: vi.fn().mockResolvedValue([]),
      loadOne: vi.fn(),
    });
    await reader.search({ query: "", filters: { includeOutOfStock: false } });
    expect(idsBySeller).not.toHaveBeenCalled();
    expect(loadAll).toHaveBeenCalled();
  });

  it("does NOT enter the fast path when there is a text query (FTS path owns that)", async () => {
    const sellerId = "00000000-0000-7000-8000-000000000005";
    const sellers = new Map([[sellerId, makeSeller(sellerId)]]);
    const idsBySeller = vi.fn();
    const searchIds = vi.fn().mockResolvedValue([]);
    const reader = makeProductReader({
      loadAll: vi.fn().mockResolvedValue({ products: [], sellers }),
      loadSellers: vi.fn().mockResolvedValue(sellers),
      idsBySeller,
      searchIds,
      getProductsByIds: vi.fn().mockResolvedValue([]),
      loadOne: vi.fn(),
    });
    await reader.search({
      query: "iphone",
      filters: { includeOutOfStock: false, sellerIds: [sellerId] },
    });
    expect(idsBySeller).not.toHaveBeenCalled();
    expect(searchIds).toHaveBeenCalled();
  });
});
