import { describe, expect, it } from "vitest";
import { editDistance, fuzzyMatch } from "./fuzzy.js";

describe("editDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(editDistance("", "")).toBe(0);
    expect(editDistance("abc", "abc")).toBe(0);
  });

  it("returns the length when one side is empty", () => {
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("abc", "")).toBe(3);
  });

  it("counts single substitutions / insertions / deletions", () => {
    expect(editDistance("widget", "widgit")).toBe(1); // substitute
    expect(editDistance("widget", "widgets")).toBe(1); // insert
    expect(editDistance("widgets", "widget")).toBe(1); // delete
  });

  it("handles longer-distance edits", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
  });
});

describe("fuzzyMatch", () => {
  it("returns 0 for empty query or empty text", () => {
    expect(fuzzyMatch("", "anything")).toBe(0);
    expect(fuzzyMatch("query", "")).toBe(0);
  });

  it("scores a clean substring hit at full token count", () => {
    expect(fuzzyMatch("samsung", "Samsung Galaxy S22")).toBe(1);
    expect(fuzzyMatch("galaxy s22", "Samsung Galaxy S22")).toBe(2);
  });

  it("tolerates a single-char typo on a short token (≤6 chars, tolerance=1)", () => {
    expect(fuzzyMatch("widgit", "Acme Widget")).toBeGreaterThan(0); // 1 sub
    expect(fuzzyMatch("phon", "phone")).toBeGreaterThan(0); // 1 insert
  });

  it("tolerates two-char edits on longer tokens (>6 chars)", () => {
    expect(fuzzyMatch("samsng", "Samsung Galaxy")).toBeGreaterThan(0);
  });

  it("returns 0 when any query token has no within-tolerance match", () => {
    expect(fuzzyMatch("samsung zzzzzzz", "Samsung Galaxy")).toBe(0);
  });

  it("is case-insensitive (lowercased internally)", () => {
    expect(fuzzyMatch("SAMSUNG", "samsung galaxy")).toBe(1);
    expect(fuzzyMatch("Galaxy", "SAMSUNG GALAXY")).toBe(1);
  });

  it("tokenises on non-alphanumeric so punctuation between words doesn't block matches", () => {
    expect(fuzzyMatch("iphone 13", "iPhone-13 (256GB)")).toBe(2);
  });

  it("supports Unicode letter tokens (French diacritics)", () => {
    expect(fuzzyMatch("électroménager", "Catégorie Électroménager")).toBe(1);
  });
});
