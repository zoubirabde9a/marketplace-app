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

  it("rejects invocation of unknown skill", async () => {
    const reg = new A2ARegistry();
    await expect(reg.invoke("unknown", {}, ctx())).rejects.toThrow(/not_found/);
  });

  it("rejects invocation with bad input", async () => {
    const reg = new A2ARegistry();
    reg.register(negotiatePriceSkill);
    await expect(reg.invoke("negotiate_price", { nope: true }, ctx())).rejects.toThrow(
      /input_validation/,
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
    )) as { accepted: boolean; counterUnitPriceMinor: bigint; reason: string };
    expect(result.accepted).toBe(false);
    expect(result.counterUnitPriceMinor).toBe(800n);
    expect(result.reason).toBe("below_floor_price");
  });
});
