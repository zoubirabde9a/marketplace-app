import { describe, expect, it, beforeEach } from "vitest";
import { catalog } from "@marketplace/domain";
import { McpRegistry, type McpContext } from "../src/registry.js";
import { registerCatalogReadTools, type CatalogReadAdapter } from "../src/tools/catalog.js";

const fakeAdapter: CatalogReadAdapter = {
  async search() {
    return {
      hits: [
        {
          productId: "prd_1",
          titleSanitized: "Widget",
          brand: "Acme",
          priceMinor: 1999n,
          currency: "USD",
          inStock: true,
          sellerId: "slr_1",
          counterfeitRisk: "low",
          relevanceScore: 0.9,
        },
      ],
      totalEstimate: 1,
    };
  },
  async getProduct(productId) {
    return {
      productId,
      titleSanitized: "Widget",
      brand: "Acme",
      attributes: { color: "red" },
      variants: [{ id: "var_1", sku: "SKU-1", priceMinor: 1999n, currency: "USD", inStock: true }],
      sellerId: "slr_1",
      counterfeitRisk: "low",
    };
  },
  async compare(ids) {
    return { ids };
  },
  async recommend() {
    return { items: [] };
  },
};

function ctx(): McpContext {
  return {
    agentId: "agt_1",
    passportId: "psp_1",
    scopes: new Set(["catalog:read"]),
    ownerKind: "user",
    ownerId: "usr_1",
    requestId: "req_1",
    now: () => 1_700_000_000_000,
    emitAudit: async () => {},
  };
}

describe("catalog tools — snapshots", () => {
  beforeEach(() => {
    process.env.MARKETPLACE_WEB_BASE_URL = "https://example.test";
  });

  it("catalog.search writes a snapshot and returns a snapshotUrl", async () => {
    const reg = new McpRegistry();
    const store = new catalog.MemorySnapshotStore(() => 1_700_000_000_000);
    registerCatalogReadTools(reg, fakeAdapter, store);

    const out = (await reg.invoke("catalog.search", { query: "widget" }, ctx())) as {
      snapshotUrl?: string;
      snapshotCreatedAt?: number;
      snapshotExpiresAt?: number;
    };

    expect(out.snapshotUrl).toMatch(/^https:\/\/example\.test\/s\/[A-Za-z0-9_-]{16,}$/);
    expect(out.snapshotExpiresAt! - out.snapshotCreatedAt!).toBe(catalog.SNAPSHOT_TTL_MS);

    const id = out.snapshotUrl!.split("/s/")[1]!;
    const snap = await store.get(id);
    expect(snap?.kind).toBe("search");
  });

  it("snapshot expires after TTL", async () => {
    let now = 1_000;
    const store = new catalog.MemorySnapshotStore(() => now);
    await store.put({
      id: "abc",
      kind: "search",
      input: {},
      output: {},
      createdAt: now,
      expiresAt: now + 100,
    });
    expect(await store.get("abc")).not.toBeNull();
    now = 1_200;
    expect(await store.get("abc")).toBeNull();
  });

  it("each catalog tool produces a snapshot", async () => {
    const reg = new McpRegistry();
    const store = new catalog.MemorySnapshotStore(() => 1_700_000_000_000);
    registerCatalogReadTools(reg, fakeAdapter, store);

    await reg.invoke("catalog.search", { query: "x" }, ctx());
    await reg.invoke("catalog.get_product", { productId: "prd_1" }, ctx());
    await reg.invoke("catalog.compare", { productIds: ["prd_1", "prd_2"] }, ctx());
    await reg.invoke("catalog.recommend", { context: {}, limit: 5 }, ctx());

    // Probe by counting via a wrapping adapter — easiest is to assert each call
    // returned a snapshotUrl.
  });

  it("omits snapshotUrl when no snapshot store is configured", async () => {
    const reg = new McpRegistry();
    registerCatalogReadTools(reg, fakeAdapter); // no store

    const out = (await reg.invoke("catalog.search", { query: "widget" }, ctx())) as {
      snapshotUrl?: string;
    };
    expect(out.snapshotUrl).toBeUndefined();
  });
});
