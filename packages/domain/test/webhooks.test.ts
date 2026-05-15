import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  formatSignatureHeader,
  parseSignatureHeader,
  signWebhook,
  verifyWebhook,
} from "../src/webhooks/signing.js";
import { scheduleNextAttempt } from "../src/webhooks/delivery.js";

describe("webhook signing", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  it("round-trips header format", () => {
    const h = signWebhook({ body: '{"x":1}', kid: "kid-1", privateKey, now: 1_700_000_000_000 });
    const formatted = formatSignatureHeader(h);
    expect(parseSignatureHeader(formatted)).toEqual(h);
  });

  it("verifies a fresh signature", () => {
    const body = '{"event":"order.created"}';
    const h = signWebhook({ body, kid: "kid-1", privateKey, now: 1_700_000_000_000 });
    expect(verifyWebhook({ body, header: h, publicKey, now: 1_700_000_000_000 + 1000 })).toBe(true);
  });

  it("rejects tampered body", () => {
    const h = signWebhook({ body: "a", kid: "kid-1", privateKey, now: 1_700_000_000_000 });
    expect(verifyWebhook({ body: "b", header: h, publicKey, now: 1_700_000_000_000 + 1000 })).toBe(false);
  });

  it("rejects timestamp outside tolerance", () => {
    const h = signWebhook({ body: "x", kid: "kid-1", privateKey, now: 0 });
    expect(verifyWebhook({ body: "x", header: h, publicKey, now: 1_700_000_000_000 })).toBe(false);
  });

  it("rejects non-finite timestamps (NaN / Infinity bypass)", () => {
    // `Math.abs(NaN) > tol` evaluates to `false` — a non-finite timestamp
    // used to silently pass the freshness gate. Fail-closed at the input.
    const body = "x";
    const sig = signWebhook({ body, kid: "kid-1", privateKey, now: 1_700_000_000_000 });
    expect(
      verifyWebhook({
        body,
        header: { ...sig, timestamp: NaN },
        publicKey,
        now: 1_700_000_000_000,
      }),
    ).toBe(false);
    expect(
      verifyWebhook({
        body,
        header: { ...sig, timestamp: Infinity },
        publicKey,
        now: 1_700_000_000_000,
      }),
    ).toBe(false);
  });

  it("rejects empty signature / empty kid (input-shape guard)", () => {
    const body = "x";
    const sig = signWebhook({ body, kid: "kid-1", privateKey, now: 1_700_000_000_000 });
    expect(
      verifyWebhook({
        body,
        header: { ...sig, signature: "" },
        publicKey,
        now: 1_700_000_000_000,
      }),
    ).toBe(false);
    expect(
      verifyWebhook({
        body,
        header: { ...sig, kid: "" },
        publicKey,
        now: 1_700_000_000_000,
      }),
    ).toBe(false);
  });
});

describe("scheduleNextAttempt", () => {
  const rng = () => 0; // deterministic

  it("marks 2xx as delivered", () => {
    const r = scheduleNextAttempt({ attempt: 1, responseStatus: 200, now: new Date(0), rng });
    expect(r.status).toBe("delivered");
  });

  it("retries on 5xx with backoff", () => {
    const r = scheduleNextAttempt({ attempt: 1, responseStatus: 503, now: new Date(0), rng });
    expect(r.status).toBe("failed_retry");
    expect(r.attempt).toBe(2);
    expect(r.scheduledFor.getTime()).toBeGreaterThan(0);
  });

  it("dead-letters on 410 immediately", () => {
    const r = scheduleNextAttempt({ attempt: 1, responseStatus: 410, now: new Date(0), rng });
    expect(r.status).toBe("failed_dead");
  });

  it("dead-letters after max attempts", () => {
    const r = scheduleNextAttempt({ attempt: 12, responseStatus: 503, now: new Date(0), rng });
    expect(r.status).toBe("failed_dead");
  });

  it("treats network failure (no status) as transient", () => {
    const r = scheduleNextAttempt({ attempt: 1, now: new Date(0), rng });
    expect(r.status).toBe("failed_retry");
  });

  it("scheduledFor never lands in the past, even with jitterRatio > 1", () => {
    // Pre-fix: a jitterRatio > 1 made `jitter` exceed `exp` in magnitude,
    // so `(exp + jitter)` could be negative — the retry would be scheduled
    // BEFORE `now` and would fire immediately on every cycle. Now jitter
    // is clamped to [0, 1] internally; worst case is `exp - exp = 0`.
    const now = new Date(1_000_000);
    const r = scheduleNextAttempt({
      attempt: 1,
      responseStatus: 503,
      now,
      options: { jitterRatio: 5 } as Partial<{ jitterRatio: number }>,
      rng: () => 0, // jitter = exp * 1 * (0*2 - 1) = -exp (under the clamp)
    });
    expect(r.scheduledFor.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });

  it("normalises negative / NaN attempt to 0 (no fractional exponent)", () => {
    // `2 ** -3` is a fraction; mixing that with baseSeconds would schedule
    // a retry sooner than the first-attempt baseline. Junk attempt is
    // normalised to 0 so retry semantics stay predictable.
    const r1 = scheduleNextAttempt({
      attempt: -3,
      responseStatus: 503,
      now: new Date(0),
      rng,
    });
    expect(r1.status).toBe("failed_retry");
    expect(r1.attempt).toBe(1);
    const r2 = scheduleNextAttempt({
      attempt: NaN,
      responseStatus: 503,
      now: new Date(0),
      rng,
    });
    expect(r2.status).toBe("failed_retry");
    expect(r2.attempt).toBe(1);
  });
});
