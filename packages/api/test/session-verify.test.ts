// Verifies that session / link-token verification doesn't leak signer-key
// registry info via distinct error codes for unknown-kid vs bad-signature.
// Attackers forging tokens used to be able to map which kids the platform
// knows about (resolveKey returning undefined → distinct `unknown_kid`
// error; resolveKey returning a key → `signature` error). Both paths now
// throw the same `*_signature` error.

import { describe, expect, it } from "vitest";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import {
  signSession,
  verifySession,
  signLinkToken,
  verifyLinkToken,
  type SessionClaims,
  type LinkTokenClaims,
} from "../src/auth/session.js";

function ed25519() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicKey, privateKey };
}

const baseSession: SessionClaims = {
  iss: "https://marketplace.dev",
  sub: "usr_1",
  email: "u@example.com",
  aud: "marketplace",
  iat: 1_700_000_000,
  exp: 1_700_000_000 + 600,
};

const baseLink: LinkTokenClaims = {
  iss: "https://marketplace.dev",
  sub: "usr_1",
  agent_id: "agt_1",
  passport_id: "psp_1",
  aud: "marketplace",
  iat: 1_700_000_000,
  exp: 1_700_000_000 + 600,
};

describe("verifySession — no kid-enumeration oracle", () => {
  it("throws session_signature (not session_unknown_kid) when resolveKey returns undefined", async () => {
    const k = ed25519();
    const jwt = signSession(baseSession, { kid: "kid-1", privateKey: k.privateKey });
    await expect(
      verifySession(jwt, {
        audience: "marketplace",
        now: 1_700_000_000_000 + 1000,
        resolveKey: async () => undefined as unknown as KeyObject,
      }),
    ).rejects.toThrow(/session_signature/);
    // And must NOT throw the prior distinct error.
    await expect(
      verifySession(jwt, {
        audience: "marketplace",
        now: 1_700_000_000_000 + 1000,
        resolveKey: async () => undefined as unknown as KeyObject,
      }),
    ).rejects.not.toThrow(/session_unknown_kid/);
  });

  it("still throws session_signature for an actual bad signature", async () => {
    const a = ed25519();
    const b = ed25519();
    const jwt = signSession(baseSession, { kid: "kid-1", privateKey: a.privateKey });
    await expect(
      verifySession(jwt, {
        audience: "marketplace",
        now: 1_700_000_000_000 + 1000,
        resolveKey: async () => b.publicKey,
      }),
    ).rejects.toThrow(/session_signature/);
  });
});

describe("verifyLinkToken — no kid-enumeration oracle", () => {
  it("throws link_signature (not link_unknown_kid) when resolveKey returns undefined", async () => {
    const k = ed25519();
    const jwt = signLinkToken(baseLink, { kid: "kid-1", privateKey: k.privateKey });
    await expect(
      verifyLinkToken(jwt, {
        audience: "marketplace",
        now: 1_700_000_000_000 + 1000,
        resolveKey: async () => undefined as unknown as KeyObject,
      }),
    ).rejects.toThrow(/link_signature/);
    await expect(
      verifyLinkToken(jwt, {
        audience: "marketplace",
        now: 1_700_000_000_000 + 1000,
        resolveKey: async () => undefined as unknown as KeyObject,
      }),
    ).rejects.not.toThrow(/link_unknown_kid/);
  });
});
