import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign, createHash, randomBytes } from "node:crypto";
import { verifyDpop, base64url } from "../src/identity/dpop.js";

async function makeDpopProof(opts: {
  htm: string;
  htu: string;
  iat?: number;
  jti?: string;
  accessToken?: string;
}): Promise<{ proof: string; jwk: Record<string, unknown> }> {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  const header = { alg: "EdDSA", typ: "dpop+jwt", jwk };
  const payload: Record<string, unknown> = {
    htm: opts.htm,
    htu: opts.htu,
    iat: opts.iat ?? Math.floor(Date.now() / 1000),
    jti: opts.jti ?? randomBytes(8).toString("hex"),
  };
  if (opts.accessToken) {
    payload["ath"] = base64url(createHash("sha256").update(opts.accessToken).digest());
  }
  const headerB64 = base64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
  const sig = sign(null, Buffer.from(`${headerB64}.${payloadB64}`), privateKey);
  return { proof: `${headerB64}.${payloadB64}.${base64url(sig)}`, jwk };
}

describe("verifyDpop", () => {
  it("accepts a fresh, well-formed proof", async () => {
    const { proof } = await makeDpopProof({ htm: "POST", htu: "https://api.x/v1/checkout" });
    const result = await verifyDpop(proof, {
      htm: "POST",
      htu: "https://api.x/v1/checkout",
      jtiSeen: async () => false,
      now: () => Date.now(),
    });
    expect(result.jkt).toBeTypeOf("string");
  });

  it("rejects htm mismatch", async () => {
    const { proof } = await makeDpopProof({ htm: "POST", htu: "https://api.x/v1/checkout" });
    await expect(
      verifyDpop(proof, {
        htm: "GET",
        htu: "https://api.x/v1/checkout",
        jtiSeen: async () => false,
        now: () => Date.now(),
      }),
    ).rejects.toThrow(/htm_mismatch/);
  });

  it("rejects htu mismatch", async () => {
    const { proof } = await makeDpopProof({ htm: "POST", htu: "https://api.x/v1/checkout" });
    await expect(
      verifyDpop(proof, {
        htm: "POST",
        htu: "https://api.x/v1/cart",
        jtiSeen: async () => false,
        now: () => Date.now(),
      }),
    ).rejects.toThrow(/htu_mismatch/);
  });

  it("rejects stale iat", async () => {
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const { proof } = await makeDpopProof({
      htm: "POST",
      htu: "https://api.x/v1/checkout",
      iat: stale,
    });
    await expect(
      verifyDpop(proof, {
        htm: "POST",
        htu: "https://api.x/v1/checkout",
        jtiSeen: async () => false,
        now: () => Date.now(),
      }),
    ).rejects.toThrow(/iat_out_of_window/);
  });

  it("rejects jti replay", async () => {
    const { proof } = await makeDpopProof({ htm: "POST", htu: "https://api.x/v1/checkout" });
    await expect(
      verifyDpop(proof, {
        htm: "POST",
        htu: "https://api.x/v1/checkout",
        jtiSeen: async () => true,
        now: () => Date.now(),
      }),
    ).rejects.toThrow(/jti_replay/);
  });

  it("verifies access-token binding via ath", async () => {
    const accessToken = "tok_xyz";
    const { proof } = await makeDpopProof({
      htm: "POST",
      htu: "https://api.x/v1/checkout",
      accessToken,
    });
    const result = await verifyDpop(proof, {
      htm: "POST",
      htu: "https://api.x/v1/checkout",
      accessToken,
      jtiSeen: async () => false,
      now: () => Date.now(),
    });
    expect(result.jkt).toBeTypeOf("string");
  });

  it("does NOT consume jti when signature fails (replay-cache DoS guard)", async () => {
    // An attacker submitting a forged proof must not be able to poison the
    // replay cache for a future legitimate proof reusing the same jti. The
    // jtiSeen callback should never fire when the signature is invalid.
    const { proof } = await makeDpopProof({ htm: "POST", htu: "https://api.x/v1/checkout" });
    // Tamper with the signature segment.
    const tampered = proof.replace(/\.[^.]+$/, ".AAAA");
    let jtiSeenCalls = 0;
    await expect(
      verifyDpop(tampered, {
        htm: "POST",
        htu: "https://api.x/v1/checkout",
        jtiSeen: async () => {
          jtiSeenCalls += 1;
          return false;
        },
        now: () => Date.now(),
      }),
    ).rejects.toThrow(/dpop_signature/);
    expect(jtiSeenCalls).toBe(0);
  });

  it("forged proof with htm mismatch reports signature failure (no oracle leak)", async () => {
    // Pre-fix, the function reported `htm_mismatch` before checking the
    // signature, letting an attacker probe payload checks without forging
    // a signature. Now the signature is the first gate.
    const { proof } = await makeDpopProof({ htm: "POST", htu: "https://api.x/v1/checkout" });
    const tampered = proof.replace(/\.[^.]+$/, ".AAAA");
    await expect(
      verifyDpop(tampered, {
        htm: "GET", // would have triggered htm_mismatch first under old order
        htu: "https://api.x/v1/checkout",
        jtiSeen: async () => false,
        now: () => Date.now(),
      }),
    ).rejects.toThrow(/dpop_signature/);
  });

  it("rejects mismatched access-token hash", async () => {
    const { proof } = await makeDpopProof({
      htm: "POST",
      htu: "https://api.x/v1/checkout",
      accessToken: "other_token",
    });
    await expect(
      verifyDpop(proof, {
        htm: "POST",
        htu: "https://api.x/v1/checkout",
        accessToken: "tok_xyz",
        jtiSeen: async () => false,
        now: () => Date.now(),
      }),
    ).rejects.toThrow(/ath_mismatch/);
  });
});
