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
