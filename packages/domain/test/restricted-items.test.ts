import { describe, expect, it } from "vitest";
import {
  checkListingShippability,
  type ListingClassification,
  type RestrictedItemRule,
} from "../src/catalog/restricted-items.js";

const now = new Date("2026-05-03T00:00:00Z");

const baseListing: ListingClassification = {
  taxonomyKeys: ["electronics/audio/headphones"],
  isHazmat: false,
  isAgeRestricted: false,
  countryOfOrigin: "CN",
  productId: "p1",
};

const baseBuyer = {
  shipToCountry: "US",
  isSanctionedParty: false,
  carriersAvailable: [{ key: "ups", prohibitedItems: [] }],
};

describe("checkListingShippability", () => {
  it("allows benign listings", () => {
    expect(checkListingShippability(baseListing, baseBuyer, [], now).allowed).toBe(true);
  });

  it("blocks sanctioned parties unconditionally", () => {
    const r = checkListingShippability(baseListing, { ...baseBuyer, isSanctionedParty: true }, [], now);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("buyer_sanctioned_party");
  });

  it("blocks prohibited categories in jurisdiction", () => {
    const rule: RestrictedItemRule = {
      taxonomyKey: "electronics/audio",
      countryCode: "US",
      restrictionKind: "prohibited",
      effectiveFrom: new Date("2020-01-01"),
      registryVersion: "v1",
    };
    const r = checkListingShippability(baseListing, baseBuyer, [rule], now);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("prohibited_in_jurisdiction");
  });

  it("requires age verification for age-restricted items", () => {
    const rule: RestrictedItemRule = {
      taxonomyKey: "alcohol",
      countryCode: "US",
      restrictionKind: "age_restricted",
      minAge: 21,
      effectiveFrom: new Date("2020-01-01"),
      registryVersion: "v1",
    };
    const listing = { ...baseListing, taxonomyKeys: ["alcohol/wine"], isAgeRestricted: true, minAge: 21 };
    const buyer = { ...baseBuyer, buyerVerifiedAge: 18 };
    const r = checkListingShippability(listing, buyer, [rule], now);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("age_verification_required_21");
  });

  it("blocks license-required when buyerHasLicense is explicitly false (not just missing)", () => {
    // The previous check used `!hasOwnProperty("buyerHasLicense")` — a buyer
    // who explicitly said "I have NO license" (field present, value false)
    // passed the gate. Real compliance defect — convert the check to a
    // truthy test so the field's value matters.
    const rule: RestrictedItemRule = {
      taxonomyKey: "weapons",
      countryCode: "US",
      restrictionKind: "license_required",
      licenseRequiredOf: "buyer",
      effectiveFrom: new Date("2020-01-01"),
      registryVersion: "v1",
    };
    const listing = { ...baseListing, taxonomyKeys: ["weapons/firearms"] };
    const buyer = { ...baseBuyer, buyerHasLicense: false };
    const r = checkListingShippability(listing, buyer, [rule], now);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("license_required_buyer");
  });

  it("allows license-required when buyerHasLicense is true", () => {
    const rule: RestrictedItemRule = {
      taxonomyKey: "weapons",
      countryCode: "US",
      restrictionKind: "license_required",
      licenseRequiredOf: "buyer",
      effectiveFrom: new Date("2020-01-01"),
      registryVersion: "v1",
    };
    const listing = { ...baseListing, taxonomyKeys: ["weapons/firearms"] };
    const buyer = { ...baseBuyer, buyerHasLicense: true };
    const r = checkListingShippability(listing, buyer, [rule], now);
    expect(r.allowed).toBe(true);
  });

  it("blocks carrier-prohibited hierarchically (carrier bans 'weapons' ⇒ blocks 'weapons/firearms')", () => {
    // The previous check used `listing.taxonomyKeys.includes(p)` — exact
    // equality — so a carrier banning the parent didn't catch the leaf.
    const rule: RestrictedItemRule = {
      taxonomyKey: "weapons",
      countryCode: "US",
      restrictionKind: "carrier_prohibited",
      effectiveFrom: new Date("2020-01-01"),
      registryVersion: "v1",
    };
    const listing = { ...baseListing, taxonomyKeys: ["weapons/firearms"] };
    const buyer = {
      ...baseBuyer,
      carriersAvailable: [{ key: "ups", prohibitedItems: ["weapons"] }],
    };
    const r = checkListingShippability(listing, buyer, [rule], now);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("no_carrier_available");
  });

  it("blocks ITAR shipments outside the US", () => {
    const listing = {
      ...baseListing,
      taxonomyKeys: ["weapons/optics"],
      exportControlClass: "ITAR-XXIII",
    };
    const buyer = { ...baseBuyer, shipToCountry: "FR" };
    const rule: RestrictedItemRule = {
      taxonomyKey: "weapons",
      countryCode: "FR",
      restrictionKind: "export_controlled",
      effectiveFrom: new Date("2020-01-01"),
      registryVersion: "v1",
    };
    const r = checkListingShippability(listing, buyer, [rule], now);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("itar_destination_blocked");
  });
});
