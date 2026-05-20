import { beforeEach, describe, expect, it } from "vitest";
import { catalog } from "@marketplace/domain";
import { McpRegistry, type McpContext } from "../src/registry.js";
import { registerSellerWriteTools, type SellerWriteAdapter } from "../src/tools/seller-write.js";

const fakeAdapter: SellerWriteAdapter = {
  sellers: {
    async create(input) {
      const phones = (input.phones ?? []).map((p, i) => ({
        phoneE164: p.phone.startsWith("+") ? p.phone : `+213${p.phone}`,
        isWhatsapp: p.isWhatsapp ?? false,
        isViber: p.isViber ?? false,
        isPrimary: p.isPrimary ?? i === 0,
        position: p.position ?? i,
      }));
      const primary = phones.find((p) => p.isPrimary) ?? phones[0];
      const wa = phones.find((p) => p.isWhatsapp);
      return {
        sellerId: "slr_1",
        displayName: input.displayName,
        ownerAgentId: input.ownerAgentId,
        phones,
        ...(primary ? { phone: primary.phoneE164 } : {}),
        ...(wa ? { whatsapp: wa.phoneE164 } : {}),
        ...(input.countryCode ? { countryCode: input.countryCode } : {}),
        ...(input.city ? { city: input.city } : {}),
        ...(input.description ? { description: input.description } : {}),
        createdAt: 1_700_000_000_000,
      };
    },
    async get(sellerId) {
      return { sellerId, ownerAgentId: "agt_1" };
    },
  },
  products: {
    async create(input) {
      return {
        productId: "prd_1",
        sellerId: input.sellerId,
        titleSanitized: input.title,
        variants: input.variants.map((v, i) => ({
          id: `var_${i + 1}`,
          sku: v.sku,
          priceMinor: v.priceMinor,
          currency: v.currency,
          inStock: v.inStock ?? true,
        })),
        media: [],
        createdAt: 1_700_000_000_000,
      };
    },
  },
};

function ctx(): McpContext {
  return {
    agentId: "agt_1",
    passportId: "psp_1",
    scopes: new Set(["seller:write", "seller:product:write"]),
    ownerKind: "user",
    ownerId: "usr_1",
    requestId: "req_1",
    now: () => 1_700_000_000_000,
    emitAudit: async () => {},
  };
}

