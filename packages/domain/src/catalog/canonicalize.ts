// SKU canonicalization pipeline per spec §8.2: GTIN/MPN exact → fuzzy title → embedding.

import type { ConfidenceTierT } from "./types.js";

export interface Listing {
  id: string;
  brand?: string;
  gtin14?: string;
  mpn?: string;
  title: string;
  attributes: Record<string, unknown>;
}

export interface Candidate {
  canonicalId: string;
  brand?: string;
  gtin14?: string;
  mpn?: string;
  title: string;
  attributes: Record<string, unknown>;
}

export interface MatchResult {
  canonicalId: string;
  confidence: ConfidenceTierT;
  method: "gtin" | "mpn" | "fuzzy_title" | "embedding";
  similarity: number;
  conflicts: string[];
}

export interface MatchOptions {
  fuzzyTitleThreshold: number; // default 0.92 Jaro-Winkler
  embeddingThreshold: number; // default 0.85 cosine
  embeddingResolver?: (
    query: { title: string; brand?: string },
    candidates: Candidate[],
  ) => Promise<Array<{ canonicalId: string; cosine: number }>>;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  fuzzyTitleThreshold: 0.92,
  embeddingThreshold: 0.85,
};

/** GS1 check-digit validation for GTIN-8/12/13/14. */
export function isValidGtin(raw: string): boolean {
  const digits = raw.trim();
  if (!/^\d{8}|\d{12}|\d{13}|\d{14}$/.test(digits)) return false;
  const arr = digits.split("").map((d) => Number(d));
  const check = arr.pop()!;
  let sum = 0;
  // GS1 weights: rightmost data digit gets ×3, alternate.
  for (let i = arr.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += arr[i]! * weight;
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === check;
}

export function gtin14(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!isValidGtin(trimmed)) return undefined;
  return trimmed.padStart(14, "0");
}

/** Jaro-Winkler similarity on lowercased ASCII-folded text. */
export function jaroWinkler(a: string, b: string): number {
  const s1 = normalizeForFuzzy(a);
  const s2 = normalizeForFuzzy(b);
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);
  const s1Matches = new Array<boolean>(s1.length).fill(false);
  const s2Matches = new Array<boolean>(s2.length).fill(false);
  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  transpositions /= 2;
  const m = matches;
  const jaro = (m / s1.length + m / s2.length + (m - transpositions) / m) / 3;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

function normalizeForFuzzy(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const KEY_ATTRS = new Set(["size", "color", "capacity", "model", "region", "voltage"]);

export function attributesContradict(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const conflicts: string[] = [];
  for (const key of KEY_ATTRS) {
    const av = a[key];
    const bv = b[key];
    if (av !== undefined && bv !== undefined && String(av).toLowerCase() !== String(bv).toLowerCase()) {
      conflicts.push(key);
    }
  }
  return conflicts;
}

export async function matchListing(
  listing: Listing,
  candidates: Candidate[],
  opts: MatchOptions = DEFAULT_MATCH_OPTIONS,
): Promise<MatchResult | null> {
  // 1. GTIN exact + brand
  if (listing.gtin14) {
    const norm = gtin14(listing.gtin14);
    const exact = candidates.find(
      (c) => c.gtin14 && gtin14(c.gtin14) === norm && eqBrand(c.brand, listing.brand),
    );
    if (exact) {
      const conflicts = attributesContradict(listing.attributes, exact.attributes);
      return { canonicalId: exact.canonicalId, confidence: "exact", method: "gtin", similarity: 1, conflicts };
    }
  }

  // 2. MPN + brand
  if (listing.mpn) {
    const exact = candidates.find(
      (c) =>
        c.mpn &&
        c.mpn.toLowerCase() === listing.mpn!.toLowerCase() &&
        eqBrand(c.brand, listing.brand),
    );
    if (exact) {
      const conflicts = attributesContradict(listing.attributes, exact.attributes);
      return { canonicalId: exact.canonicalId, confidence: "exact", method: "mpn", similarity: 1, conflicts };
    }
  }

  // 3. Brand-locked fuzzy title
  let bestFuzzy: { c: Candidate; sim: number } | undefined;
  for (const c of candidates) {
    if (!eqBrand(c.brand, listing.brand)) continue;
    const sim = jaroWinkler(listing.title, c.title);
    if (sim >= opts.fuzzyTitleThreshold && (!bestFuzzy || sim > bestFuzzy.sim)) {
      bestFuzzy = { c, sim };
    }
  }
  if (bestFuzzy) {
    const conflicts = attributesContradict(listing.attributes, bestFuzzy.c.attributes);
    if (conflicts.length === 0) {
      return {
        canonicalId: bestFuzzy.c.canonicalId,
        confidence: "high",
        method: "fuzzy_title",
        similarity: bestFuzzy.sim,
        conflicts,
      };
    }
  }

  // 4. Embedding fallback
  if (opts.embeddingResolver) {
    const ranked = await opts.embeddingResolver(
      { title: listing.title, ...(listing.brand !== undefined ? { brand: listing.brand } : {}) },
      candidates,
    );
    const top = ranked.find((r) => r.cosine >= opts.embeddingThreshold);
    if (top) {
      const cand = candidates.find((c) => c.canonicalId === top.canonicalId);
      if (!cand) return null;
      const conflicts = attributesContradict(listing.attributes, cand.attributes);
      if (conflicts.length === 0) {
        return {
          canonicalId: cand.canonicalId,
          confidence: "medium",
          method: "embedding",
          similarity: top.cosine,
          conflicts,
        };
      }
    }
  }

  return null;
}

function eqBrand(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase().trim() === b.toLowerCase().trim();
}
