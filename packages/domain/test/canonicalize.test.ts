import { describe, expect, it } from "vitest";
import {
  attributesContradict,
  gtin14,
  isValidGtin,
  jaroWinkler,
  matchListing,
} from "../src/catalog/canonicalize.js";

describe("isValidGtin", () => {
  it("accepts a known-good UPC", () => {
    expect(isValidGtin("036000291452")).toBe(true);
  });

  it("rejects a bad check digit", () => {
    expect(isValidGtin("036000291453")).toBe(false);
  });

  it("rejects non-digit input", () => {
    expect(isValidGtin("abc")).toBe(false);
  });

  it("normalizes to GTIN-14", () => {
    expect(gtin14("036000291452")).toBe("00036000291452");
    expect(gtin14("bad")).toBeUndefined();
  });
});

describe("jaroWinkler", () => {
  it("returns 1.0 on identical strings", () => {
    expect(jaroWinkler("Sony WH-1000XM5", "Sony WH-1000XM5")).toBeCloseTo(1, 5);
  });

  it("scores near-duplicates highly", () => {
    expect(jaroWinkler("Sony WH-1000XM5 Headphones", "Sony WH-1000XM5 Wireless")).toBeGreaterThan(0.85);
  });

  it("scores unrelated text low", () => {
    expect(jaroWinkler("USB-C cable 6ft", "garden hose 50ft")).toBeLessThan(0.7);
  });
});

describe("attributesContradict", () => {
  it("flags conflicting key attributes", () => {
    expect(attributesContradict({ size: "M" }, { size: "L" })).toContain("size");
  });

  it("ignores absent attributes", () => {
    expect(attributesContradict({ size: "M" }, {})).toEqual([]);
  });
});

describe("matchListing", () => {
  const candidates = [
    { canonicalId: "c1", brand: "Sony", gtin14: "00036000291452", title: "Sony WH-1000XM5", attributes: {} },
    { canonicalId: "c2", brand: "Sony", title: "Sony WH-1000XM5 Wireless Headphones", attributes: { color: "black" } },
  ];

  it("matches via GTIN exact", async () => {
    const r = await matchListing(
      { id: "L1", brand: "Sony", gtin14: "00036000291452", title: "x", attributes: {} },
      candidates,
    );
    expect(r?.confidence).toBe("exact");
    expect(r?.method).toBe("gtin");
  });

  it("falls back to fuzzy title within brand", async () => {
    const r = await matchListing(
      { id: "L2", brand: "Sony", title: "Sony WH-1000XM5 Wireless Headphone", attributes: {} },
      candidates,
    );
    expect(r?.confidence).toBe("high");
    expect(r?.method).toBe("fuzzy_title");
  });

  it("returns null when nothing matches", async () => {
    const r = await matchListing(
      { id: "L3", brand: "Bose", title: "QuietComfort 45", attributes: {} },
      candidates,
    );
    expect(r).toBeNull();
  });

  it("escalates to embedding fallback when fuzzy fails", async () => {
    const r = await matchListing(
      { id: "L4", brand: "Sony", title: "completely different text", attributes: {} },
      candidates,
      {
        fuzzyTitleThreshold: 0.92,
        embeddingThreshold: 0.85,
        embeddingResolver: async () => [{ canonicalId: "c2", cosine: 0.9 }],
      },
    );
    expect(r?.confidence).toBe("medium");
    expect(r?.method).toBe("embedding");
  });

  it("rejects fuzzy match with contradicting attributes", async () => {
    const r = await matchListing(
      { id: "L5", brand: "Sony", title: "Sony WH-1000XM5 Wireless Headphones", attributes: { color: "white" } },
      candidates,
    );
    expect(r).toBeNull();
  });
});
