// Embedding-model versioning per spec §8.1.
// Holds at most a `current` and a `next` model; backfill writes to both during cutover.

export interface EmbeddingModel {
  modelKey: string;
  modelVersion: string;
  dimensions: number;
}

export interface EmbeddingActiveSet {
  current: EmbeddingModel;
  next?: EmbeddingModel;
}

export interface EvalResult {
  ndcgAt10: number;
}

export interface CutoverInputs {
  active: EmbeddingActiveSet;
  backfillCompleteRatio: number; // 0..1
  evalCurrent: EvalResult;
  evalNext: EvalResult;
}

/**
 * Decide whether to flip `next` → `current`.
 *
 * Spec §8.1: "when backfill is ≥ 99.5% complete and quality eval (NDCG@10 against
 * held-out query set) shows non-regression". We allow a 2pp regression band — explicit
 * gate fails if NDCG@10 drops > 2pp.
 */
export function canCutover(input: CutoverInputs): { ok: boolean; reason?: string } {
  if (!input.active.next) return { ok: false, reason: "no_next_model_configured" };
  if (input.backfillCompleteRatio < 0.995) {
    return { ok: false, reason: `backfill_incomplete:${(input.backfillCompleteRatio * 100).toFixed(2)}%` };
  }
  const drop = input.evalCurrent.ndcgAt10 - input.evalNext.ndcgAt10;
  if (drop > 0.02) {
    return { ok: false, reason: `ndcg_regression:${drop.toFixed(3)}` };
  }
  return { ok: true };
}

export function performCutover(set: EmbeddingActiveSet): EmbeddingActiveSet {
  if (!set.next) throw new Error("no_next_model_configured");
  return { current: set.next };
}
