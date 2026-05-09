// End-to-end snapshot path:
//   1. agent calls catalog.search via the MCP registry
//   2. response carries `snapshotUrl: <web>/s/<id>`
//   3. human (or the web app server-side fetcher) GETs /v1/snapshots/:id
//   4. response equals what the agent received
//
// Both layers share the same SnapshotStore instance, exactly as start.ts wires
// them. Catches mismatches in id format, URL shape, store keying, and payload
// serialisation that single-package unit tests would miss.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import { catalog } from "@marketplace/domain";
import { MarketplaceError } from "@marketplace/shared/errors";
import { McpRegistry, type McpContext } from "@marketplace/mcp-server";
import { registerCatalogReadTools, type CatalogReadAdapter } from "@marketplace/mcp-server";
import { registerSnapshotRoutes } from "../src/routes/snapshots.js";

const WEB_BASE = "https://shop.example.test";

const adapter: CatalogReadAdapter = {
  async search() {
    return {
      hits: [
        {
          productId: "prd_e2e_1",
          titleSanitized: "End-to-end Widget",
          brand: "Acme",
          priceMinor: 4999n,
          currency: "USD",
          inStock: true,
          sellerId: "slr_1",
          counterfeitRisk: "low",
          relevanceScore: 0.87,
        },
      ],
      totalEstimate: 1,
    };
  },
  async getProduct(productId) {
    return {
      productId,
      titleSanitized: "End-to-end Widget",
      attributes: {},
      variants: [],
      sellerId: "slr_1",
      counterfeitRisk: "low",
    };
  },
  async compare(ids) {
    return { ids, items: ids.map((id) => ({ productId: id, name: `p-${id}` })) };
  },
  async recommend() {
    return { items: [{ productId: "prd_e2e_2", reason: "co-purchased" }] };
  },
};

function makeCtx(now: () => number): McpContext {
  return {
    agentId: "agt_e2e",
    passportId: "psp_e2e",
    scopes: new Set(["catalog:read"]),
    ownerKind: "user",
    ownerId: "usr_e2e",
    requestId: "req_e2e",
    now,
    emitAudit: async () => {},
  };
}