describe("seller write tools — snapshots", () => {
  beforeEach(() => {
    process.env.MARKETPLACE_WEB_BASE_URL = "https://example.test";
  });

  it("seller.create_account writes a seller_create snapshot and returns a snapshotUrl", async () => {
    const reg = new McpRegistry();
    const store = new catalog.MemorySnapshotStore(() => 1_700_000_000_000);
    registerSellerWriteTools(reg, fakeAdapter, store);

    const out = (await reg.invoke(
      "seller.create_account",
      { displayName: "Tor Store", phone: "+213500000000", countryCode: "DZ" },
      ctx(),
    )) as { sellerId: string; snapshotUrl?: string; snapshotCreatedAt?: number; snapshotExpiresAt?: number };

    expect(out.snapshotUrl).toMatch(/^https:\/\/example\.test\/s\/[A-Za-z0-9_-]{16,}$/);
    expect(out.snapshotExpiresAt! - out.snapshotCreatedAt!).toBe(catalog.SNAPSHOT_TTL_MS);

    const id = out.snapshotUrl!.split("/s/")[1]!;
    const snap = await store.get(id);
    expect(snap?.kind).toBe("seller_create");
    expect((snap?.output as { sellerId: string }).sellerId).toBe(out.sellerId);
  });

  it("product.create_listing snapshot is JSON-serializable (no BigInt leaks for the Redis store)", async () => {
    const reg = new McpRegistry();
    const store = new catalog.MemorySnapshotStore(() => 1_700_000_000_000);
    registerSellerWriteTools(reg, fakeAdapter, store);

    const out = (await reg.invoke(
      "product.create_listing",
      {
        sellerId: "slr_1",
        title: "Tor T-Shirt",
        description: "A 100% cotton t-shirt featuring the Tor onion logo. Unisex fit, machine washable.",
        variants: [{ sku: "TOR-TS-001", priceMinor: 1999, currency: "USD" }],
        media: [{ url: "https://example.test/images/tor-tshirt.jpg" }],
      },
      ctx(),
    )) as { snapshotUrl?: string };

    const id = out.snapshotUrl!.split("/s/")[1]!;
    const snap = await store.get(id);
    // Redis serialization in prod does JSON.stringify(snap). If priceMinor is a BigInt
    // post-Zod-transform, that throws "Do not know how to serialize a BigInt".
    expect(() => JSON.stringify(snap)).not.toThrow();
  });

  it("product.create_listing writes a product_create snapshot and returns a snapshotUrl", async () => {
    const reg = new McpRegistry();
    const store = new catalog.MemorySnapshotStore(() => 1_700_000_000_000);
    registerSellerWriteTools(reg, fakeAdapter, store);

    const out = (await reg.invoke(
      "product.create_listing",
      {
        sellerId: "slr_1",
        title: "Tor Classic T-Shirt",
        description: "A 100% cotton t-shirt featuring the Tor onion logo. Unisex fit, machine washable.",
        variants: [{ sku: "TOR-TS-001", priceMinor: 1999, currency: "USD" }],
        media: [{ url: "https://example.test/images/tor-tshirt-front.jpg" }],
      },
      ctx(),
    )) as { productId: string; snapshotUrl?: string };

    expect(out.snapshotUrl).toMatch(/^https:\/\/example\.test\/s\/[A-Za-z0-9_-]{16,}$/);
    const id = out.snapshotUrl!.split("/s/")[1]!;
    const snap = await store.get(id);
    expect(snap?.kind).toBe("product_create");
    expect((snap?.output as { productId: string }).productId).toBe(out.productId);
  });

  it("seller.create_account accepts a multi-phone shop and surfaces phones[] in output + snapshot", async () => {
    const reg = new McpRegistry();
    const store = new catalog.MemorySnapshotStore(() => 1_700_000_000_000);
    registerSellerWriteTools(reg, fakeAdapter, store);

    const out = (await reg.invoke(
      "seller.create_account",
      {
        displayName: "Tor Store",
        countryCode: "DZ",
        phones: [
          { phone: "+213555010101", isPrimary: true, isWhatsapp: true },
          { phone: "+213555020202", isViber: true },
        ],
      },
      ctx(),
    )) as { phones: Array<{ phone: string; isWhatsapp: boolean; isPrimary: boolean }>; snapshotUrl?: string };

    expect(out.phones).toHaveLength(2);
    expect(out.phones[0]?.isPrimary).toBe(true);
    expect(out.phones[0]?.isWhatsapp).toBe(true);
    const id = out.snapshotUrl!.split("/s/")[1]!;
    const snap = await store.get(id);
    expect((snap?.output as { phones: unknown[] }).phones).toHaveLength(2);
  });

  it("seller.create_account rejects empty phone input (neither phone nor phones provided)", async () => {
    const reg = new McpRegistry();
    registerSellerWriteTools(reg, fakeAdapter);
    await expect(
      reg.invoke("seller.create_account", { displayName: "Tor", countryCode: "DZ" }, ctx()),
    ).rejects.toThrow();
  });

  it("seller.create_account rejects a non-ISO country code", async () => {
    const reg = new McpRegistry();
    registerSellerWriteTools(reg, fakeAdapter);
    await expect(
      reg.invoke(
        "seller.create_account",
        { displayName: "Bogus", countryCode: "XX", phone: "+213500000000" },
        ctx(),
      ),
    ).rejects.toThrow(/ISO 3166|country/i);
  });

  it("product.delete_listing returns removed for an owned product", async () => {
    const reg = new McpRegistry();
    const adapter: SellerWriteAdapter = {
      ...fakeAdapter,
      products: {
        ...fakeAdapter.products,
        softDelete: async (productId, callerAgentId) => {
          expect(productId).toBe("prd_mine");
          expect(callerAgentId).toBe("agt_1");
          return "removed";
        },
      },
    };
    registerSellerWriteTools(reg, adapter);
    const out = (await reg.invoke(
      "product.delete_listing",
      { productId: "prd_mine" },
      ctx(),
    )) as { productId: string; result: string };
    expect(out).toEqual({ productId: "prd_mine", result: "removed" });
  });

  it("product.delete_listing surfaces not_owned without throwing — agent can explain to operator", async () => {
    const reg = new McpRegistry();
    const adapter: SellerWriteAdapter = {
      ...fakeAdapter,
      products: {
        ...fakeAdapter.products,
        softDelete: async () => "not_owned",
      },
    };
    registerSellerWriteTools(reg, adapter);
    const out = (await reg.invoke(
      "product.delete_listing",
      { productId: "prd_other" },
      ctx(),
    )) as { result: string };
    expect(out.result).toBe("not_owned");
  });

  it("product.delete_listing returns not_implemented when adapter omits softDelete", async () => {
    const reg = new McpRegistry();
    registerSellerWriteTools(reg, fakeAdapter);
    await expect(
      reg.invoke("product.delete_listing", { productId: "prd_1" }, ctx()),
    ).rejects.toThrow(/not_implemented/);
  });

  it("product.update_listing patches a product the calling agent owns", async () => {
    const reg = new McpRegistry();
    const updateAdapter: SellerWriteAdapter = {
      ...fakeAdapter,
      products: {
        ...fakeAdapter.products,
        getOwner: async (productId) => {
          expect(productId).toBe("prd_existing");
          return { sellerId: "slr_1", ownerAgentId: "agt_1" };
        },
        update: async (productId, patch) => {
          expect(productId).toBe("prd_existing");
          expect(patch.title).toBe("New Title");
          expect(patch.variants?.[0]?.inStock).toBe(false);
          return {
            productId,
            sellerId: "slr_1",
            titleSanitized: "New Title",
            variants: [{
              id: "var_1",
              sku: patch.variants![0]!.sku,
              priceMinor: patch.variants![0]!.priceMinor,
              currency: patch.variants![0]!.currency,
              inStock: patch.variants![0]!.inStock ?? true,
            }],
          };
        },
      },
    };
    process.env.MARKETPLACE_WEB_BASE_URL = "https://example.test";
    registerSellerWriteTools(reg, updateAdapter);

    const out = (await reg.invoke(
      "product.update_listing",
      {
        productId: "prd_existing",
        title: "New Title",
        variants: [{ sku: "sku-1", priceMinor: 9999, currency: "USD", inStock: false }],
      },
      ctx(),
    )) as { title: string; productUrl?: string; variants: Array<{ inStock: boolean }> };
    expect(out.title).toBe("New Title");
    expect(out.productUrl).toBe("https://example.test/product/prd_existing");
    expect(out.variants[0]?.inStock).toBe(false);
  });

  it("product.update_listing rejects when calling agent does not own the product", async () => {
    const reg = new McpRegistry();
    const updateAdapter: SellerWriteAdapter = {
      ...fakeAdapter,
      products: {
        ...fakeAdapter.products,
        getOwner: async () => ({ sellerId: "slr_other", ownerAgentId: "agt_other" }),
        update: async () => { throw new Error("update should not be reached"); },
      },
    };
    registerSellerWriteTools(reg, updateAdapter);
    await expect(
      reg.invoke(
        "product.update_listing",
        { productId: "prd_other", title: "Hijack Attempt" },
        ctx(),
      ),
    ).rejects.toThrow(/not_seller_owner/);
  });

  it("product.update_listing returns not_implemented when adapter omits update/getOwner", async () => {
    const reg = new McpRegistry();
    registerSellerWriteTools(reg, fakeAdapter);
    await expect(
      reg.invoke("product.update_listing", { productId: "prd_1", title: "Whatever" }, ctx()),
    ).rejects.toThrow(/not_implemented/);
  });

  it("product.update_listing requires at least one field beyond productId", async () => {
    const reg = new McpRegistry();
    registerSellerWriteTools(reg, fakeAdapter);
    await expect(
      reg.invoke("product.update_listing", { productId: "prd_1" }, ctx()),
    ).rejects.toThrow(/at_least_one_field_to_update/);
  });

  it("seller.list_mine returns owned shops newest-first when the adapter implements listOwnedBy", async () => {
    const reg = new McpRegistry();
    const adapterWithList: SellerWriteAdapter = {
      ...fakeAdapter,
      sellers: {
        ...fakeAdapter.sellers,
        listOwnedBy: async (ownerAgentId) => {
          expect(ownerAgentId).toBe("agt_1");
          return [
            { sellerId: "slr_b", displayName: "Newer Shop", countryCode: "DZ", city: "Oran", createdAt: 1_700_000_002_000 },
            { sellerId: "slr_a", displayName: "Older Shop", countryCode: "DZ", createdAt: 1_700_000_000_000 },
          ];
        },
      },
    };
    process.env.MARKETPLACE_WEB_BASE_URL = "https://example.test";
    registerSellerWriteTools(reg, adapterWithList);

    const out = (await reg.invoke("seller.list_mine", {}, ctx())) as {
      data: Array<{ sellerId: string; displayName: string; storeUrl?: string; city: string | null }>;
    };
    expect(out.data).toHaveLength(2);
    expect(out.data[0]?.sellerId).toBe("slr_b");
    expect(out.data[0]?.storeUrl).toBe("https://example.test/store/slr_b");
    expect(out.data[1]?.city).toBeNull();
  });

  it("seller.create_account duplicate-name error tells the agent to use the returned sellerId or seller.list_mine", async () => {
    const reg = new McpRegistry();
    const adapterWithDup: SellerWriteAdapter = {
      ...fakeAdapter,
      sellers: {
        ...fakeAdapter.sellers,
        findOwnedByName: async (ownerAgentId, displayName) => {
          expect(ownerAgentId).toBe("agt_1");
          expect(displayName).toBe("Tor Store");
          return { sellerId: "slr_existing" };
        },
      },
    };
    registerSellerWriteTools(reg, adapterWithDup);
    await expect(
      reg.invoke(
        "seller.create_account",
        { displayName: "Tor Store", phone: "+213500000000", countryCode: "DZ" },
        ctx(),
      ),
    ).rejects.toThrow(/duplicate_store_name[\s\S]*slr_existing[\s\S]*seller\.list_mine/);
  });

  it("seller.list_mine returns not_implemented when the adapter omits listOwnedBy", async () => {
    const reg = new McpRegistry();
    registerSellerWriteTools(reg, fakeAdapter);
    await expect(
      reg.invoke("seller.list_mine", {}, ctx()),
    ).rejects.toThrow(/not_implemented/);
  });

  it("omits snapshotUrl when no snapshot store is configured", async () => {
    const reg = new McpRegistry();
    registerSellerWriteTools(reg, fakeAdapter);

    const out = (await reg.invoke(
      "seller.create_account",
      { displayName: "Tor Store", phone: "+213500000000", countryCode: "DZ" },
      ctx(),
    )) as { snapshotUrl?: string };
    expect(out.snapshotUrl).toBeUndefined();
  });
});
