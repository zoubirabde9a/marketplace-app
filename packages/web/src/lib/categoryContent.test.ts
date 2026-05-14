import { describe, expect, it } from "vitest";
import { FR_CATEGORY } from "./categories";
import { getCategoryContent, hasCategoryContent } from "./categoryContent";

describe("categoryContent", () => {
  it("returns curated content for the head-volume Ouedkniss categories", () => {
    for (const slug of [
      "telephones",
      "informatique",
      "electronique_electromenager",
      "vetements_mode",
      "automobiles_vehicules",
      "sante_beaute",
    ]) {
      expect(hasCategoryContent(slug)).toBe(true);
      const c = getCategoryContent(slug);
      expect(c.intro.length).toBeGreaterThanOrEqual(2);
      // ≥2 FAQ entries — some categories (e.g. vetements_mode) ship 2, others 3-4.
      expect(c.faq.length).toBeGreaterThanOrEqual(2);
      expect(c.related.length).toBeGreaterThan(0);
    }
  });

  it("falls back to a templated entry for slugs not in the curated map", () => {
    expect(hasCategoryContent("does_not_exist_in_catalog")).toBe(false);
    const c = getCategoryContent("does_not_exist_in_catalog");
    // Templated intro still has at least 2 paragraphs so the page isn't
    // empty — Google quality signals reject empty landing pages.
    expect(c.intro.length).toBeGreaterThanOrEqual(2);
    expect(c.faq.length).toBeGreaterThanOrEqual(2);
  });

  it("every slug in FR_CATEGORY resolves to non-empty content (curated or templated)", () => {
    for (const slug of Object.keys(FR_CATEGORY)) {
      const c = getCategoryContent(slug);
      expect(c.intro.length, `intro for "${slug}"`).toBeGreaterThan(0);
      expect(c.faq.length, `faq for "${slug}"`).toBeGreaterThan(0);
      // Intro paragraphs should be substantive — refuse 1-word placeholders
      // that would render as thin content.
      for (const para of c.intro) {
        expect(para.length, `intro paragraph in "${slug}"`).toBeGreaterThan(50);
      }
    }
  });

  it("FAQ entries never have empty question or answer fields", () => {
    for (const slug of Object.keys(FR_CATEGORY)) {
      const c = getCategoryContent(slug);
      for (const f of c.faq) {
        expect(f.q.trim().length, `q in "${slug}"`).toBeGreaterThan(0);
        expect(f.a.trim().length, `a in "${slug}"`).toBeGreaterThan(0);
      }
    }
  });

  it("related-category references all point at slugs in FR_CATEGORY", () => {
    // Catches typos: a related: ["telephone"] (no s) would render a chip
    // linking to a non-existent /c/telephone landing.
    const known = new Set(Object.keys(FR_CATEGORY));
    for (const slug of Object.keys(FR_CATEGORY)) {
      const c = getCategoryContent(slug);
      for (const r of c.related) {
        expect(
          known.has(r),
          `Category "${slug}" lists related slug "${r}" not in FR_CATEGORY`,
        ).toBe(true);
      }
    }
  });

  it("is case-insensitive on the slug input", () => {
    const lower = getCategoryContent("telephones");
    const upper = getCategoryContent("TELEPHONES");
    const mixed = getCategoryContent("Telephones");
    expect(lower.intro).toEqual(upper.intro);
    expect(lower.intro).toEqual(mixed.intro);
  });
});
