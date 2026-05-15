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

  const applicable = rules.filter((r) => {
    if (r.countryCode !== buyer.shipToCountry) return false;
    if (r.subdivisionCode && r.subdivisionCode !== buyer.shipToSubdivision) return false;
    // Fail-closed on Invalid Dates in policy windows. Pre-fix an Invalid
    // Date on `effectiveFrom` made `Invalid Date <= now` evaluate to
    // `false` (NaN coercion), so the rule was filtered out as "not yet
    // effective" — a typo in a prohibited-items policy silently disabled
    // it and the prohibited item shipped. Treat Invalid as
    // "already-effective" / "no end" so the rule binds when in doubt,
    // matching the spirit of a policy-enforcement gate. Same NaN-bypass
    // family as escrow.releaseAt (pass #122) and velocity location
    // checks (pass #120).
    const fromMs = r.effectiveFrom.getTime();
    if (Number.isFinite(fromMs) && fromMs > now.getTime()) return false;
    if (r.effectiveTo !== undefined) {
      const toMs = r.effectiveTo.getTime();
      if (Number.isFinite(toMs) && toMs <= now.getTime()) return false;
    }
    return listing.taxonomyKeys.some((k) => k === r.taxonomyKey || k.startsWith(`${r.taxonomyKey}/`));
  });

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
      // CRITICAL FIX: the previous check was `!buyer.hasOwnProperty("buyerHasLicense")` —
      // it tested whether the FIELD WAS PRESENT, not whether the license existed.
      // A buyer explicitly asserting `buyerHasLicense: false` passed the gate
      // (field present ⇒ check skipped ⇒ rule allows the transaction). That
      // converted a compliance gate into "are you willing to fill in this field?"
      // The correct semantics: block when the buyer doesn't have a valid license.
      if ((who === "buyer" || who === "both") && !buyer.buyerHasLicense) {
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
      // Carrier-prohibition must match hierarchically: a carrier banning
      // "weapons" must also reject "weapons/firearms". Previously the check
      // was `listing.taxonomyKeys.includes(p)` — exact string equality only —
      // so a listing tagged ONLY at the leaf ("weapons/firearms") slipped
      // past a carrier banning the parent ("weapons"). Asymmetric with the
      // applicable-rules filter at the top, which already handles hierarchy
      // in the other direction.
      const isHierarchicalMatch = (prohibited: string, key: string): boolean =>
        key === prohibited || key.startsWith(`${prohibited}/`);
      const ok = buyer.carriersAvailable.some(
        (c) =>
          !c.prohibitedItems.some((p) =>
            listing.taxonomyKeys.some((k) => isHierarchicalMatch(p, k)),
          ),
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
