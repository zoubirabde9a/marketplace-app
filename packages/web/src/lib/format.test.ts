import { describe, expect, it } from "vitest";
import {
  cleanProductTitle,
  formatPrice,
  formatPriceRange,
  formatRating,
  formatRelativeTime,
  minorToMajor,
} from "./format";

describe("minorToMajor", () => {
  it("divides by 100 for two-decimal currencies", () => {
    expect(minorToMajor("1999", "USD")).toBe(19.99);
    expect(minorToMajor("28000000", "DZD")).toBe(280_000);
  });

  it("does not divide for zero-decimal currencies", () => {
    expect(minorToMajor("1999", "JPY")).toBe(1999);
    expect(minorToMajor("500", "KRW")).toBe(500);
  });

  it("returns null for null/undefined and unparseable input", () => {
    expect(minorToMajor(null, "USD")).toBeNull();
    expect(minorToMajor(undefined, "USD")).toBeNull();
    expect(minorToMajor("not-a-number", "USD")).toBeNull();
  });

  it("accepts bigint and number inputs", () => {
    expect(minorToMajor(1999n, "USD")).toBe(19.99);
    expect(minorToMajor(1999, "USD")).toBe(19.99);
  });
});

describe("formatPrice", () => {
  it("returns em-dash for null/missing inputs", () => {
    expect(formatPrice(null, "USD")).toBe("—");
    expect(formatPrice("100", null)).toBe("—");
    expect(formatPrice(undefined, "USD")).toBe("—");
  });

  it("formats whole-number USD without trailing zeros", () => {
    // Pass explicit en-US locale — these tests assert en-US-specific
    // formatting ($, dot decimals). Default locale was changed to fr-DZ
    // to match the rest of the French-Algeria-primary site.
    expect(formatPrice("1000", "USD", "en-US")).toMatch(/^\$10$|^US\$10$/);
  });

  it("formats fractional USD with two decimals", () => {
    expect(formatPrice("1999", "USD", "en-US")).toMatch(/19\.99/);
  });

  it("formats DZD without decimals (large round numbers)", () => {
    // Intl outputs DZD with currency-code formatting; assert the major-unit
    // value appears in the result.
    const out = formatPrice("28000000", "DZD");
    expect(out).toMatch(/280[\s,.]?000/);
  });
});

describe("formatPriceRange", () => {
  it("returns single price when from === to", () => {
    expect(formatPriceRange("1999", "1999", "USD", "en-US")).toMatch(/19\.99/);
  });

  it("returns a range when from !== to", () => {
    const out = formatPriceRange("1000", "2000", "USD", "en-US");
    expect(out).toContain("–");
  });

  it("falls back to single side when one is missing", () => {
    expect(formatPriceRange("1000", null, "USD", "en-US")).toMatch(/10/);
    expect(formatPriceRange(null, "2000", "USD", "en-US")).toMatch(/20/);
  });
});

describe("formatRelativeTime", () => {
  const fixedNow = new Date("2026-05-09T12:00:00Z");

  it("returns null for missing or invalid input", () => {
    expect(formatRelativeTime(null, fixedNow)).toBeNull();
    expect(formatRelativeTime(undefined, fixedNow)).toBeNull();
    expect(formatRelativeTime("not-a-date", fixedNow)).toBeNull();
  });

  it("returns 'à l’instant' for sub-minute and future timestamps", () => {
    const future = new Date(fixedNow.getTime() + 60_000).toISOString();
    expect(formatRelativeTime(future, fixedNow)).toBe("à l’instant");
    const recent = new Date(fixedNow.getTime() - 30_000).toISOString();
    expect(formatRelativeTime(recent, fixedNow)).toBe("à l’instant");
  });

  it("scales to minutes, hours, days, weeks, months, years (French)", () => {
    const t = (offsetMs: number) => new Date(fixedNow.getTime() - offsetMs).toISOString();
    expect(formatRelativeTime(t(2 * 60_000), fixedNow)).toBe("il y a 2 minutes");
    expect(formatRelativeTime(t(60_000), fixedNow)).toBe("il y a 1 minute");
    expect(formatRelativeTime(t(3 * 3_600_000), fixedNow)).toBe("il y a 3 heures");
    expect(formatRelativeTime(t(2 * 86_400_000), fixedNow)).toBe("il y a 2 jours");
    expect(formatRelativeTime(t(2 * 7 * 86_400_000), fixedNow)).toBe("il y a 2 semaines");
    expect(formatRelativeTime(t(60 * 86_400_000), fixedNow)).toBe("il y a 2 mois");
    expect(formatRelativeTime(t(2 * 365 * 86_400_000), fixedNow)).toBe("il y a 2 ans");
  });
});

describe("formatRating", () => {
  it("returns 'Pas encore d’avis' when rating is null/undefined", () => {
    expect(formatRating(null)).toBe("Pas encore d’avis");
    expect(formatRating(undefined)).toBe("Pas encore d’avis");
  });

  it("renders rating with one decimal and optional count", () => {
    expect(formatRating(4)).toBe("4.0 ★");
    expect(formatRating(4.567, 1234)).toBe("4.6 ★ (1,234)");
  });
});

describe("cleanProductTitle", () => {
  it("drops a duplicated leading word", () => {
    expect(cleanProductTitle("Samsung Samsung a31")).toBe("Samsung a31");
    expect(cleanProductTitle("Iphone11 Iphone11")).toBe("Iphone11");
    expect(cleanProductTitle("Karakou Karakou")).toBe("Karakou");
  });

  it("is case-insensitive", () => {
    expect(cleanProductTitle("Samsung samsung galaxy")).toBe("samsung galaxy");
    expect(cleanProductTitle("KARAKOU karakou")).toBe("karakou");
  });

  it("leaves legitimate titles untouched", () => {
    expect(cleanProductTitle("Samsung Galaxy S22")).toBe("Samsung Galaxy S22");
    expect(cleanProductTitle("iPhone 13 Pro Max")).toBe("iPhone 13 Pro Max");
    expect(cleanProductTitle("Robe traditionnelle Karakou brodée main")).toBe(
      "Robe traditionnelle Karakou brodée main",
    );
  });

  it("handles single-word, empty, and whitespace inputs without throwing", () => {
    expect(cleanProductTitle("")).toBe("");
    expect(cleanProductTitle("   ")).toBe("");
    expect(cleanProductTitle("Samsung")).toBe("Samsung");
  });

  it("collapses leading whitespace after the trim", () => {
    expect(cleanProductTitle("  Samsung Samsung a31")).toBe("Samsung a31");
  });
});
