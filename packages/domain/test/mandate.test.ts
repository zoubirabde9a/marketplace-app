import { describe, expect, it } from "vitest";
import { generateKeyPairSync, createPublicKey } from "node:crypto";
import {
  canonicalCartHash,
  signMandate,
  verifyMandate,
  type MandateClaims,
} from "../src/payment/mandate.js";
import { enforceMandate } from "../src/payment/mandate-enforce.js";

function key() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicKey, privateKey };
}

const baseClaims = (overrides: Partial<MandateClaims> = {}): MandateClaims => ({
  kind: "cart",
  iss: "https://marketplace.dev",
  sub: "agt_1",
  aud: "marketplace",
  jti: "mnd_1",
  iat: 1_700_000_000,
  exp: 1_700_000_000 + 600,
  step_up_tier: 3,
  step_up_proof_at: 1_700_000_000_000,
  cap: { currency: "USD", amount_minor: "50000" },
  cart_hash: "deadbeef",
  signing_jwk: { kty: "OKP", crv: "Ed25519", x: "x" },
  ...overrides,
});

describe("verifyMandate", () => {
  it("accepts a signed cart mandate", async () => {
    const k = key();
    const jwt = signMandate(baseClaims(), k.privateKey, "kid-1");
    const result = await verifyMandate(jwt, {
      audience: "marketplace",
      now: 1_700_000_000_000 + 1000,
      resolveSignerKey: async () => k.publicKey,
      isRevoked: async () => false,
    });
    expect(result.claims.sub).toBe("agt_1");
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects expired mandate", async () => {
    const k = key();
    const jwt = signMandate(baseClaims({ exp: 1 }), k.privateKey, "kid-1");
    await expect(
      verifyMandate(jwt, {
        audience: "marketplace",
        now: 1_700_000_000_000,
        resolveSignerKey: async () => k.publicKey,
        isRevoked: async () => false,
      }),
    ).rejects.toThrow(/expired/);
  });

  it("rejects bad signature (different signer)", async () => {
    const a = key();
    const b = key();
    const jwt = signMandate(baseClaims(), a.privateKey, "kid-1");
    await expect(
      verifyMandate(jwt, {
        audience: "marketplace",
        now: 1_700_000_000_000 + 1000,
        resolveSignerKey: async () => b.publicKey,
        isRevoked: async () => false,
      }),
    ).rejects.toThrow(/signature/);
  });

  it("rejects revoked mandate", async () => {
    const k = key();
    const jwt = signMandate(baseClaims(), k.privateKey, "kid-1");
    await expect(
      verifyMandate(jwt, {
        audience: "marketplace",
        now: 1_700_000_000_000 + 1000,
        resolveSignerKey: async () => k.publicKey,
        isRevoked: async () => true,
      }),
    ).rejects.toThrow(/revoked/);
  });

  it("requires step-up proof for tier ≥ 4", async () => {
    const k = key();
    const claims = baseClaims({ step_up_tier: 4, step_up_proof_at: undefined as unknown as number });
    delete (claims as { step_up_proof_at?: number }).step_up_proof_at;
    const jwt = signMandate(claims, k.privateKey, "kid-1");
    await expect(
      verifyMandate(jwt, {
        audience: "marketplace",
        now: 1_700_000_000_000 + 1000,
        resolveSignerKey: async () => k.publicKey,
        isRevoked: async () => false,
      }),
    ).rejects.toThrow(/step_up/);
  });
});

describe("enforceMandate", () => {
  const claims = baseClaims({
    constraints: {
      merchants: ["org_1"],
      categories: ["electronics"],
      jurisdictions: ["US"],
      maxItems: 10,
    },
  });

  it("passes for matching purchase", () => {
    expect(() =>
      enforceMandate(claims, {
        agentId: "agt_1",
        amountMinor: 100_00n,
        currency: "USD",
        merchantIds: ["org_1"],
        categoryIds: ["electronics"],
        shipToCountry: "US",
        itemCount: 2,
        cartHash: "deadbeef",
        now: Date.now(),
      }),
    ).not.toThrow();
  });

  it("rejects merchant outside allowlist", () => {
    expect(() =>
      enforceMandate(claims, {
        agentId: "agt_1",
        amountMinor: 100_00n,
        currency: "USD",
        merchantIds: ["org_2"],
        categoryIds: ["electronics"],
        shipToCountry: "US",
        itemCount: 1,
        cartHash: "deadbeef",
        now: Date.now(),
      }),
    ).toThrow(/merchant_not_allowed/);
  });

  it("rejects when amount exceeds cap", () => {
    expect(() =>
      enforceMandate(claims, {
        agentId: "agt_1",
        amountMinor: 600_00n,
        currency: "USD",
        merchantIds: ["org_1"],
        categoryIds: ["electronics"],
        shipToCountry: "US",
        itemCount: 1,
        cartHash: "deadbeef",
        now: Date.now(),
      }),
    ).toThrow(/amount_exceeds_cap/);
  });

  it("rejects on cart hash mismatch", () => {
    expect(() =>
      enforceMandate(claims, {
        agentId: "agt_1",
        amountMinor: 100_00n,
        currency: "USD",
        merchantIds: ["org_1"],
        categoryIds: ["electronics"],
        shipToCountry: "US",
        itemCount: 1,
        cartHash: "different",
        now: Date.now(),
      }),
    ).toThrow(/cart_hash_mismatch/);
  });

  it("rejects ship-to outside jurisdictions", () => {
    expect(() =>
      enforceMandate(claims, {
        agentId: "agt_1",
        amountMinor: 100_00n,
        currency: "USD",
        merchantIds: ["org_1"],
        categoryIds: ["electronics"],
        shipToCountry: "FR",
        itemCount: 1,
        cartHash: "deadbeef",
        now: Date.now(),
      }),
    ).toThrow(/jurisdiction_not_allowed/);
  });
});

describe("canonicalCartHash", () => {
  it("is order-independent", () => {
    const a = canonicalCartHash({
      cartId: "c1",
      currency: "USD",
      items: [
        { variantId: "v2", qty: 1, unitPriceMinor: 200n, sellerId: "s1" },
        { variantId: "v1", qty: 2, unitPriceMinor: 100n, sellerId: "s1" },
      ],
      shippingMinor: 50n,
      taxMinor: 10n,
      totalMinor: 460n,
    });
    const b = canonicalCartHash({
      cartId: "c1",
      currency: "USD",
      items: [
        { variantId: "v1", qty: 2, unitPriceMinor: 100n, sellerId: "s1" },
        { variantId: "v2", qty: 1, unitPriceMinor: 200n, sellerId: "s1" },
      ],
      shippingMinor: 50n,
      taxMinor: 10n,
      totalMinor: 460n,
    });
    expect(a).toBe(b);
  });

  it("differs when amounts change", () => {
    const a = canonicalCartHash({
      cartId: "c1",
      currency: "USD",
      items: [{ variantId: "v1", qty: 1, unitPriceMinor: 100n, sellerId: "s1" }],
      shippingMinor: 0n,
      taxMinor: 0n,
      totalMinor: 100n,
    });
    const b = canonicalCartHash({
      cartId: "c1",
      currency: "USD",
      items: [{ variantId: "v1", qty: 1, unitPriceMinor: 200n, sellerId: "s1" }],
      shippingMinor: 0n,
      taxMinor: 0n,
      totalMinor: 200n,
    });
    expect(a).not.toBe(b);
  });
});
