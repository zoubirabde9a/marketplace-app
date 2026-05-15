import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { InMemoryIdempotencyStore, registerIdempotency } from "../src/middleware/idempotency.js";

describe("InMemoryIdempotencyStore", () => {
  it("reserves a fresh key", async () => {
    const s = new InMemoryIdempotencyStore();
    expect(await s.reserve("k1", "POST:/v1/orders", "h1", 60)).toBe(true);
    expect(await s.reserve("k1", "POST:/v1/orders", "h1", 60)).toBe(true); // same payload re-ok
    expect(await s.reserve("k1", "POST:/v1/orders", "h2", 60)).toBe(false); // different payload
  });

  it("returns finalized response on replay", async () => {
    const s = new InMemoryIdempotencyStore();
    await s.reserve("k2", "POST:/v1/orders", "h1", 60);
    await s.finalize("k2", "POST:/v1/orders", 201, { id: "o_1" });
    const cached = await s.get("k2", "POST:/v1/orders");
    expect(cached?.status).toBe(201);
    expect(cached?.body).toEqual({ id: "o_1" });
  });

  it("scopes by method+path", async () => {
    const s = new InMemoryIdempotencyStore();
    await s.reserve("kx", "POST:/v1/a", "h", 60);
    expect(await s.get("kx", "POST:/v1/b")).toBeNull();
  });
});

describe("registerIdempotency — concurrent in-flight retry", () => {
  it("rejects a retry whose key matches an unfinalised reservation", async () => {
    // The previous behaviour was to fall through to the route handler when the
    // cached reservation existed but hadn't finalised yet (status=0). Two
    // concurrent retries with the same Idempotency-Key therefore both ran the
    // handler, doubling side effects. Now the second retry must be bounced
    // with a 409 concurrent-request error.
    const s = new InMemoryIdempotencyStore();
    // Manually reserve to simulate an in-flight request that hasn't finalised.
    // The hash is intentionally arbitrary — the middleware should reject the
    // concurrent retry regardless of whether the payload matches.
    await s.reserve("ck1-aaaaaa", "POST:/v1/test", "anyhash", 60);

    const app = Fastify({ logger: false });
    app.setErrorHandler((err, _req, reply) => {
      const status = (err as { status?: number }).status ?? 500;
      void reply.code(status).send({ error: err.message });
    });
    await registerIdempotency(app, { store: s });
    app.post("/v1/test", async () => ({ ok: true }));

    const res = await app.inject({
      method: "POST",
      url: "/v1/test",
      headers: { "idempotency-key": "ck1-aaaaaa" },
      payload: {},
    });
    // The reservation's stored hash differs from the request hash, but the
    // concurrent-detection takes precedence over the payload-conflict check
    // when status===0; either outcome is acceptable so long as the handler
    // does NOT re-run. We assert on the 409 status.
    expect(res.statusCode).toBe(409);
  });

  it("replays a finalised response (matching payload)", async () => {
    // Smoke test that the happy-path replay still works post-fix.
    const s = new InMemoryIdempotencyStore();
    const app = Fastify({ logger: false });
    await registerIdempotency(app, { store: s });
    let handlerCalls = 0;
    app.post("/v1/test", async (_req, reply) => {
      handlerCalls += 1;
      void reply.code(201);
      return { ok: true, n: handlerCalls };
    });

    const first = await app.inject({
      method: "POST",
      url: "/v1/test",
      headers: { "idempotency-key": "replay-key-1" },
      payload: { a: 1 },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual({ ok: true, n: 1 });

    const second = await app.inject({
      method: "POST",
      url: "/v1/test",
      headers: { "idempotency-key": "replay-key-1" },
      payload: { a: 1 },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual({ ok: true, n: 1 }); // handler did NOT run again
    expect(handlerCalls).toBe(1);
  });
});
