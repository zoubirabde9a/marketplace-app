// Subscription renewal logic per spec §7.1.
// - Smart retry: 1d, 3d, 7d → max 3 retries → auto-pause at 14d.
// - Mandate refresh: required every ≤ 12 months; auto-pause on expiry, no silent failures.
// - Pre-charge notification: 72h advance webhook.

export type SubscriptionStatus = "active" | "paused" | "cancelled" | "expired";

export type RenewalOutcome =
  | { kind: "skip"; reason: string }
  | { kind: "charge_now" }
  | { kind: "schedule_retry"; nextAttemptAt: Date; retryCount: number }
  | { kind: "auto_pause"; reason: string }
  | { kind: "mandate_refresh_required" };

export interface SubscriptionState {
  status: SubscriptionStatus;
  nextRenewalAt: Date;
  retryCount: number;
  lastFailureAt?: Date;
  mandateRefreshDueAt: Date;
  totalCapMinor?: bigint;
  consumedMinor: bigint;
  endAfterCycles?: number;
  cyclesCompleted: number;
}

export interface RenewalContext {
  amountMinor: bigint;
  now: Date;
}

const RETRY_DELAYS_DAYS = [1, 3, 7] as const;
const AUTO_PAUSE_AFTER_DAYS = 14;

export function evaluateRenewal(state: SubscriptionState, ctx: RenewalContext): RenewalOutcome {
  if (state.status !== "active") {
    return { kind: "skip", reason: `subscription_${state.status}` };
  }
  if (state.mandateRefreshDueAt <= ctx.now) {
    return { kind: "mandate_refresh_required" };
  }
  if (state.totalCapMinor !== undefined) {
    if (state.consumedMinor + ctx.amountMinor > state.totalCapMinor) {
      return { kind: "auto_pause", reason: "total_cap_exhausted" };
    }
  }
  if (state.endAfterCycles !== undefined && state.cyclesCompleted >= state.endAfterCycles) {
    return { kind: "skip", reason: "end_after_cycles_reached" };
  }
  if (ctx.now < state.nextRenewalAt) {
    return { kind: "skip", reason: "not_yet_due" };
  }
  return { kind: "charge_now" };
}

export function planRetry(state: SubscriptionState, failureAt: Date): RenewalOutcome {
  const sinceFirst =
    state.lastFailureAt !== undefined
      ? (failureAt.getTime() - state.lastFailureAt.getTime()) / (24 * 3600 * 1000)
      : 0;
  if (sinceFirst >= AUTO_PAUSE_AFTER_DAYS) {
    return { kind: "auto_pause", reason: "max_retry_window_exceeded" };
  }
  if (state.retryCount >= RETRY_DELAYS_DAYS.length) {
    return { kind: "auto_pause", reason: "max_retries_reached" };
  }
  const delayDays = RETRY_DELAYS_DAYS[state.retryCount]!;
  const nextAttemptAt = new Date(failureAt.getTime() + delayDays * 24 * 3600 * 1000);
  return { kind: "schedule_retry", nextAttemptAt, retryCount: state.retryCount + 1 };
}

/** 72h advance pre-charge notification deadline. */
export function preChargeNotificationDue(state: SubscriptionState): Date {
  return new Date(state.nextRenewalAt.getTime() - 72 * 3600 * 1000);
}