describe("snapshots end-to-end (MCP tool → API GET)", () => {
  const previousBase = process.env.MARKETPLACE_WEB_BASE_URL;
  beforeAll(() => {
    process.env.MARKETPLACE_WEB_BASE_URL = WEB_BASE;
  });
  afterAll(() => {
    if (previousBase === undefined) delete process.env.MARKETPLACE_WEB_BASE_URL;
    else process.env.MARKETPLACE_WEB_BASE_URL = previousBase;
  });

  async function buildPair() {
    // One store, shared by both producer (MCP) and consumer (HTTP) — mirrors start.ts.
    const t0 = 1_700_000_000_000;
    let nowVal = t0;
    const store = new catalog.MemorySnapshotStore(() => nowVal);

    const reg = new McpRegistry();
    registerCatalogReadTools(reg, adapter, store);

    const app = Fastify();
    app.setErrorHandler((err, req, reply) => {
      if (err instanceof MarketplaceError) {
        void reply.code(err.status).header("content-type", "application/problem+json").send(err.toProblem(req.url));
        return;
      }
      void reply.code(500).send({ error: String(err) });
    });
    await registerSnapshotRoutes(app, { store });

    return { reg, app, store, advanceTime: (ms: number) => { nowVal += ms; }, now: () => nowVal };
  }

  it("catalog.search snapshot URL resolves and returns matching payload", async () => {
    const { reg, app, now } = await buildPair();

    const toolOut = (await reg.invoke("catalog.search", { query: "widget" }, makeCtx(now))) as {
      snapshotUrl: string;
      snapshotCreatedAt: number;
      snapshotExpiresAt: number;
      hits: Array<{ productId: string }>;
      totalEstimate: number;
    };

    // 1. URL has the expected shape.
    expect(toolOut.snapshotUrl).toMatch(new RegExp(`^${WEB_BASE}/s/[A-Za-z0-9_-]{16,}$`));
    expect(toolOut.snapshotExpiresAt - toolOut.snapshotCreatedAt).toBe(catalog.SNAPSHOT_TTL_MS);

    // 2. GET the snapshot via the API.
    const id = toolOut.snapshotUrl.split("/s/")[1]!;
    const res = await app.inject({ method: "GET", url: `/v1/snapshots/${id}` });
    expect(res.statusCode).toBe(200);

    const body = res.json() as {
      id: string;
      kind: string;
      input: { query: string };
      output: { hits: Array<{ productId: string }>; totalEstimate: number };
      createdAt: number;
      expiresAt: number;
    };

    // 3. Stored payload exactly matches the agent's view.
    expect(body.id).toBe(id);
    expect(body.kind).toBe("search");
    expect(body.input.query).toBe("widget");
    expect(body.output.totalEstimate).toBe(toolOut.totalEstimate);
    expect(body.output.hits[0]!.productId).toBe(toolOut.hits[0]!.productId);
    expect(body.createdAt).toBe(toolOut.snapshotCreatedAt);
    expect(body.expiresAt).toBe(toolOut.snapshotExpiresAt);
  });

  it("catalog.get_product snapshot URL resolves", async () => {
    const { reg, app, now } = await buildPair();
    const out = (await reg.invoke("catalog.get_product", { productId: "prd_x" }, makeCtx(now))) as {
      snapshotUrl: string;
    };
    const id = out.snapshotUrl.split("/s/")[1]!;
    const res = await app.inject({ method: "GET", url: `/v1/snapshots/${id}` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { kind: string }).kind).toBe("product");
  });

  it("catalog.compare snapshot URL resolves", async () => {
    const { reg, app, now } = await buildPair();
    const out = (await reg.invoke(
      "catalog.compare",
      { productIds: ["a", "b"] },
      makeCtx(now),
    )) as { snapshotUrl: string };
    const id = out.snapshotUrl.split("/s/")[1]!;
    const res = await app.inject({ method: "GET", url: `/v1/snapshots/${id}` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { kind: string }).kind).toBe("compare");
  });

  it("catalog.recommend snapshot URL resolves", async () => {
    const { reg, app, now } = await buildPair();
    const out = (await reg.invoke(
      "catalog.recommend",
      { context: {}, limit: 5 },
      makeCtx(now),
    )) as { snapshotUrl: string };
    const id = out.snapshotUrl.split("/s/")[1]!;
    const res = await app.inject({ method: "GET", url: `/v1/snapshots/${id}` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { kind: string }).kind).toBe("recommend");
  });

  it("returns 410 once 24h has passed", async () => {
    const { reg, app, advanceTime, now } = await buildPair();
    const out = (await reg.invoke("catalog.search", { query: "widget" }, makeCtx(now))) as {
      snapshotUrl: string;
    };
    const id = out.snapshotUrl.split("/s/")[1]!;

    // Just before expiry — still readable.
    advanceTime(catalog.SNAPSHOT_TTL_MS - 1);
    let res = await app.inject({ method: "GET", url: `/v1/snapshots/${id}` });
    expect(res.statusCode).toBe(200);

    // Past expiry — gone.
    advanceTime(2);
    res = await app.inject({ method: "GET", url: `/v1/snapshots/${id}` });
    expect(res.statusCode).toBe(410);
  });

  it("snapshot ids from independent searches do not collide", async () => {
    const { reg, now } = await buildPair();
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const out = (await reg.invoke("catalog.search", { query: `q${i}` }, makeCtx(now))) as {
        snapshotUrl: string;
      };
      ids.add(out.snapshotUrl.split("/s/")[1]!);
    }
    expect(ids.size).toBe(50);
  });
});
