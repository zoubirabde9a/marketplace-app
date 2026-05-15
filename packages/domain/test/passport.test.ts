import { describe, expect, it } from "vitest";
import {
  generateIssuerKey,
  signPassport,
  verifyPassport,
  type PassportClaims,
} from "../src/identity/passport.js";

const baseClaims = (overrides: Partial<PassportClaims> = {}): PassportClaims => ({
  iss: "https://marketplace.dev",
  sub: "agt_01",
  aud: "marketplace",
  jti: "psp_01",
  iat: 1_700_000_000,
  exp: 1_700_003_600,
  cnf: { jwk: { kty: "OKP", crv: "Ed25519", x: "abc" } },
  scopes: ["catalog:read"],
  spend_caps: { currency: "USD", per_tx_minor: "10000" },
  owner: { kind: "user", id: "usr_01" },
  ...overrides,
});

describe("passport sign/verify", () => {
  it("round-trips a valid passport", async () => {
    const key = generateIssuerKey("kid-1");
    const signed = signPassport(baseClaims(), key);

    const verified = await verifyPassport(signed.jwt, {
      audience: "marketplace",
      now: 1_700_000_000_000 + 1000,
      resolveIssuerKey: async (kid) => (kid === "kid-1" ? key.publicKey : undefined),
      isRevoked: async () => false,
    });
    expect(verified.sub).toBe("agt_01");
  });

  it("rejects unknown issuer (collapsed to signature error to close the kid-enumeration oracle, pass #153)", async () => {
    const key = generateIssuerKey("kid-1");
    const signed = signPassport(baseClaims(), key);
    await expect(
      verifyPassport(signed.jwt, {
        audience: "marketplace",
        now: 1_700_000_000_000 + 1000,
        resolveIssuerKey: async () => undefined,
        isRevoked: async () => false,
      }),
    ).rejects.toThrow(/passport_signature/);
  });

  it("rejects expired passport", async () => {
    const key = generateIssuerKey("kid-1");
    const signed = signPassport(baseClaims({ exp: 1 }), key);
    await expect(
      verifyPassport(signed.jwt, {
        audience: "marketplace",
        now: 1_700_000_000_000,
        resolveIssuerKey: async () => key.publicKey,
        isRevoked: async () => false,
      }),
    ).rejects.toThrow(/expired/);
  });

  it("rejects audience mismatch", async () => {
    const key = generateIssuerKey("kid-1");
    const signed = signPassport(baseClaims({ aud: "other" }), key);
    await expect(
      verifyPassport(signed.jwt, {
        audience: "marketplace",
        now: 1_700_000_000_000 + 1000,
        resolveIssuerKey: async () => key.publicKey,
        isRevoked: async () => false,
      }),
    ).rejects.toThrow(/audience/);
  });

  it("rejects revoked passport", async () => {
    const key = generateIssuerKey("kid-1");
    const signed = signPassport(baseClaims(), key);
    await expect(
      verifyPassport(signed.jwt, {
        audience: "marketplace",
        now: 1_700_000_000_000 + 1000,
        resolveIssuerKey: async () => key.publicKey,
        isRevoked: async () => true,
      }),
    ).rejects.toThrow(/revoked/);
  });
});
