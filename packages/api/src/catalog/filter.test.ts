import { describe, expect, it } from "vitest";
import { displayVariant, passes, relevanceScoreFor, type FilterContext } from "./filter.js";
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
    media: [{ id: "m-default", url: "default.jpg", contentType: "image/jpeg" }],
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

describe("displayVariant — buyer-honest price selection", () => {
  it("prefers an in-stock variant over a cheaper out-of-stock one", () => {
    const p = makeProduct({
      variants: [
        { id: "v_oos", sku: "oos", priceMinor: 1000n, currency: "DZD", inStock: false },
        { id: "v_in",  sku: "in",  priceMinor: 1500n, currency: "DZD", inStock: true },
      ],
    });
    expect(displayVariant(p, baseCtx)?.id).toBe("v_in");
  });

  it("prefers a non-zero-priced variant over a zero-priced one", () => {
    // The scraper occasionally yields placeholder variants priced at 0;
    // surfacing "From $0" on browse is a UX trap. The cheaper-by-bigint
    // rule alone would pick the $0 row.
    const p = makeProduct({
      variants: [
        { id: "v_zero", sku: "zero", priceMinor: 0n, currency: "DZD", inStock: true },
        { id: "v_real", sku: "real", priceMinor: 2500n, currency: "DZD", inStock: true },
      ],
    });
    expect(displayVariant(p, baseCtx)?.id).toBe("v_real");
  });

  it("falls back to cheapest by price when stock and zero-tier are equal", () => {
    const p = makeProduct({
      variants: [
        { id: "v_hi", sku: "hi", priceMinor: 3000n, currency: "DZD", inStock: true },
        { id: "v_lo", sku: "lo", priceMinor: 1500n, currency: "DZD", inStock: true },
      ],
    });
    expect(displayVariant(p, baseCtx)?.id).toBe("v_lo");
  });
});

describe("relevanceScoreFor — projected hit ranking signal", () => {
  it("returns 1 when there is no query (every product equally relevant)", () => {
    expect(relevanceScoreFor(makeProduct(), baseCtx)).toBe(1);
  });

  it("scores title substring hits higher than description-only hits", () => {
    const titleHit = makeProduct({ titleSanitized: "Samsung Galaxy S22" });
    const descOnly = makeProduct({
      titleSanitized: "Phone",
      descriptionSanitized: "Compatible with Samsung",
    });
    const ctx: FilterContext = { ...baseCtx, q: "samsung" };
    expect(relevanceScoreFor(titleHit, ctx)).toBeGreaterThan(
      relevanceScoreFor(descOnly, ctx),
    );
  });

  it("uses textScores map when provided", () => {
    const p = makeProduct({ productId: "p_x" });
    const ctx: FilterContext = {
      ...baseCtx,
      q: "anything",
      textScores: new Map([["p_x", 7.42]]),
    };
    expect(relevanceScoreFor(p, ctx)).toBe(7.42);
  });

  it("ranks fuzzy multi-token matches by token count when substring path is missed", () => {
    const p = makeProduct({ titleSanitized: "Acme Wireless Earbuds" });
    // Use typo'd queries so the title-substring branch is skipped on both,
    // forcing the fuzzy branch where the new "1 + tokens" signal applies.
    const fuzzyOne: FilterContext = { ...baseCtx, q: "earbudz", fuzzy: true };
    const fuzzyTwo: FilterContext = { ...baseCtx, q: "wirless earbudz", fuzzy: true };
    expect(relevanceScoreFor(p, fuzzyTwo)).toBeGreaterThan(relevanceScoreFor(p, fuzzyOne));
    // Direct title substring on a non-typo'd query beats a 1-token fuzzy match.
    const cleanShort: FilterContext = { ...baseCtx, q: "earbuds", fuzzy: true };
    expect(relevanceScoreFor(p, cleanShort)).toBeGreaterThan(relevanceScoreFor(p, fuzzyOne));
  });
});

