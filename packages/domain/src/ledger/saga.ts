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
}

export interface SagaRunnerOptions {
  maxAttempts: number; // per step
  onPersist: (state: SagaState<unknown>) => Promise<void>;
}

export class Saga<S> {
  constructor(
    private readonly steps: ReadonlyArray<SagaStep<S>>,
    private readonly opts: SagaRunnerOptions,
  ) {}

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
    for (let i = completed.length - 1; i >= 0; i--) {
      const idx = completed[i]!;
      const step = this.steps[idx]!;
      try {
        cur = { ...cur, step: `compensate:${step.name}`, state: await step.compensate(cur.state) };
        await this.opts.onPersist(cur as SagaState<unknown>);
      } catch (err) {
        cur = { ...cur, error: `compensate_failed:${err instanceof Error ? err.message : String(err)}` };
        await this.opts.onPersist(cur as SagaState<unknown>);
      }
    }
    cur = { ...cur, status: "failed" };
    await this.opts.onPersist(cur as SagaState<unknown>);
    return cur;
  }
}
