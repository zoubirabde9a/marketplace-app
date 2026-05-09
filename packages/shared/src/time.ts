// Deterministic clock abstraction — production uses `Date.now`, tests inject a frozen value.

export interface Clock {
  now(): number; // unix ms
  iso(): string; // ISO-8601 utc
}

export const SystemClock: Clock = {
  now: () => Date.now(),
  iso: () => new Date().toISOString(),
};

export function fixedClock(at: number | string): Clock {
  const ms = typeof at === "number" ? at : new Date(at).getTime();
  return {
    now: () => ms,
    iso: () => new Date(ms).toISOString(),
  };
}

export const SECONDS = 1000;
export const MINUTES = 60 * SECONDS;
export const HOURS = 60 * MINUTES;
export const DAYS = 24 * HOURS;
