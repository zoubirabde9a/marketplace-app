import { describe, expect, it } from "vitest";
import { addMoney, money, mulMoney, subMoney } from "../src/money.js";

describe("money", () => {
  it("adds same-currency amounts", () => {
    const r = addMoney(money(199n, "USD"), money(301n, "USD"));
    expect(r.amountMinor).toBe(500n);
  });

  it("rejects cross-currency addition", () => {
    expect(() => addMoney(money(1n, "USD"), money(1n, "EUR"))).toThrow(/Currency mismatch/);
  });

  it("subtracts and refuses to go negative", () => {
    expect(subMoney(money(500n, "USD"), money(200n, "USD")).amountMinor).toBe(300n);
    expect(() => subMoney(money(1n, "USD"), money(2n, "USD"))).toThrow();
  });

  it("multiplies with banker's rounding", () => {
    expect(mulMoney(money(100n, "USD"), 0.075).amountMinor).toBe(8n);
  });
});
