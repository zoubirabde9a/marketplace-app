import { describe, expect, it } from "vitest";
import { isUuidv7, newId, timestampFromUuidv7, uuidv7 } from "../src/ids.js";

describe("uuidv7", () => {
  it("produces a valid v7 UUID", () => {
    const id = uuidv7();
    expect(isUuidv7(id)).toBe(true);
  });

  it("encodes the timestamp in the high bits", () => {
    const at = 1_700_000_000_000;
    const id = uuidv7(at);
    expect(timestampFromUuidv7(id)).toBe(at);
  });

  it("is monotonically increasing across millisecond boundaries", () => {
    const a = uuidv7(1);
    const b = uuidv7(2);
    expect(a < b).toBe(true);
  });

  it("newId prefixes with the requested label", () => {
    const id = newId("agt");
    expect(id.startsWith("agt_")).toBe(true);
    expect(isUuidv7(id.slice(4))).toBe(true);
  });
});
