import { describe, expect, it } from "vitest";
import { ascending, cmpDirection, keyOf, makeComparator, parseCursorKey } from "./sort.js";
import type { FilterContext } from "./filter.js";
import type { StoredProduct } from "../types/store-types.js";

const baseCtx: FilterContext = { q: "", filters: { includeOutOfStock: false }, fuzzy: false };

function product(overrides: Partial<StoredProduct> = {}): StoredProduct {
  return {
    productId: "00000000-0000-7000-8000-000000000001",
    sellerId: "s",
    titleSanitized: "Sample",
    attributes: {},
    variants: [{ id: "v", sku: "sku", priceMinor: 1000n, currency: "DZD", inStock: true }],
    media: [{ id: "m-default", url: "default.jpg", contentType: "image/jpeg" }],
    counterfeitRisk: "low",
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("sort key extraction", () => {
  it("price_asc / price_desc emits a BigInt key from the display variant", () => {
    const p = product({ variants: [{ id: "v", sku: "x", priceMinor: 35_000_00n, currency: "DZD", inStock: true }] });
    expect(keyOf(p, "price_asc", baseCtx)).toEqual({ v: 35_000_00n, isBig: true });
    expect(keyOf(p, "price_desc", baseCtx)).toEqual({ v: 35_000_00n, isBig: true });
  });

  it("price_asc sinks below-floor junk-price listings to the bottom", () => {
    // Ouedkniss-style "1 DA" placeholder — 100 minor units = 1.00 DZD. Real
    // products at this price are essentially never the catalog reality.
    const junk = product({
      productId: "00000000-0000-7000-8000-000000000099",
      variants: [{ id: "vj", sku: "sj", priceMinor: 100n, currency: "DZD", inStock: true }],
    });
    const real = product({
      productId: "00000000-0000-7000-8000-000000000100",
      variants: [{ id: "vr", sku: "sr", priceMinor: 35_000_00n, currency: "DZD", inStock: true }],
    });
    const cmp = makeComparator("price_asc", baseCtx);
    expect(cmp(junk, real)).toBeGreaterThan(0); // junk sorts after real
    expect(cmp(real, junk)).toBeLessThan(0);
    // price_desc is unchanged — junk is naturally at the bottom there.
    const cmpDesc = makeComparator("price_desc", baseCtx);
    expect(cmpDesc(real, junk)).toBeLessThan(0);
  });

  it("newest prefers attributes.sourcePostedAt over createdAt", () => {
    const p = product({
      createdAt: 1,
      attributes: { sourcePostedAt: "2026-05-12T00:00:00Z" },
    });
    const k = keyOf(p, "newest", baseCtx);
    expect(k.isBig).toBe(false);
    expect(k.v).toBe(Date.parse("2026-05-12T00:00:00Z"));
  });

  it("newest falls back to createdAt when sourcePostedAt is missing or unparseable", () => {
    const p = product({ createdAt: 1_700_000_000_000 });
    expect(keyOf(p, "newest", baseCtx)).toEqual({ v: 1_700_000_000_000, isBig: false });
    const p2 = product({ createdAt: 42, attributes: { sourcePostedAt: "not-a-date" } });
    expect(keyOf(p2, "newest", baseCtx)).toEqual({ v: 42, isBig: false });
  });

  it("rating uses p.rating (0 fallback) as a numeric key", () => {
    expect(keyOf(product({ rating: 4.5 }), "rating", baseCtx)).toEqual({ v: 4.5, isBig: false });
    expect(keyOf(product({}), "rating", baseCtx)).toEqual({ v: 0, isBig: false });
  });

  it("relevance with an empty query returns 0", () => {
    expect(keyOf(product(), "relevance", baseCtx)).toEqual({ v: 0, isBig: false });
  });

  it("relevance scores title-substring matches above brand-substring matches", () => {
    const ctx = { ...baseCtx, q: "samsung" };
    const titleHit = product({ titleSanitized: "samsung a31", brand: "Acme" });
    const brandHit = product({ titleSanitized: "Acme", brand: "Samsung" });
    const titleKey = keyOf(titleHit, "relevance", ctx);
    const brandKey = keyOf(brandHit, "relevance", ctx);
    expect(titleKey.v).toBeGreaterThan(Number(brandKey.v));
  });

  it("relevance nudges image-bearing hits ahead of zero-image ties", () => {
    const ctx = { ...baseCtx, q: "samsung" };
    const noImg = product({ titleSanitized: "samsung a31", media: [], productId: "p-1" });
    const withImg = product({
      titleSanitized: "samsung a31",
      media: [{ id: "m1", url: "x.jpg", contentType: "image/jpeg" }],
      productId: "p-2",
    });
    const a = keyOf(noImg, "relevance", ctx);
    const b = keyOf(withImg, "relevance", ctx);
    expect(b.v).toBeGreaterThan(Number(a.v));
  });
});

describe("ascending", () => {
  it("price_asc is the only ascending sort", () => {
    expect(ascending("price_asc")).toBe(true);
    for (const s of ["price_desc", "newest", "rating", "relevance"] as const) {
      expect(ascending(s)).toBe(false);
    }
  });
});

describe("cmpDirection", () => {
  it("flips the comparator sign for descending sorts (so higher keys come first)", () => {
    const lo = { v: 100n, isBig: true } as const;
    const hi = { v: 200n, isBig: true } as const;
    expect(cmpDirection(lo, hi, "price_asc")).toBeLessThan(0);
    expect(cmpDirection(lo, hi, "price_desc")).toBeGreaterThan(0);
  });
});

describe("makeComparator", () => {
  it("ties break by productId ascending (cursor-stability invariant)", () => {
    const cmp = makeComparator("rating", baseCtx);
    const a = product({ rating: 4, productId: "00000000-0000-7000-8000-aaaaaaaaaaaa" });
    const b = product({ rating: 4, productId: "00000000-0000-7000-8000-bbbbbbbbbbbb" });
    expect(cmp(a, b)).toBeLessThan(0);
    expect(cmp(b, a)).toBeGreaterThan(0);
    expect(cmp(a, a)).toBe(0);
  });
});

describe("parseCursorKey", () => {
  it("parses BigInt for price sorts and number for everything else", () => {
    expect(parseCursorKey("9999999999", "price_asc")).toEqual({ v: 9999999999n, isBig: true });
    expect(parseCursorKey("9999999999", "price_desc")).toEqual({ v: 9999999999n, isBig: true });
    expect(parseCursorKey("1700000000000", "newest")).toEqual({ v: 1700000000000, isBig: false });
    expect(parseCursorKey("4.5", "rating")).toEqual({ v: 4.5, isBig: false });
    expect(parseCursorKey("12", "relevance")).toEqual({ v: 12, isBig: false });
  });
});
