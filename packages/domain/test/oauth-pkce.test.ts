import { describe, expect, it } from "vitest";
import { codeChallengeS256, generateCodeVerifier, verifyPkce } from "../src/identity/oauth.js";

describe("PKCE", () => {
  it("computes the canonical S256 challenge", () => {
    // RFC 7636 Appendix B test vector
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(codeChallengeS256(verifier)).toBe(expected);
  });

  it("verifyPkce accepts a valid pair", () => {
    const v = generateCodeVerifier();
    const c = codeChallengeS256(v);
    expect(verifyPkce(v, c, "S256")).toBe(true);
  });

  it("verifyPkce rejects mismatch", () => {
    const a = generateCodeVerifier();
    const c = codeChallengeS256(generateCodeVerifier());
    expect(verifyPkce(a, c, "S256")).toBe(false);
  });
});
