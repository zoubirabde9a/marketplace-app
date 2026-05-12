import { describe, expect, it } from "vitest";
import { deterministicCheckoutKey } from "./cart";

describe("deterministicCheckoutKey", () => {
  const baseCart = "01999999-9999-7999-9999-000000000001";
  const baseCustomer = { name: "Lila M", phone: "+213555000555", region: "Tlemcen" };

  it("is stable across calls with identical inputs (the double-submit case)", async () => {
    const a = await deterministicCheckoutKey(baseCart, baseCustomer);
    const b = await deterministicCheckoutKey(baseCart, baseCustomer);
    expect(a).toBe(b);
  });

  it("ignores incidental whitespace on customer fields", async () => {
    const trimmed = await deterministicCheckoutKey(baseCart, baseCustomer);
    const padded = await deterministicCheckoutKey(baseCart, {
      name: "  Lila M  ",
      phone: " +213555000555 ",
      region: "Tlemcen ",
    });
    expect(padded).toBe(trimmed);
  });

  it("differs when the cart changes", async () => {
    const a = await deterministicCheckoutKey(baseCart, baseCustomer);
    const b = await deterministicCheckoutKey("01999999-9999-7999-9999-000000000002", baseCustomer);
    expect(a).not.toBe(b);
  });

  it("differs when any customer field changes", async () => {
    const base = await deterministicCheckoutKey(baseCart, baseCustomer);
    const diffName = await deterministicCheckoutKey(baseCart, { ...baseCustomer, name: "Lila R" });
    const diffPhone = await deterministicCheckoutKey(baseCart, { ...baseCustomer, phone: "+213555000999" });
    const diffRegion = await deterministicCheckoutKey(baseCart, { ...baseCustomer, region: "Alger" });
    expect(diffName).not.toBe(base);
    expect(diffPhone).not.toBe(base);
    expect(diffRegion).not.toBe(base);
  });

  it("returns a hex-only string of length 64 (SHA-256)", async () => {
    const k = await deterministicCheckoutKey(baseCart, baseCustomer);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
});
