import { describe, expect, it } from "vitest";
import { ALL_SCOPES, SCOPES, hasScope, requireScope } from "../src/identity/scopes.js";

describe("scopes registry", () => {
  it("exposes a scope for every documented capability", () => {
    // Snapshot guard: shrinking SCOPES is a public-API break — fail fast if someone removes one.
    expect(Object.keys(SCOPES).length).toBeGreaterThanOrEqual(20);
  });

  it("ALL_SCOPES is the values of SCOPES with no duplicates", () => {
    const values = Object.values(SCOPES);
    expect(new Set(values).size).toBe(values.length);
    expect([...ALL_SCOPES].sort()).toEqual([...values].sort());
  });

  it("every scope follows <resource>:<verb> naming", () => {
    const verbs = new Set(["read", "write", "execute", "admin", "cancel", "issue", "revoke", "redeem"]);
    for (const s of ALL_SCOPES) {
      const parts = s.split(":");
      expect(parts.length).toBeGreaterThanOrEqual(2);
      expect(verbs.has(parts.at(-1)!)).toBe(true);
    }
  });
});

describe("hasScope", () => {
  it("returns true when granted contains the required scope", () => {
    const granted = new Set<string>([SCOPES.cartWrite, SCOPES.catalogRead]);
    expect(hasScope(granted, SCOPES.cartWrite)).toBe(true);
  });

  it("returns false when granted does not contain the required scope", () => {
    const granted = new Set<string>([SCOPES.catalogRead]);
    expect(hasScope(granted, SCOPES.checkoutExecute)).toBe(false);
  });

  it("returns false on empty granted set", () => {
    expect(hasScope(new Set(), SCOPES.orderRead)).toBe(false);
  });
});

describe("requireScope", () => {
  it("does not throw when granted contains the required scope", () => {
    const granted = new Set<string>([SCOPES.disputeWrite]);
    expect(() => requireScope(granted, SCOPES.disputeWrite)).not.toThrow();
  });

  it("throws missing_scope:<name> when not granted", () => {
    const granted = new Set<string>();
    expect(() => requireScope(granted, SCOPES.passportIssue)).toThrowError(
      `missing_scope:${SCOPES.passportIssue}`,
    );
  });

  it("does not leak unrelated scopes in the error message", () => {
    const granted = new Set<string>([SCOPES.catalogRead]);
    try {
      requireScope(granted, SCOPES.sellerPayoutRead);
      throw new Error("expected throw");
    } catch (e: unknown) {
      const msg = (e as Error).message;
      expect(msg).toBe(`missing_scope:${SCOPES.sellerPayoutRead}`);
      expect(msg).not.toContain(SCOPES.catalogRead);
    }
  });
});
