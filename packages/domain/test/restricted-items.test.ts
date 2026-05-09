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
