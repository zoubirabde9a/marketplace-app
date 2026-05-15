import { describe, expect, it } from "vitest";
import { allowedOrderEventKinds, applyEvent, canTransition, isTerminal } from "../src/order/state-machine.js";
import { generatePublicNumber, PUBLIC_NUMBER_REGEX } from "../src/order/public-number.js";

describe("order state machine", () => {
  it("walks the happy path", () => {
    let s: import("../src/order/state-machine.js").OrderStatus = "created";
    s = applyEvent(s, { kind: "authorize" });
    s = applyEvent(s, { kind: "capture" });
    s = applyEvent(s, { kind: "begin_fulfillment" });
    s = applyEvent(s, { kind: "ship" });
    s = applyEvent(s, { kind: "deliver" });
    expect(s).toBe("delivered");
  });

  it("rejects illegal transitions", () => {
    expect(() => applyEvent("delivered", { kind: "ship" })).toThrow(/invalid_transition/);
    expect(() => applyEvent("cancelled", { kind: "refund", amountMinor: 0n })).toThrow();
  });

  it("allows refund from any post-paid status", () => {
    expect(canTransition("paid", "refund")).toBe(true);
    expect(canTransition("shipped", "refund")).toBe(true);
    expect(canTransition("delivered", "refund")).toBe(true);
  });

  it("cancel only valid pre-fulfillment", () => {
    expect(canTransition("created", "cancel")).toBe(true);
    expect(canTransition("authorized", "cancel")).toBe(true);
    expect(canTransition("fulfilling", "cancel")).toBe(true);
    expect(canTransition("delivered", "cancel")).toBe(false);
  });

  it("cancelled is terminal", () => {
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("delivered")).toBe(false);
  });

  it("allowedOrderEventKinds enumerates what would apply cleanly", () => {
    expect(allowedOrderEventKinds("created").sort()).toEqual(["authorize", "cancel"].sort());
    expect(allowedOrderEventKinds("paid").sort()).toEqual(
      ["begin_fulfillment", "cancel", "open_dispute", "refund"].sort(),
    );
    expect(allowedOrderEventKinds("delivered").sort()).toEqual(
      ["open_dispute", "refund"].sort(),
    );
    expect(allowedOrderEventKinds("cancelled")).toEqual([]);
  });
});

describe("generatePublicNumber", () => {
  it("matches MP-YYMMDD-XXXXXX format", () => {
    const n = generatePublicNumber(new Date("2026-05-03T12:00:00Z"));
    expect(n).toMatch(PUBLIC_NUMBER_REGEX);
    expect(n.startsWith("MP-260503-")).toBe(true);
  });
});
