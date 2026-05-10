// Unit tests for the search synonym layer. expandForWebsearch produces the
// input string for websearch_to_tsquery, OR-joining the cartesian product of
// synonym variants per token. These tests pin the contract so we can keep
// adding entries to SEARCH_SYNONYMS without accidentally regressing the
// expansion shape.

import { describe, expect, it } from "vitest";
import { SEARCH_SYNONYMS, expandForWebsearch } from "../src/synonyms.js";

describe("expandForWebsearch", () => {
  it("returns the original query when no token has a synonym", () => {
    expect(expandForWebsearch("iphone 256gb")).toBe("iphone 256gb");
    expect(expandForWebsearch("samsung galaxy s24")).toBe("samsung galaxy s24");
    expect(expandForWebsearch("xyzzy")).toBe("xyzzy");
  });

  it("expands a single-token synonym", () => {
    // SEARCH_SYNONYMS.frigo === ["refrigerateur"]
    expect(expandForWebsearch("frigo")).toBe("frigo OR refrigerateur");
  });

  it("expands a single token with multiple synonyms", () => {
    // SEARCH_SYNONYMS.pc === ["ordinateur", "laptop"]
    const out = expandForWebsearch("pc");
    expect(out.split(" OR ").sort()).toEqual(["laptop", "ordinateur", "pc"].sort());
  });

  it("expands one expandable token in a multi-token query (cartesian per token)", () => {
    // "frigo blanc" → "frigo blanc" + "refrigerateur blanc"
    const out = expandForWebsearch("frigo blanc");
    expect(out.split(" OR ").sort()).toEqual(["frigo blanc", "refrigerateur blanc"].sort());
  });

  it("expands two expandable tokens via cartesian product", () => {
    // "tlf voiture" — tlf has 1 syn (telephone), voiture has 1 syn (auto)
    // expected variants: tlf voiture, telephone voiture, tlf auto, telephone auto
    const out = expandForWebsearch("tlf voiture");
    const variants = out.split(" OR ").sort();
    expect(variants).toEqual(
      ["tlf voiture", "telephone voiture", "tlf auto", "telephone auto"].sort(),
    );
  });

  it("is case-insensitive on the input but emits lowercased phrases", () => {
    // Synonyms are keyed lowercased; uppercase inputs still hit them.
    expect(expandForWebsearch("FRIGO")).toBe("frigo OR refrigerateur");
    expect(expandForWebsearch("Frigo")).toBe("frigo OR refrigerateur");
  });

  it("collapses whitespace runs and trims edges", () => {
    expect(expandForWebsearch("  frigo   ")).toBe("frigo OR refrigerateur");
    expect(expandForWebsearch("frigo  blanc")).toBe(
      expandForWebsearch("frigo blanc"),
    );
  });

  it("returns the input unchanged for empty / whitespace-only queries", () => {
    expect(expandForWebsearch("")).toBe("");
    expect(expandForWebsearch("   ")).toBe("   ");
  });

  it("dedupes identical phrases produced by overlapping cartesian expansions", () => {
    // Hand-built map where two tokens both have the same synonym — without
    // dedup we'd emit duplicate phrases. The cap (16) plus the Set in
    // expandForWebsearch should keep it clean.
    const syns = { a: ["x"], b: ["x"] };
    const out = expandForWebsearch("a b", syns);
    const variants = out.split(" OR ");
    expect(new Set(variants).size).toBe(variants.length);
  });

  it("caps phrase explosion at 16 variants for pathological inputs", () => {
    // 5 tokens, each with 5 synonyms → 6^5 = 7776 phrases without the cap.
    const big: Record<string, string[]> = {};
    for (let i = 0; i < 5; i++) {
      big[`t${i}`] = [`s${i}a`, `s${i}b`, `s${i}c`, `s${i}d`, `s${i}e`];
    }
    const out = expandForWebsearch("t0 t1 t2 t3 t4", big);
    expect(out.split(" OR ").length).toBeLessThanOrEqual(16);
  });

  it("preserves token order in each phrase variant", () => {
    // "voiture casque" — both have synonyms. Tokens 0 and 1 must stay in their
    // positions in every phrase; we should never see "casque voiture" by
    // accident.
    const out = expandForWebsearch("voiture casque");
    for (const phrase of out.split(" OR ")) {
      const [t0, t1] = phrase.split(" ");
      expect(SEARCH_SYNONYMS.voiture?.includes(t0!) || t0 === "voiture").toBe(true);
      expect(SEARCH_SYNONYMS.casque?.includes(t1!) || t1 === "casque").toBe(true);
    }
  });

  it("contains expected bidirectional pairs (sanity check on the seed map)", () => {
    // Bidirectional pairs are how we keep results consistent regardless of
    // which form the user types. If someone removes one direction, this test
    // fires before they ship a half-deployed asymmetric synonym.
    const pairs: Array<[string, string]> = [
      ["frigo", "refrigerateur"],
      ["tlf", "telephone"],
      ["voiture", "auto"],
      ["casque", "ecouteurs"],
    ];
    for (const [a, b] of pairs) {
      expect(SEARCH_SYNONYMS[a]).toContain(b);
      expect(SEARCH_SYNONYMS[b]).toContain(a);
    }
  });
});
