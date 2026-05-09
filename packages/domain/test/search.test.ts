import { describe, expect, it } from "vitest";
import { cosine, reciprocalRankFusion } from "../src/catalog/search.js";
import { canCutover } from "../src/catalog/embedding-versioning.js";

describe("cosine", () => {
  it("returns 1 for parallel vectors", () => {
    expect(cosine([1, 0, 0], [2, 0, 0])).toBeCloseTo(1, 6);
  });
  it("returns 0 for orthogonal", () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
  it("throws on dim mismatch", () => {
    expect(() => cosine([1, 2, 3], [1, 2])).toThrow(/dim_mismatch/);
  });
});

describe("reciprocalRankFusion", () => {
  it("merges and ranks two lists", () => {
    const bm25 = [
      { productId: "a", score: 9 },
      { productId: "b", score: 5 },
    ];
    const vec = [
      { productId: "b", score: 0.9 },
      { productId: "c", score: 0.8 },
    ];
    const merged = reciprocalRankFusion(bm25, vec);
    expect(merged[0]?.productId).toBe("b"); // appears in both
    expect(merged.map((m) => m.productId).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("canCutover", () => {
  const current = { modelKey: "m", modelVersion: "1", dimensions: 768 };
  const next = { modelKey: "m", modelVersion: "2", dimensions: 768 };

  it("blocks without next configured", () => {
    expect(canCutover({
      active: { current },
      backfillCompleteRatio: 1,
      evalCurrent: { ndcgAt10: 0.7 },
      evalNext: { ndcgAt10: 0.8 },
    }).ok).toBe(false);
  });

  it("blocks below 99.5% backfill", () => {
    expect(canCutover({
      active: { current, next },
      backfillCompleteRatio: 0.98,
      evalCurrent: { ndcgAt10: 0.7 },
      evalNext: { ndcgAt10: 0.8 },
    }).ok).toBe(false);
  });

  it("blocks NDCG drop > 2pp", () => {
    expect(canCutover({
      active: { current, next },
      backfillCompleteRatio: 1,
      evalCurrent: { ndcgAt10: 0.85 },
      evalNext: { ndcgAt10: 0.80 },
    }).ok).toBe(false);
  });

  it("approves when both gates pass", () => {
    expect(canCutover({
      active: { current, next },
      backfillCompleteRatio: 0.999,
      evalCurrent: { ndcgAt10: 0.80 },
      evalNext: { ndcgAt10: 0.81 },
    }).ok).toBe(true);
  });
});
