import { describe, expect, it } from "vitest";
import { addLine, MAX_QTY_PER_LINE, removeLine, totalsFor, updateLineQty, type CartLine } from "../src/cart/cart.js";

const line = (overrides: Partial<CartLine> = {}): CartLine => ({
  variantId: "v1",
  sellerId: "s1",
  qty: 1,
  unitPriceMinor: 100_00n,
  ...overrides,
});

describe("addLine", () => {
  it("appends a new variant", () => {
    const out = addLine([], line());
    expect(out).toHaveLength(1);
  });

  it("merges qty for existing variant", () => {
    const out = addLine([line({ qty: 2 })], line({ qty: 3 }));
    expect(out).toHaveLength(1);
    expect(out[0]?.qty).toBe(5);
  });

  it("rejects qty ≤ 0", () => {
    expect(() => addLine([], line({ qty: 0 }))).toThrow();
  });

  it("rejects different seller for same variant", () => {
    expect(() => addLine([line()], line({ sellerId: "s2" }))).toThrow(/variant<->seller_mismatch|seller/);
  });

  it("rejects non-positive unitPriceMinor", () => {
    expect(() => addLine([], line({ unitPriceMinor: 0n }))).toThrow(/unitPriceMinor/);
    expect(() => addLine([], line({ unitPriceMinor: -1n }))).toThrow(/unitPriceMinor/);
  });

  it("rejects qty above MAX_QTY_PER_LINE", () => {
    expect(() => addLine([], line({ qty: MAX_QTY_PER_LINE + 1 }))).toThrow(/must be ≤/);
  });

  it("rejects merge that would push qty above MAX_QTY_PER_LINE", () => {
    expect(() =>
      addLine(
        [line({ qty: MAX_QTY_PER_LINE - 1 })],
        line({ qty: 5 }),
      ),
    ).toThrow(/exceeds/);
  });

  it("rejects a second add at a different unit price (stale-price guard)", () => {
    // Previous behaviour silently re-priced the already-added units. The
    // caller now has to surface the new price to the buyer before re-adding.
    expect(() =>
      addLine([line({ unitPriceMinor: 100_00n })], line({ unitPriceMinor: 200_00n })),
    ).toThrow(/cart_line_price_changed/);
  });
});

describe("updateLineQty", () => {
  it("removes line when qty=0", () => {
    expect(updateLineQty([line()], "v1", 0)).toEqual([]);
  });

  it("updates qty in place", () => {
    expect(updateLineQty([line()], "v1", 7)[0]?.qty).toBe(7);
  });

  it("throws on missing variant", () => {
    expect(() => updateLineQty([line()], "v2", 1)).toThrow();
  });
});

describe("removeLine", () => {
  it("filters out the variant", () => {
    expect(removeLine([line(), line({ variantId: "v2" })], "v1").map((l) => l.variantId)).toEqual(["v2"]);
  });
});

describe("totalsFor", () => {
  it("sums lines and adds tax+shipping", () => {
    const t = totalsFor({
      cartId: "c1",
      currency: "USD",
      lines: [line({ qty: 2, unitPriceMinor: 50_00n })],
      shippingMinor: 5_00n,
      taxMinor: 8_25n,
    });
    expect(t.subtotalMinor).toBe(100_00n);
    expect(t.totalMinor).toBe(100_00n + 5_00n + 8_25n);
  });

  it("rejects discount exceeding subtotal", () => {
    expect(() =>
      totalsFor({
        cartId: "c1",
        currency: "USD",
        lines: [line()],
        discountMinor: 200_00n,
      }),
    ).toThrow();
  });
});
