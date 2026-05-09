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
});
