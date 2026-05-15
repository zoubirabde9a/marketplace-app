// Saga executor for cross-system steps that must be either all-applied or compensated.
// Spec §7.3: charity rounding-up via separate processor, etc.

export type SagaStatus = "pending" | "running" | "compensating" | "completed" | "failed";

export interface SagaStep<S> {
  name: string;
  /** Forward action; returns updated state. Must be idempotent on its own (we wrap with idempotency keys). */
  execute: (state: S) => Promise<S>;
  /** Undo for this step. Called only if a later step fails. Idempotent. */
  compensate: (state: S) => Promise<S>;
}

export interface SagaState<S> {
  id: string;
  status: SagaStatus;
  step: string;
  attempts: number;
  state: S;
  error?: string;
  /**
   * Count of compensation steps that threw. > 0 means the saga ended in a
   * partially-rolled-back state and needs operator attention — without this
   * field, "status: failed" lumps clean rollbacks and broken rollbacks
   * together and the operator can't tell from the log which one happened.
   */
  compensationFailures?: number;
}

export interface SagaRunnerOptions {
  maxAttempts: number; // per step
  onPersist: (state: SagaState<unknown>) => Promise<void>;
}

export class Saga<S> {
  constructor(
    private readonly steps: ReadonlyArray<SagaStep<S>>,
    private readonly opts: SagaRunnerOptions,
  ) {
    if (opts.maxAttempts < 1) {
      // With maxAttempts=0 the `while (attempt < maxAttempts)` loop never
      // entered, every step was a silent no-op, and the saga reported
      // "completed" without having actually run anything. Reject at
      // construction so the misconfiguration is loud.
      throw new Error(`saga_invalid_max_attempts:${opts.maxAttempts}`);
    }
  }

  async run(initial: SagaState<S>): Promise<SagaState<S>> {
    let cur = { ...initial, status: "running" as SagaStatus };
    await this.opts.onPersist(cur as SagaState<unknown>);

    const completed: number[] = [];
    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i]!;
      cur = { ...cur, step: step.name };
      let attempt = 0;
      while (attempt < this.opts.maxAttempts) {
        attempt++;
        try {
          cur = { ...cur, attempts: attempt, state: await step.execute(cur.state) };
          completed.push(i);
          await this.opts.onPersist(cur as SagaState<unknown>);
          break;
        } catch (err) {
          cur = { ...cur, error: err instanceof Error ? err.message : String(err), attempts: attempt };
          await this.opts.onPersist(cur as SagaState<unknown>);
          if (attempt >= this.opts.maxAttempts) {
            return await this.compensate(cur, completed);
          }
        }
      }
    }
    cur = { ...cur, status: "completed" };
    await this.opts.onPersist(cur as SagaState<unknown>);
    return cur;
  }

  private async compensate(state: SagaState<S>, completed: ReadonlyArray<number>): Promise<SagaState<S>> {
    let cur = { ...state, status: "compensating" as SagaStatus };
    await this.opts.onPersist(cur as SagaState<unknown>);
    let compensationFailures = 0;
    for (let i = completed.length - 1; i >= 0; i--) {
      const idx = completed[i]!;
      const step = this.steps[idx]!;
      try {
        cur = { ...cur, step: `compensate:${step.name}`, state: await step.compensate(cur.state) };
        await this.opts.onPersist(cur as SagaState<unknown>);
      } catch (err) {
        // A compensation that throws leaves the system in a partially-
        // rolled-back state. Keep going — running the remaining compensations
        // is best-effort cleanup — but count the failure so the final state
        // carries a clear "needs operator attention" signal instead of
        // pretending the rollback was clean.
        compensationFailures += 1;
        cur = {
          ...cur,
          error: `compensate_failed:${step.name}:${err instanceof Error ? err.message : String(err)}`,
          compensationFailures,
        };
        await this.opts.onPersist(cur as SagaState<unknown>);
      }
    }
    cur = {
      ...cur,
      status: "failed",
      ...(compensationFailures > 0 ? { compensationFailures } : {}),
    };
    await this.opts.onPersist(cur as SagaState<unknown>);
    return cur;
  }
}
