import { describe, expect, it } from "vitest";
import { formatAlgerianPhoneNational, normalizeAlgerianPhone } from "../src/phone.js";

describe("normalizeAlgerianPhone", () => {
  const expected = "+213556685195";

  it.each([
    ["+213556685195"],
    ["+213 556 68 51 95"],
    ["+213-556-685-195"],
    ["00213556685195"],
    ["213556685195"],
    ["0556685195"],
    ["0556 68 51 95"],
    ["0556.68.51.95"],
    ["(0556) 685-195"],
    ["556685195"],
  ])("accepts %s and canonicalises to +213…", (input) => {
    expect(normalizeAlgerianPhone(input)).toBe(expected);
  });

  it("accepts fixed-line numbers (leading 2/3/4)", () => {
    expect(normalizeAlgerianPhone("0212345678")).toBe("+213212345678");
  });

  it("rejects inputs without a recognizable subscriber prefix", () => {
    expect(normalizeAlgerianPhone("0123456789")).toBeUndefined(); // leading 0/1 after country trim → "123456789", starts with 1
    expect(normalizeAlgerianPhone("0856685195")).toBeUndefined(); // leading 8
  });

  it("rejects non-DZ E.164 numbers", () => {
    expect(normalizeAlgerianPhone("+33612345678")).toBeUndefined();
    expect(normalizeAlgerianPhone("+15551112222")).toBeUndefined();
  });

  it("rejects garbage", () => {
    expect(normalizeAlgerianPhone("")).toBeUndefined();
    expect(normalizeAlgerianPhone("   ")).toBeUndefined();
    expect(normalizeAlgerianPhone("abc")).toBeUndefined();
    expect(normalizeAlgerianPhone("12345")).toBeUndefined();
    expect(normalizeAlgerianPhone(null)).toBeUndefined();
    expect(normalizeAlgerianPhone(undefined)).toBeUndefined();
  });
});

describe("formatAlgerianPhoneNational", () => {
  it("renders +213 numbers in 0XXX XX XX XX form", () => {
    expect(formatAlgerianPhoneNational("+213556685195")).toBe("0556 68 51 95");
  });
  it("passes through unrecognised values", () => {
    expect(formatAlgerianPhoneNational("+33612345678")).toBe("+33612345678");
    expect(formatAlgerianPhoneNational("")).toBe("");
    expect(formatAlgerianPhoneNational(null)).toBe("");
  });
});
