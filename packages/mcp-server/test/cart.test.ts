import { describe, expect, it } from "vitest";
import { McpRegistry, type McpContext } from "../src/registry.js";
import { registerCartTools } from "../src/tools/cart.js";

function ctx(scopes: string[]): McpContext {
  return {
    agentId: "agt_1",
    passportId: "psp_1",
    scopes: new Set(scopes),
    ownerKind: "user",
    ownerId: "usr_1",
    requestId: "req_1",
    now: () => 0,
    emitAudit: async () => {},
  };
}

const NOW = new Date("2026-05-04T18:00:00Z");
const PAST = new Date("2025-01-01T00:00:00Z");

const carriers = [{ key: "default", prohibitedItems: [] }];

const baseBuyer = {
  shipToCountry: "US",
  isSanctionedParty: false,
  carriersAvailable: carriers,
};

const baseLine = {
  productId: "p1",
  listingId: "l1",
  taxonomyKeys: ["apparel/shirts"],
  isHazmat: false,
  isAgeRestricted: false,
  countryOfOrigin: "US",
};

const reg = (): McpRegistry => {
  const r = new McpRegistry();
  registerCartTools(r);
  return r;
};

const invoke = (input: unknown) =>
  reg().invoke("cart.check_restrictions", input, ctx(["cart:write"]));

describe("cart.check_restrictions", () => {
  it("allows a benign cart line in a benign jurisdiction", async () => {
    const out = (await invoke({
      lines: [baseLine],
      buyer: baseBuyer,
      rules: [],
      now: NOW.toISOString(),
    })) as { allowed: boolean; results: Array<{ allowed: boolean }> };
    expect(out.allowed).toBe(true);
    expect(out.results[0]?.allowed).toBe(true);
  });

  it("classifies a sanctioned-party block as hard", async () => {
    const out = (await invoke({
      lines: [baseLine],
      buyer: { ...baseBuyer, isSanctionedParty: true },
      rules: [],
      now: NOW.toISOString(),
    })) as { allowed: boolean; results: Array<{ reason: string; reasonClass: string }> };
    expect(out.allowed).toBe(false);
    expect(out.results[0]?.reason).toBe("buyer_sanctioned_party");
    expect(out.results[0]?.reasonClass).toBe("hard");
  });

  it("classifies an age block as recoverable and surfaces rule version", async () => {
    const rule = {
      taxonomyKey: "alcohol",
      countryCode: "US",
      restrictionKind: "age_restricted",
      minAge: 21,
      effectiveFrom: PAST.toISOString(),
      registryVersion: "rules-v42",
    };
    const out = (await invoke({
      lines: [{ ...baseLine, taxonomyKeys: ["alcohol"], isAgeRestricted: true }],
      buyer: baseBuyer,
      rules: [rule],
      now: NOW.toISOString(),
    })) as {
      allowed: boolean;
      results: Array<{ reason: string; reasonClass: string; triggeredRuleVersion?: string; triggeredTaxonomyKey?: string }>;
    };
    expect(out.allowed).toBe(false);
    expect(out.results[0]?.reason).toBe("age_verification_required_21");
    expect(out.results[0]?.reasonClass).toBe("recoverable");
    expect(out.results[0]?.triggeredRuleVersion).toBe("rules-v42");
    expect(out.results[0]?.triggeredTaxonomyKey).toBe("alcohol");
  });

  it("blocks ITAR-classified item shipping outside US (hard)", async () => {
    const rule = {
      taxonomyKey: "defense",
      countryCode: "FR",
      restrictionKind: "export_controlled",
      effectiveFrom: PAST.toISOString(),
      registryVersion: "rules-v42",
    };
    const out = (await invoke({
      lines: [
        {
          ...baseLine,
          taxonomyKeys: ["defense"],
          exportControlClass: "ITAR-Cat-IV",
        },
      ],
      buyer: { ...baseBuyer, shipToCountry: "FR" },
      rules: [rule],
      now: NOW.toISOString(),
    })) as { results: Array<{ reason: string; reasonClass: string }> };
    expect(out.results[0]?.reason).toBe("itar_destination_blocked");
    expect(out.results[0]?.reasonClass).toBe("hard");
  });

  it("returns per-line results so a cart with one bad item doesn't hide the others", async () => {
    const rule = {
      taxonomyKey: "weapons",
      countryCode: "US",
      restrictionKind: "prohibited",
      effectiveFrom: PAST.toISOString(),
      registryVersion: "rules-v42",
    };
    const out = (await invoke({
      lines: [
        baseLine,
        { ...baseLine, productId: "p2", listingId: "l2", taxonomyKeys: ["weapons/handguns"] },
      ],
      buyer: baseBuyer,
      rules: [rule],
      now: NOW.toISOString(),
    })) as {
      allowed: boolean;
      results: Array<{ productId: string; allowed: boolean; reason?: string }>;
    };
    expect(out.allowed).toBe(false);
    expect(out.results[0]?.allowed).toBe(true);
    expect(out.results[1]?.allowed).toBe(false);
    expect(out.results[1]?.reason).toBe("prohibited_in_jurisdiction");
  });

  it("flags carrier-only blocks as recoverable", async () => {
    const rule = {
      taxonomyKey: "aerosol",
      countryCode: "US",
      restrictionKind: "carrier_prohibited",
      effectiveFrom: PAST.toISOString(),
      registryVersion: "rules-v42",
    };
    const out = (await invoke({
      lines: [{ ...baseLine, taxonomyKeys: ["aerosol"] }],
      buyer: {
        ...baseBuyer,
        carriersAvailable: [{ key: "only-carrier", prohibitedItems: ["aerosol"] }],
      },
      rules: [rule],
      now: NOW.toISOString(),
    })) as { results: Array<{ reason: string; reasonClass: string }> };
    expect(out.results[0]?.reason).toBe("no_carrier_available");
    expect(out.results[0]?.reasonClass).toBe("recoverable");
  });

  it("denies invocation without cart:write scope", async () => {
    const r = reg();
    await expect(
      r.invoke(
        "cart.check_restrictions",
        { lines: [baseLine], buyer: baseBuyer, rules: [], now: NOW.toISOString() },
        ctx([]),
      ),
    ).rejects.toThrow(/missing_scope:cart:write/);
  });

  it("rejects empty lines array", async () => {
    await expect(
      invoke({ lines: [], buyer: baseBuyer, rules: [], now: NOW.toISOString() }),
    ).rejects.toThrow();
  });
});