describe("filter.passes — other filter dimensions", () => {
  it("filters by brand (case-insensitive)", () => {
    const p = makeProduct({ brand: "Samsung" });
    expect(passes(p, { ...baseCtx, filters: { includeOutOfStock: false, brand: "samsung" } })).toBe(true);
    expect(passes(p, { ...baseCtx, filters: { includeOutOfStock: false, brand: "apple" } })).toBe(false);
  });

  it("filters by sellerId membership", () => {
    const p = makeProduct({ sellerId: "s-1" });
    expect(
      passes(p, { ...baseCtx, filters: { includeOutOfStock: false, sellerIds: ["s-1", "s-2"] } }),
    ).toBe(true);
    expect(
      passes(p, { ...baseCtx, filters: { includeOutOfStock: false, sellerIds: ["s-9"] } }),
    ).toBe(false);
  });

  it("filters by category (any-of)", () => {
    const p = makeProduct({ categoryIds: ["telephones", "smartphones"] });
    expect(
      passes(p, { ...baseCtx, filters: { includeOutOfStock: false, categoryIds: ["smartphones"] } }),
    ).toBe(true);
    expect(
      passes(p, { ...baseCtx, filters: { includeOutOfStock: false, categoryIds: ["maison"] } }),
    ).toBe(false);
  });

  it("filters by attribute (case-insensitive equality)", () => {
    const p = makeProduct({ attributes: { size: "M", color: "Bordeaux" } });
    expect(
      passes(p, { ...baseCtx, filters: { includeOutOfStock: false, attributes: { color: "bordeaux" } } }),
    ).toBe(true);
    expect(
      passes(p, { ...baseCtx, filters: { includeOutOfStock: false, attributes: { color: "noir" } } }),
    ).toBe(false);
  });

  it("filters by minRating", () => {
    const four = makeProduct({ rating: 4 });
    const three = makeProduct({ rating: 3 });
    const ctx = { ...baseCtx, filters: { includeOutOfStock: false, minRating: 4 } };
    expect(passes(four, ctx)).toBe(true);
    expect(passes(three, ctx)).toBe(false);
  });

  it("filters by shipsTo membership", () => {
    const p = makeProduct({ shipsTo: ["DZ", "FR"] });
    expect(passes(p, { ...baseCtx, filters: { includeOutOfStock: false, shipsTo: "DZ" } })).toBe(true);
    expect(passes(p, { ...baseCtx, filters: { includeOutOfStock: false, shipsTo: "US" } })).toBe(false);
  });

  it("filters by price range (priceMinMinor / priceMaxMinor)", () => {
    const p = makeProduct({ variants: [{ id: "v", sku: "x", priceMinor: 1500n, currency: "DZD", inStock: true }] });
    expect(
      passes(p, { ...baseCtx, filters: { includeOutOfStock: false, priceMinMinor: 1000n, priceMaxMinor: 2000n } }),
    ).toBe(true);
    expect(
      passes(p, { ...baseCtx, filters: { includeOutOfStock: false, priceMinMinor: 2000n } }),
    ).toBe(false);
    expect(
      passes(p, { ...baseCtx, filters: { includeOutOfStock: false, priceMaxMinor: 1000n } }),
    ).toBe(false);
  });

  it("hides out-of-stock products unless `includeOutOfStock` is set", () => {
    const oos = makeProduct({
      variants: [{ id: "v", sku: "x", priceMinor: 1000n, currency: "DZD", inStock: false }],
    });
    expect(passes(oos, baseCtx)).toBe(false);
    expect(passes(oos, { ...baseCtx, filters: { includeOutOfStock: true } })).toBe(true);
  });

  it("matches free-text query against title / brand / description / attributes", () => {
    const p = makeProduct({
      titleSanitized: "Robe traditionnelle Karakou",
      brand: "Mode & Style",
      descriptionSanitized: "Brodée main",
      attributes: { wilaya: "Constantine" },
    });
    for (const q of ["karakou", "brodée", "mode", "constantine"]) {
      expect(passes(p, { ...baseCtx, q })).toBe(true);
    }
    expect(passes(p, { ...baseCtx, q: "nothing-like-that" })).toBe(false);
  });

  it("respects currency-active scoping for the in-stock requirement", () => {
    // When `currency=EUR` is active, only the EUR variant counts; the DZD-only
    // in-stock variant doesn't keep the product visible.
    const p = makeProduct({
      variants: [
        { id: "v1", sku: "x", priceMinor: 1000n, currency: "DZD", inStock: true },
        { id: "v2", sku: "y", priceMinor: 10n, currency: "EUR", inStock: false },
      ],
    });
    expect(passes(p, { ...baseCtx, filters: { includeOutOfStock: false, currency: "EUR" } })).toBe(false);
    expect(passes(p, { ...baseCtx, filters: { includeOutOfStock: false, currency: "DZD" } })).toBe(true);
  });

  it("skip dimension: lifts a filter when computing that dimension's facet", () => {
    const p = makeProduct({ brand: "Apple" });
    const ctx = { ...baseCtx, filters: { includeOutOfStock: false, brand: "Samsung" } };
    // With brand filter active, Apple fails.
    expect(passes(p, ctx)).toBe(false);
    // When we're computing the brand facet, skip="brand" lifts the brand filter.
    expect(passes(p, ctx, "brand")).toBe(true);
  });
});
