import { describe, expect, it } from "vitest";
import { z } from "zod";
import { A2ARegistry, type A2AContext } from "../src/server.ts";
import { negotiatePriceSkill } from "../src/skills/negotiate.ts";

const ctx = (): A2AContext => ({
  fromAgentId: "buyer-1",
  toAgentId: "seller-1",
  dialogueId: "dlg-1",
  now: () => Date.now(),
});

describe("A2ARegistry", () => {
  it("registers and lists skills", () => {
    const reg = new A2ARegistry();
    reg.register(negotiatePriceSkill);
    expect(reg.has("negotiate_price")).toBe(true);
    expect(reg.list()).toEqual([
      expect.objectContaining({ name: "negotiate_price", scope: "negotiate:read" }),
    ]);
  });

  it("rejects duplicate registration", () => {
    const reg = new A2ARegistry();
    reg.register(negotiatePriceSkill);
    expect(() => reg.register(negotiatePriceSkill)).toThrow(/already_registered/);
  });

  it("rejects invocation of unknown skill (404 NotFoundError)", async () => {
    const reg = new A2ARegistry();
    // Error class is NotFoundError (HTTP 404) — title "a2a_skill not found".
    // Pre-fix this was a ConflictError (409) with message "a2a_skill_not_found:…",
    // which had the right substring but wrong HTTP status class.
    await expect(reg.invoke("unknown", {}, ctx())).rejects.toThrow(/not found/);
  });

  it("rejects invocation with bad input (400 ValidationError)", async () => {
    const reg = new A2ARegistry();
    reg.register(negotiatePriceSkill);
    // Bad input is ValidationError (HTTP 400) with structured per-field
    // issues, not a ConflictError. The thrown message contains the
    // standard "Validation failed" title plus the offending field path.
    await expect(reg.invoke("negotiate_price", { nope: true }, ctx())).rejects.toThrow(
      /Validation failed/,
    );
  });

  it("validates output via schema", () => {
    const reg = new A2ARegistry();
    reg.register({
      name: "echo_bad",
      description: "returns invalid output",
      scope: "test:read",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      handler: () => ({ ok: "yes" } as never),
    });
    return expect(reg.invoke("echo_bad", {}, ctx())).rejects.toThrow();
  });
});

describe("negotiate_price skill", () => {
  const policy = {
    sellerOrgId: "org-1",
    variantId: "v-1",
    floorPriceMinor: 800n,
    listPriceMinor: 1000n,
    currency: "USD",
    quantityBands: [{ minQty: 10, discountBps: 500 }],
  };

  it("accepts proposal within allowed band", async () => {
    const reg = new A2ARegistry();
    reg.register(negotiatePriceSkill);
    const result = (await reg.invoke(
      "negotiate_price",
      {
        policy,
        request: {
          buyerAgentId: "b-1",
          buyerSegments: [],
          qty: 10,
          proposedUnitPriceMinor: 950n,
          now: new Date().toISOString(),
        },
      },
      ctx(),
    )) as { accepted: boolean; reason: string };
    expect(result.accepted).toBe(true);
    expect(result.reason).toBe("within_allowed_discount_band");
  });

  it("returns counter-offer below floor", async () => {
    const reg = new A2ARegistry();
    reg.register(negotiatePriceSkill);
    const result = (await reg.invoke(
      "negotiate_price",
      {
        policy,
        request: {
          buyerAgentId: "b-1",
          buyerSegments: [],
          qty: 1,
          proposedUnitPriceMinor: 700n,
          now: new Date().toISOString(),
        },
      },
      ctx(),
    )) as { accepted: boolean; counterUnitPriceMinor?: bigint; reason: string };
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("below_floor_price");
    // Spec §7b: the floor is PRIVATE. Pre-fix the response returned
    // `counterUnitPriceMinor: floor` which leaked the floor to any
    // buyer probing with a token-low offer. Counter is now omitted on
    // below-floor rejections — the buyer iterates upward without
    // ever seeing the secret floor in the response.
    expect(result.counterUnitPriceMinor).toBeUndefined();
  });
});
