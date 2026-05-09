// Prohibited-items + jurisdictional enforcement per spec §8a.3.

import { ForbiddenError } from "@marketplace/shared/errors";

export type RestrictionKind =
  | "prohibited"
  | "age_restricted"
  | "license_required"
  | "carrier_prohibited"
  | "export_controlled"
  | "hazmat";

export interface RestrictedItemRule {
  taxonomyKey: string;
  countryCode: string;
  subdivisionCode?: string;
  restrictionKind: RestrictionKind;
  minAge?: number;
  licenseRequiredOf?: "seller" | "buyer" | "both";
  effectiveFrom: Date;
  effectiveTo?: Date;
  registryVersion: string;
}

export interface ListingClassification {
  taxonomyKeys: string[]; // hierarchical: e.g. ["weapons", "weapons/firearms"]
  isHazmat: boolean;
  isAgeRestricted: boolean;
  minAge?: number;
  exportControlClass?: string;
  countryOfOrigin: string;
  productId: string;
}

export interface BuyerContext {
  shipToCountry: string;
  shipToSubdivision?: string;
  buyerVerifiedAge?: number;
  buyerHasLicense?: boolean;
  isSanctionedParty: boolean;
  carriersAvailable: Array<{ key: string; prohibitedItems: string[] }>;
}

export interface CheckOutcome {
  allowed: boolean;
  reason?: string;
  triggeredRule?: RestrictedItemRule;
}

export function checkListingShippability(
  listing: ListingClassification,
  buyer: BuyerContext,
  rules: RestrictedItemRule[],
  now: Date,
): CheckOutcome {
  if (buyer.isSanctionedParty) {
    return { allowed: false, reason: "buyer_sanctioned_party" };
  }

  const applicable = rules.filter(
    (r) =>
      r.countryCode === buyer.shipToCountry &&
      (!r.subdivisionCode || r.subdivisionCode === buyer.shipToSubdivision) &&
      r.effectiveFrom <= now &&
      (!r.effectiveTo || r.effectiveTo > now) &&
      listing.taxonomyKeys.some((k) => k === r.taxonomyKey || k.startsWith(`${r.taxonomyKey}/`)),
  );

  for (const rule of applicable) {
    if (rule.restrictionKind === "prohibited") {
      return { allowed: false, reason: "prohibited_in_jurisdiction", triggeredRule: rule };
    }
    if (rule.restrictionKind === "age_restricted") {
      const minAge = rule.minAge ?? listing.minAge ?? 18;
      if ((buyer.buyerVerifiedAge ?? 0) < minAge) {
        return { allowed: false, reason: `age_verification_required_${minAge}`, triggeredRule: rule };
      }
    }
    if (rule.restrictionKind === "license_required") {
      const who = rule.licenseRequiredOf ?? "buyer";
      if ((who === "buyer" || who === "both") && !buyer.hasOwnProperty("buyerHasLicense")) {
        return { allowed: false, reason: "license_required_buyer", triggeredRule: rule };
      }
    }
    if (rule.restrictionKind === "export_controlled") {
      // Spec §8a.3: dual-use goods checked via export class + denied-party screening.
      // Denied-party already short-circuited above.
      // Default: allow if not on denied-party list and class is not blocked here.
      // Block when origin → destination export rules disallow this class.
      if (listing.exportControlClass && /^(EAR|ITAR)/.test(listing.exportControlClass)) {
        // For ITAR-classified, ship-to outside US is denied unless explicit license
        if (listing.exportControlClass.startsWith("ITAR") && buyer.shipToCountry !== "US") {
          return {
            allowed: false,
            reason: "itar_destination_blocked",
            triggeredRule: rule,
          };
        }
      }
    }
    if (rule.restrictionKind === "carrier_prohibited") {
      const ok = buyer.carriersAvailable.some(
        (c) => !c.prohibitedItems.some((p) => listing.taxonomyKeys.includes(p)),
      );
      if (!ok) return { allowed: false, reason: "no_carrier_available", triggeredRule: rule };
    }
    if (rule.restrictionKind === "hazmat" && listing.isHazmat) {
      const ok = buyer.carriersAvailable.some((c) => !c.prohibitedItems.includes("hazmat"));
      if (!ok) return { allowed: false, reason: "hazmat_no_carrier", triggeredRule: rule };
    }
  }

  return { allowed: true };
}

export function enforceListingShippability(
  listing: ListingClassification,
  buyer: BuyerContext,
  rules: RestrictedItemRule[],
  now: Date,
): void {
  const r = checkListingShippability(listing, buyer, rules, now);
  if (!r.allowed) {
    throw new ForbiddenError(`listing_blocked:${r.reason}`);
  }
}
