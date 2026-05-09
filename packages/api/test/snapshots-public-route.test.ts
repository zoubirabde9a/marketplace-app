// Regression test: GET /v1/snapshots/:id MUST be reachable without DPoP/session
// auth — the unguessable id is the credential. Earlier versions of the auth
// middleware omitted /v1/snapshots/ from PUBLIC_MATCHERS, which 401'd every
// snapshot link before it reached the handler. Other snapshot tests bypass the
// auth middleware entirely, so they didn't catch this. This test wires both the
// auth hook and the snapshot route together, exactly as server.ts does.

import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { catalog } from "@marketplace/domain";
import { MarketplaceError } from "@marketplace/shared/errors";
import { registerAuth } from "../src/middleware/auth.js";
import { registerSnapshotRoutes } from "../src/routes/snapshots.js";

async function buildAppWithAuth(store: catalog.SnapshotStore) {
  const app = Fastify();
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof MarketplaceError) {
      void reply.code(err.status).header("content-type", "application/problem+json").send(err.toProblem(req.url));
      return;
    }
    void reply.code(500).send({ error: String(err) });
  });
  await registerAuth(app, {
    resolveIssuerKey: async () => undefined,
    resolveSessionKey: async () => undefined,
    isPassportRevoked: async () => false,
    jtiSeen: async () => false,
    audience: "test",
    now: () => Date.now(),
    devBypass: false,
  });
  await registerSnapshotRoutes(app, { store });
  return app;
}

describe("GET /v1/snapshots/:id (through auth middleware)", () => {
  it("is reachable without any Authorization header (public-token route)", async () => {
    const store = new catalog.MemorySnapshotStore();
    const id = catalog.newSnapshotId();
    const now = Date.now();
    await store.put({
      id,
      kind: "search",
      input: { query: "widget" },
      output: { hits: [], totalEstimate: 0 },
      principalId: "usr_1",
      agentId: "agt_1",
      createdAt: now,
      expiresAt: now + catalog.SNAPSHOT_TTL_MS,
    });
    const app = await buildAppWithAuth(store);
    const res = await app.inject({ method: "GET", url: `/v1/snapshots/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(id);
  });

  it("returns 410 (not 401) for an unknown id", async () => {
    const store = new catalog.MemorySnapshotStore();
    const app = await buildAppWithAuth(store);
    // valid id format, but nothing in the store
    const res = await app.inject({ method: "GET", url: "/v1/snapshots/aaaaaaaaaaaaaaaa" });
    expect(res.statusCode).toBe(410);
  });
});
