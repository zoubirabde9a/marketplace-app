import { describe, expect, it } from "vitest";
import {
  SellerContactSchema,
  SellerPhoneSchema,
  SellerWebsiteSchema,
  SellerWhatsappSchema,
} from "../src/seller/contact.js";

describe("seller contact validators", () => {
  describe("phone", () => {
    it("accepts E.164-style numbers", () => {
      expect(SellerPhoneSchema.parse("+14155552671")).toBe("+14155552671");
      expect(SellerPhoneSchema.parse("14155552671")).toBe("14155552671");
    });

    it("strips formatting characters", () => {
      expect(SellerPhoneSchema.parse("+1 (415) 555-2671")).toBe("+14155552671");
    });

    it("rejects letters and too-short numbers", () => {
      expect(() => SellerPhoneSchema.parse("not-a-phone")).toThrow();
      expect(() => SellerPhoneSchema.parse("+12")).toThrow();
      expect(() => SellerPhoneSchema.parse("+1234567890123456")).toThrow();
    });
  });

  describe("whatsapp", () => {
    it("uses the same rules as phone", () => {
      expect(SellerWhatsappSchema.parse("+447911123456")).toBe("+447911123456");
      expect(() => SellerWhatsappSchema.parse("abc")).toThrow();
    });
  });

  describe("website", () => {
    it("accepts http(s) URLs", () => {
      expect(SellerWebsiteSchema.parse("https://example.com")).toBe("https://example.com");
      expect(SellerWebsiteSchema.parse("http://shop.example.co.uk/path")).toBe(
        "http://shop.example.co.uk/path",
      );
    });

    it("rejects non-http schemes and bare strings", () => {
      expect(() => SellerWebsiteSchema.parse("ftp://example.com")).toThrow();
      expect(() => SellerWebsiteSchema.parse("example.com")).toThrow();
      expect(() => SellerWebsiteSchema.parse("javascript:alert(1)")).toThrow();
    });
  });

  describe("SellerContactSchema", () => {
    it("accepts an empty object — all fields optional", () => {
      expect(SellerContactSchema.parse({})).toEqual({});
    });

    it("accepts a fully-populated object", () => {
      const r = SellerContactSchema.parse({
        phone: "+14155552671",
        whatsapp: "+14155552671",
        website: "https://example.com",
      });
      expect(r.phone).toBe("+14155552671");
      expect(r.whatsapp).toBe("+14155552671");
      expect(r.website).toBe("https://example.com");
    });

    it("rejects when any provided field is malformed", () => {
      expect(() =>
        SellerContactSchema.parse({ phone: "+14155552671", website: "not-a-url" }),
      ).toThrow();
    });
  });
});
