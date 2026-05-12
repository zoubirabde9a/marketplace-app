import { describe, expect, it } from "vitest";
import { passes, type FilterContext } from "./filter.js";
import type { StoredProduct } from "../types/store-types.js";

function makeProduct(overrides: Partial<StoredProduct> = {}): StoredProduct {
  return {
    productId: "p1",
    sellerId: "s1",
    titleSanitized: "Test product",
    attributes: {},
    variants: [
      { id: "v1", sku: "sku-1", priceMinor: 1000n, currency: "DZD", inStock: true },
    ],
    media: [],
    counterfeitRisk: "low",
    createdAt: Date.now(),
    ...overrides,
  };
}

const baseCtx: FilterContext = {
  q: "",
  filters: { includeOutOfStock: false },
  fuzzy: false,
};

describe("filter.passes — zero-price exclusion", () => {
  it("hides a product whose only variant is priceMinor=0", () => {
    const p = makeProduct({
      variants: [{ id: "v1", sku: "sku-1", priceMinor: 0n, currency: "DZD", inStock: true }],
    });
    expect(passes(p, baseCtx)).toBe(false);
  });

  it("hides a product when every viable variant is priceMinor=0", () => {
    const p = makeProduct({
      variants: [
        { id: "v1", sku: "sku-1", priceMinor: 0n, currency: "DZD", inStock: true },
        { id: "v2", sku: "sku-2", priceMinor: 0n, currency: "DZD", inStock: true },
      ],
    });
    expect(passes(p, baseCtx)).toBe(false);
  });

  it("keeps a product when at least one variant has a real price", () => {
    const p = makeProduct({
      variants: [
        { id: "v1", sku: "sku-1", priceMinor: 0n, currency: "DZD", inStock: true },
        { id: "v2", sku: "sku-2", priceMinor: 2500n, currency: "DZD", inStock: true },
      ],
    });
    expect(passes(p, baseCtx)).toBe(true);
  });

  it("keeps a normally-priced product (regression guard)", () => {
    expect(passes(makeProduct(), baseCtx)).toBe(true);
  });
});
