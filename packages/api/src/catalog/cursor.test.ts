import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor.js";

describe("cursor encode/decode", () => {
  it("round-trips a typical {k, id} cursor", () => {
    const c = { k: "1500000", id: "01999999-9999-7999-9999-000000000001" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("handles a BigInt-stringified key (price-sorted)", () => {
    const c = { k: "99999999999999", id: "p-1" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("decodes a key that itself contains special characters (e.g. relevance scores)", () => {
    const c = { k: '0.987|"tie"', id: "p-1" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("decode returns undefined for undefined input (no cursor on first page)", () => {
    expect(decodeCursor(undefined)).toBeUndefined();
  });

  it("decode returns undefined for a malformed cursor (truncated / not base64url)", () => {
    expect(decodeCursor("not-a-cursor")).toBeUndefined();
    expect(decodeCursor("@@@@")).toBeUndefined();
  });

  it("decode rejects a cursor missing required fields (defensive against tampering)", () => {
    const bad = Buffer.from(JSON.stringify({ k: 123, id: "x" })).toString("base64url");
    expect(decodeCursor(bad)).toBeUndefined();
    const bad2 = Buffer.from(JSON.stringify({ k: "key" })).toString("base64url");
    expect(decodeCursor(bad2)).toBeUndefined();
  });

  it("encodes to base64url (URL-safe — no `=`, `+`, or `/` characters)", () => {
    const out = encodeCursor({ k: "k+key/with==pad", id: "id+/=" });
    expect(out).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects an oversize cursor (DoS guard)", () => {
    // A legitimate cursor is ~100 bytes; anything past 1KB cannot have been
    // issued by us. Decoding refuses without paying the JSON.parse cost.
    const huge = "A".repeat(2000);
    expect(decodeCursor(huge)).toBeUndefined();
  });

  it("rejects a cursor with oversize k/id fields", () => {
    const longK = Buffer.from(
      JSON.stringify({ k: "x".repeat(300), id: "p1" }),
    ).toString("base64url");
    const longId = Buffer.from(
      JSON.stringify({ k: "1", id: "x".repeat(300) }),
    ).toString("base64url");
    expect(decodeCursor(longK)).toBeUndefined();
    expect(decodeCursor(longId)).toBeUndefined();
  });
});
