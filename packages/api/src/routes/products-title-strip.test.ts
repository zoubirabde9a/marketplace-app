// Display-time cleanup for duplicate brand prefixes on scraped titles. The
// catalog stores the seller's original wording verbatim in title_sanitized;
// the strip only applies at projection time.

import { describe, expect, it } from "vitest";
import { stripDuplicateBrandPrefix } from "./products.js";

describe("stripDuplicateBrandPrefix", () => {
  it("removes a leading duplicated brand token, preserving the rest", () => {
    expect(stripDuplicateBrandPrefix("Honor Honor 400 pro 512GB", "Honor")).toBe("Honor 400 pro 512GB");
    expect(stripDuplicateBrandPrefix("VIVO VIVO Y19s 128GB", "VIVO")).toBe("VIVO Y19s 128GB");
  });

  it("is case-insensitive on both the brand and the title prefix", () => {
    expect(stripDuplicateBrandPrefix("HONOR HONOR 9X PRO", "Honor")).toBe("HONOR 9X PRO");
    expect(stripDuplicateBrandPrefix("Honor honor x10", "HONOR")).toBe("honor x10");
  });

  it("leaves single-brand titles alone", () => {
    expect(stripDuplicateBrandPrefix("Honor 400 pro", "Honor")).toBe("Honor 400 pro");
    expect(stripDuplicateBrandPrefix("Samsung Galaxy A36", "Samsung")).toBe("Samsung Galaxy A36");
  });

  it("does not eat a real word that just shares a prefix with the brand", () => {
    // "Hon" appears once at the start of "Honesty" but it's not the brand.
    expect(stripDuplicateBrandPrefix("Honor Honesty perfume", "Honor")).toBe("Honor Honesty perfume");
  });

  it("handles missing/empty brand gracefully", () => {
    expect(stripDuplicateBrandPrefix("Honor Honor 400 pro", undefined)).toBe("Honor Honor 400 pro");
    expect(stripDuplicateBrandPrefix("Honor Honor 400 pro", "")).toBe("Honor Honor 400 pro");
    expect(stripDuplicateBrandPrefix("Honor Honor 400 pro", "   ")).toBe("Honor Honor 400 pro");
  });

  it("escapes regex metacharacters in the brand", () => {
    // Hypothetical "A+B" brand: must not be interpreted as A or B repeated.
    expect(stripDuplicateBrandPrefix("A+B A+B widget", "A+B")).toBe("A+B widget");
  });
});
