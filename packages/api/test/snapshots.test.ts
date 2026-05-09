import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { catalog } from "@marketplace/domain";
import { MarketplaceError } from "@marketplace/shared/errors";
import { registerSnapshotRoutes } from "../src/routes/snapshots.js";
import { RedisSnapshotStore } from "../src/repos/snapshots.js";

async function buildApp(store: catalog.SnapshotStore) {
  const app = Fastify();
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof MarketplaceError) {
      void reply.code(err.status).header("content-type", "application/problem+json").send(err.toProblem(req.url));
      return;
    }
    void reply.code(500).send({ error: String(err) });
  });
  await registerSnapshotRoutes(app, { store });
  return app;
}

describe("GET /v1/snapshots/:id", () => {
  it("returns the frozen payload", async () => {
    const store = new catalog.MemorySnapshotStore();
    const id = catalog.newSnapshotId();
    const now = Date.now();
    await store.put({
      id,
      kind: "search",
      input: { query: "widget" },
      output: { hits: [{ productId: "prd_1" }], totalEstimate: 1 },
      principalId: "usr_1",
      agentId: "agt_1",
      createdAt: now,
      expiresAt: now + catalog.SNAPSHOT_TTL_MS,
    });
    const app = await buildApp(store);
    const res = await app.inject({ method: "GET", url: `/v1/snapshots/${id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; kind: string; output: { totalEstimate: number } };
    expect(body.id).toBe(id);
    expect(body.kind).toBe("search");
    expect(body.output.totalEstimate).toBe(1);
  });

  it("returns 410 Gone when expired", async () => {
    let now = 1_000_000;
    const store = new catalog.MemorySnapshotStore(() => now);
    const id = catalog.newSnapshotId();
    await store.put({
      id,
      kind: "search",
      input: {},
      output: {},
      createdAt: now,
      expiresAt: now + 100,
    });
    now += 200; // expire
    const app = await buildApp(store);
    const res = await app.inject({ method: "GET", url: `/v1/snapshots/${id}` });
    expect(res.statusCode).toBe(410);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json() as { title: string };
    expect(body.title).toMatch(/expired/i);
  });

  it("returns 404 for malformed id", async () => {
    const store = new catalog.MemorySnapshotStore();
    const app = await buildApp(store);
    const res = await app.inject({ method: "GET", url: "/v1/snapshots/not!valid" });
    expect(res.statusCode).toBe(404);
  });

  it("returns 410 for unknown id", async () => {
    const store = new catalog.MemorySnapshotStore();
    const app = await buildApp(store);
    const id = catalog.newSnapshotId();
    const res = await app.inject({ method: "GET", url: `/v1/snapshots/${id}` });
    expect(res.statusCode).toBe(410);
  });
});

describe("RedisSnapshotStore", () => {
  it("serialises and deserialises through a fake redis client", async () => {
    const calls: Array<{ cmd: string; args: unknown[] }> = [];
    const fake: Record<string, string> = {};
    const fakeRedis = {
      async set(key: string, value: string, _mode: string, _ttl: number) {
        calls.push({ cmd: "set", args: [key, value, _mode, _ttl] });
        fake[key] = value;
      },
      async get(key: string) {
        calls.push({ cmd: "get", args: [key] });
        return fake[key] ?? null;
      },
    };
    const store = new RedisSnapshotStore(fakeRedis as unknown as ConstructorParameters<typeof RedisSnapshotStore>[0]);
    const now = Date.now();
    const snap: catalog.Snapshot = {
      id: "abc123",
      kind: "search",
      input: { q: "x" },
      output: { hits: [] },
      createdAt: now,
      expiresAt: now + catalog.SNAPSHOT_TTL_MS,
    };
    await store.put(snap);
    const set = calls.find((c) => c.cmd === "set")!;
    expect(set.args[0]).toBe("snap:abc123");
    expect(set.args[2]).toBe("EX");
    expect(Number(set.args[3])).toBeGreaterThan(86_000);
    const got = await store.get("abc123");
    expect(got?.id).toBe("abc123");
    expect(got?.kind).toBe("search");
  });
});
