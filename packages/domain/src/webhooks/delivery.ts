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
  const rng = input.rng ?? Math.random;
  const status = classifyResponse(input.responseStatus);
  if (status === "delivered") {
    return { attempt: input.attempt, scheduledFor: input.now, status: "delivered", ...(input.responseStatus !== undefined ? { responseStatus: input.responseStatus } : {}) };
  }
  if (input.attempt >= opts.maxAttempts || status === "permanent_failure") {
    return {
      attempt: input.attempt,
      scheduledFor: input.now,
      status: "failed_dead",
      ...(input.responseStatus !== undefined ? { responseStatus: input.responseStatus } : {}),
    };
  }
  const exp = Math.min(opts.baseSeconds * 2 ** input.attempt, opts.maxSeconds);
  const jitter = exp * opts.jitterRatio * (rng() * 2 - 1);
  const next = new Date(input.now.getTime() + (exp + jitter) * 1000);
  return {
    attempt: input.attempt + 1,
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
