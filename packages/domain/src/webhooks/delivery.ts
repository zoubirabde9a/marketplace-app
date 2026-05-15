// Webhook delivery scheduler: at-least-once with exponential backoff + jitter.
// Stateless logic — adapter persists DeliveryAttempt rows.

export interface DeliveryAttempt {
  attempt: number;
  scheduledFor: Date;
  status: "pending" | "delivered" | "failed_retry" | "failed_dead";
  responseStatus?: number;
  responseBodySnippet?: string;
}

export interface BackoffOptions {
  baseSeconds: number; // default 5
  maxSeconds: number; // default 6h
  maxAttempts: number; // default 12
  jitterRatio: number; // 0..1, default 0.2
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseSeconds: 5,
  maxSeconds: 6 * 3600,
  maxAttempts: 12,
  jitterRatio: 0.2,
};

export interface ScheduleNextInput {
  attempt: number;
  responseStatus?: number;
  now: Date;
  options?: Partial<BackoffOptions>;
  rng?: () => number;
}

export function scheduleNextAttempt(input: ScheduleNextInput): DeliveryAttempt {
  const opts = { ...DEFAULT_BACKOFF, ...(input.options ?? {}) };
  // Sanitise critical numeric options. A caller passing `jitterRatio > 1`
  // produces a jitter range `[-(1+r)·exp, +(1+r)·exp]` that can drive the
  // scheduled time INTO THE PAST (`exp + jitter < 0`). A negative
  // `baseSeconds` or zero `maxSeconds` similarly breaks the backoff math.
  // Defensive clamp: jitter to [0, 1], base/max to positive.
  const jitterRatio = Math.max(0, Math.min(1, opts.jitterRatio));
  const baseSeconds = Math.max(1, opts.baseSeconds);
  const maxSeconds = Math.max(baseSeconds, opts.maxSeconds);
  // Sanitise maxAttempts. Pre-fix a non-finite value (`NaN`, `Infinity`)
  // made `attempt >= NaN` evaluate to `false` forever — the dead-letter
  // gate never fired and the scheduler kept producing retry attempts
  // until something else broke. Clamp to a sensible upper bound; default
  // is 12 so anything past 1000 is misconfiguration.
  const maxAttempts = Number.isFinite(opts.maxAttempts) && opts.maxAttempts >= 0
    ? Math.floor(opts.maxAttempts)
    : DEFAULT_BACKOFF.maxAttempts;
  // `attempt` is an iteration counter; negative is nonsense. Treat junk
  // input as attempt 0 rather than producing fractional `2 ** negative`
  // exponents and a `scheduledFor` that may already be past.
  const attempt = Number.isFinite(input.attempt) && input.attempt >= 0 ? Math.floor(input.attempt) : 0;
  const rng = input.rng ?? Math.random;
  const status = classifyResponse(input.responseStatus);
  if (status === "delivered") {
    return { attempt, scheduledFor: input.now, status: "delivered", ...(input.responseStatus !== undefined ? { responseStatus: input.responseStatus } : {}) };
  }
  if (attempt >= maxAttempts || status === "permanent_failure") {
    return {
      attempt,
      scheduledFor: input.now,
      status: "failed_dead",
      ...(input.responseStatus !== undefined ? { responseStatus: input.responseStatus } : {}),
    };
  }
  const exp = Math.min(baseSeconds * 2 ** attempt, maxSeconds);
  const jitter = exp * jitterRatio * (rng() * 2 - 1);
  // `exp + jitter` is guaranteed non-negative now because jitterRatio ≤ 1,
  // so the worst case is `exp - exp = 0`. Keep the Math.max for paranoia.
  const delaySeconds = Math.max(0, exp + jitter);
  const next = new Date(input.now.getTime() + delaySeconds * 1000);
  return {
    attempt: attempt + 1,
    scheduledFor: next,
    status: "failed_retry",
    ...(input.responseStatus !== undefined ? { responseStatus: input.responseStatus } : {}),
  };
}

function classifyResponse(status: number | undefined): "delivered" | "transient" | "permanent_failure" {
  if (status === undefined) return "transient"; // network failure, retry
  if (status >= 200 && status < 300) return "delivered";
  if (status === 410 || status === 401 || status === 403) return "permanent_failure";
  return "transient";
}
