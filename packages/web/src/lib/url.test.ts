import { describe, expect, it } from "vitest";
import { parseSearchParams, toggleArrayParam, withParam } from "./url";

describe("parseSearchParams", () => {
  it("returns an empty object for empty input", () => {
    expect(parseSearchParams({})).toEqual({});
  });

  it("extracts the text query", () => {
    expect(parseSearchParams({ q: "phone" })).toEqual({ q: "phone" });
  });

  it("treats category and sellerId as multi-valued", () => {
    expect(parseSearchParams({ category: ["a", "b"] })).toEqual({ category: ["a", "b"] });
    expect(parseSearchParams({ sellerId: "abc" })).toEqual({ sellerId: ["abc"] });
  });

  it("coerces numeric params (minRating, limit) to numbers", () => {
    const r = parseSearchParams({ minRating: "4", limit: "20" });
    expect(r.minRating).toBe(4);
    expect(r.limit).toBe(20);
  });

  it("recognizes 'true' as the only truthy boolean for includeOutOfStock and fuzzy", () => {
    expect(parseSearchParams({ includeOutOfStock: "true", fuzzy: "true" })).toMatchObject({
      includeOutOfStock: true,
      fuzzy: true,
    });
    // Anything other than the literal string 'true' must NOT enable the flag.
    expect(parseSearchParams({ includeOutOfStock: "1" }).includeOutOfStock).toBeUndefined();
    expect(parseSearchParams({ fuzzy: "yes" }).fuzzy).toBeUndefined();
  });

  it("collects attr.* params into the attributes record without the prefix", () => {
    const r = parseSearchParams({ "attr.color": "blue", "attr.size": "L", q: "shirt" });
    expect(r.attributes).toEqual({ color: "blue", size: "L" });
    expect(r.q).toBe("shirt");
  });

  it("ignores empty/blank values rather than passing them through", () => {
    const r = parseSearchParams({ q: "", brand: "" });
    expect(r.q).toBeUndefined();
    expect(r.brand).toBeUndefined();
  });

  it("passes the sort param through unchanged", () => {
    expect(parseSearchParams({ sort: "price_asc" }).sort).toBe("price_asc");
  });
});

describe("withParam", () => {
  it("sets a new key", () => {
    const p = withParam({}, "q", "phone");
    expect(p.toString()).toBe("q=phone");
  });

  it("replaces an existing key while preserving others", () => {
    const p = withParam({ q: "old", brand: "Acme" }, "q", "new");
    const flat = Object.fromEntries(p);
    expect(flat).toEqual({ q: "new", brand: "Acme" });
  });

  it("removes the key when value is undefined or empty", () => {
    expect(withParam({ q: "phone", brand: "Acme" }, "q", undefined).toString()).toBe("brand=Acme");
    expect(withParam({ q: "phone", brand: "Acme" }, "q", "").toString()).toBe("brand=Acme");
  });

  it("preserves multi-valued params on other keys", () => {
    const p = withParam({ category: ["a", "b"], q: "x" }, "q", "y");
    const cats = p.getAll("category");
    expect(cats).toEqual(["a", "b"]);
    expect(p.get("q")).toBe("y");
  });
});

describe("toggleArrayParam", () => {
  it("appends the value when not present", () => {
    const p = toggleArrayParam({}, "category", "a");
    expect(p.getAll("category")).toEqual(["a"]);
  });

  it("removes the value when already present (case-sensitive)", () => {
    const p = toggleArrayParam({ category: ["a", "b"] }, "category", "a");
    expect(p.getAll("category")).toEqual(["b"]);
  });

  it("preserves other params untouched", () => {
    const p = toggleArrayParam({ category: ["a"], q: "phone" }, "category", "b");
    expect(p.getAll("category")).toEqual(["a", "b"]);
    expect(p.get("q")).toBe("phone");
  });
});
