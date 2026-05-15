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

  it("rejects an empty verifier (RFC 7636 length floor)", () => {
    // Without the length check, an attacker could submit "" plus the well-known
    // SHA-256 challenge of "" and pass — the binding to the original challenge
    // is meaningless without verifier entropy.
    const emptyChallenge = codeChallengeS256("");
    expect(verifyPkce("", emptyChallenge, "S256")).toBe(false);
  });

  it("rejects a verifier shorter than 43 chars (RFC 7636)", () => {
    const short = "abc";
    expect(verifyPkce(short, codeChallengeS256(short), "S256")).toBe(false);
  });

  it("rejects a verifier with disallowed characters", () => {
    // 43 chars but contains `+/=` (not in the unreserved set).
    const bad = "a".repeat(40) + "+/=";
    expect(verifyPkce(bad, codeChallengeS256(bad), "S256")).toBe(false);
  });
});
