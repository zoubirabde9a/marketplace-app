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
  /**
   * Anchor for the 14-day max-retry-window check. Set on the FIRST failure
   * of a retry sequence and not updated on subsequent retries — the field is
   * named "last" only because it predates the first/last distinction. To be
   * robust to callers that interpret the name literally and refresh it every
   * retry, `planRetry` also checks the gap from `nextRenewalAt` as a fallback
   * anchor (whichever crosses the 14-day window first wins).
   */
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
  // Fail-closed on Invalid Date for the mandate-refresh deadline. Pre-fix
  // `Invalid Date <= now` evaluated to `false` (NaN coercion), so a
  // corrupted `mandateRefreshDueAt` silently bypassed the refresh gate and
  // the subscription kept charging on an unconfirmed mandate — exactly the
  // failure mode the gate exists to prevent. Same NaN-bypass family as
  // dispute SLA / escrow window / restricted-items effectiveTo. Treat
  // invalid as "refresh required" so a real human re-affirms the mandate.
  if (!Number.isFinite(state.mandateRefreshDueAt.getTime()) || state.mandateRefreshDueAt <= ctx.now) {
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
  // Reject Invalid Date for nextRenewalAt — otherwise `ctx.now < NaN` is
  // `false`, the not-yet-due skip path is bypassed, and the function
  // returns `charge_now` for a subscription whose schedule we can't
  // actually determine. Skip with a clear reason so the caller surfaces
  // the state corruption instead of double-charging.
  if (!Number.isFinite(state.nextRenewalAt.getTime())) {
    return { kind: "skip", reason: "next_renewal_at_invalid" };
  }
  if (ctx.now < state.nextRenewalAt) {
    return { kind: "skip", reason: "not_yet_due" };
  }
  return { kind: "charge_now" };
}

export function planRetry(state: SubscriptionState, failureAt: Date): RenewalOutcome {
  const dayMs = 24 * 3600 * 1000;
  // Two anchors for the same window. Either one breaching 14 days fires
  // auto-pause — see `lastFailureAt` field doc for why.
  const daysSinceFirstFailure =
    state.lastFailureAt !== undefined
      ? (failureAt.getTime() - state.lastFailureAt.getTime()) / dayMs
      : 0;
  const daysOverdue = (failureAt.getTime() - state.nextRenewalAt.getTime()) / dayMs;
  if (
    daysSinceFirstFailure >= AUTO_PAUSE_AFTER_DAYS ||
    daysOverdue >= AUTO_PAUSE_AFTER_DAYS
  ) {
    return { kind: "auto_pause", reason: "max_retry_window_exceeded" };
  }
  if (state.retryCount >= RETRY_DELAYS_DAYS.length) {
    return { kind: "auto_pause", reason: "max_retries_reached" };
  }
  const delayDays = RETRY_DELAYS_DAYS[state.retryCount]!;
  const nextAttemptAt = new Date(failureAt.getTime() + delayDays * dayMs);
  return { kind: "schedule_retry", nextAttemptAt, retryCount: state.retryCount + 1 };
}

/** 72h advance pre-charge notification deadline. */
export function preChargeNotificationDue(state: SubscriptionState): Date {
  return new Date(state.nextRenewalAt.getTime() - 72 * 3600 * 1000);
}
