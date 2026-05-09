// Hybrid search — BM25 (OpenSearch) + dense embeddings (pgvector) with reciprocal-rank fusion.
// Concrete index/connection wiring is environment-specific; this module owns the pure
// ranking/fusion logic so it's deterministically testable.

export interface RankedHit {
  productId: string;
  bm25Score?: number;
  vectorScore?: number;
  finalScore?: number;
}

export interface FuseOptions {
  k: number; // RRF constant, default 60
  bm25Weight: number; // default 1
  vectorWeight: number; // default 1
}

export const DEFAULT_FUSE: FuseOptions = { k: 60, bm25Weight: 1, vectorWeight: 1 };

/** Reciprocal Rank Fusion combining two ranked lists into one. */
export function reciprocalRankFusion(
  bm25: ReadonlyArray<{ productId: string; score: number }>,
  vector: ReadonlyArray<{ productId: string; score: number }>,
  opts: FuseOptions = DEFAULT_FUSE,
): RankedHit[] {
  const out = new Map<string, RankedHit>();
  bm25.forEach((h, idx) => {
    const rrf = opts.bm25Weight / (opts.k + idx + 1);
    out.set(h.productId, { productId: h.productId, bm25Score: h.score, finalScore: rrf });
  });
  vector.forEach((h, idx) => {
    const rrf = opts.vectorWeight / (opts.k + idx + 1);
    const existing = out.get(h.productId);
    if (existing) {
      existing.vectorScore = h.score;
      existing.finalScore = (existing.finalScore ?? 0) + rrf;
    } else {
      out.set(h.productId, { productId: h.productId, vectorScore: h.score, finalScore: rrf });
    }
  });
  return [...out.values()].sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
}

/** Cosine similarity for two same-length vectors. */
export function cosine(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  if (a.length !== b.length) throw new Error(`vector_dim_mismatch:${a.length}!=${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
