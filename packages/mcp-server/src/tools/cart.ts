// Cart tools — wraps domain-level checkout gates so agents can dry-run the
// restricted-items / denied-party / carrier check before committing to checkout.
// See SOP 10 (restricted-items checkout gate).

import { z } from "zod";
import { checkListingShippability } from "@marketplace/domain/catalog/restricted-items";
import type {
  ListingClassification,
  BuyerContext,
  RestrictedItemRule,
  RestrictionKind,
} from "@marketplace/domain/catalog/restricted-items";
import { Iso3166Alpha2Schema } from "@marketplace/shared/country";
import type { McpRegistry } from "../registry.js";

const ListingSchema = z.object({
  productId: z.string().min(1).max(200),
  listingId: z.string().min(1).max(200),
  // Cap taxonomy keys per listing. A real listing carries ≤20 keys
  // (category, subcategory, brand, tags, attributes); 100 leaves headroom
  // without letting a caller balloon the rule-match loop.
  taxonomyKeys: z.array(z.string().min(1).max(200)).min(1).max(100),
  isHazmat: z.boolean(),
  isAgeRestricted: z.boolean(),
  // 150 is past the oldest verified human; bounding here prevents an agent
  // from passing "999" to silently satisfy any age-gated rule.
  minAge: z.number().int().min(0).max(150).optional(),
  exportControlClass: z.string().max(60).optional(),
  countryOfOrigin: Iso3166Alpha2Schema,
});

const BuyerContextSchema = z.object({
  // ISO-validated: a bogus code like "XX" would otherwise match no rule's
  // countryCode and silently allow prohibited items through the gate.
  shipToCountry: Iso3166Alpha2Schema,
  shipToSubdivision: z.string().optional(),
  buyerVerifiedAge: z.number().int().min(0).max(150).optional(),
  buyerHasLicense: z.boolean().optional(),
  isSanctionedParty: z.boolean(),
  carriersAvailable: z.array(
    z.object({
      key: z.string(),
      prohibitedItems: z.array(z.string()),
    }),
  ),
});

const RuleSchema = z
  .object({
    taxonomyKey: z.string(),
    countryCode: Iso3166Alpha2Schema,
    subdivisionCode: z.string().optional(),
    restrictionKind: z.enum([
      "prohibited",
      "age_restricted",
      "license_required",
      "carrier_prohibited",
      "export_controlled",
      "hazmat",
    ]),
    minAge: z.number().int().min(0).max(150).optional(),
    licenseRequiredOf: z.enum(["seller", "buyer", "both"]).optional(),
    effectiveFrom: z.coerce.date(),
    effectiveTo: z.coerce.date().optional(),
    registryVersion: z.string(),
  })
  // A rule whose window collapses (effectiveTo <= effectiveFrom) would silently
  // never match — `now` can't be both ≥ from AND ≤ to. Reject at the gate so
  // policy authors notice the typo instead of shipping a no-op rule.
  .refine((r) => r.effectiveTo === undefined || r.effectiveTo > r.effectiveFrom, {
    path: ["effectiveTo"],
    message: "effectiveTo must be after effectiveFrom",
  });

// Cap both the cart-lines and rules arrays at the gate. The shippability
// gate is O(lines × rules) per call, so without bounds a single caller
// passing 1M of each would force ~10^12 inner checks per request. 200 lines
// covers any plausible cart (the cart-domain MAX_QTY_PER_LINE × 200 = 200k
// units total) and 10k rules covers a full jurisdiction × taxonomy product
// (e.g. 250 jurisdictions × 40 categories ≈ 10k); anything larger is a
// misuse rather than a real policy table.
const Input = z.object({
  lines: z.array(ListingSchema).min(1).max(200),
  buyer: BuyerContextSchema,
  rules: z.array(RuleSchema).max(10_000),
  now: z.coerce.date(),
});

// "hard" reasons cannot be self-resolved by the agent — drop the line.
// "recoverable" reasons can be addressed (verify age, attach license, choose another carrier).
const RECOVERABLE_PREFIXES = ["age_verification_required_", "license_required_", "no_carrier_available"];
const HARD_REASONS = new Set([
  "buyer_sanctioned_party",
  "prohibited_in_jurisdiction",
  "itar_destination_blocked",
  "hazmat_no_carrier",
]);

function classifyReason(reason: string): "hard" | "recoverable" {
  if (HARD_REASONS.has(reason)) return "hard";
  for (const p of RECOVERABLE_PREFIXES) if (reason.startsWith(p)) return "recoverable";
  return "hard";
}

const LineResultSchema = z.object({
  productId: z.string(),
  listingId: z.string(),
  allowed: z.boolean(),
  reason: z.string().optional(),
  reasonClass: z.enum(["hard", "recoverable"]).optional(),
  triggeredRuleVersion: z.string().optional(),
  triggeredTaxonomyKey: z.string().optional(),
});

const Output = z.object({
  allowed: z.boolean(),
  results: z.array(LineResultSchema),
});

export function registerCartTools(reg: McpRegistry): void {
  reg.register({
    name: "cart.check_restrictions",
    description:
      "Dry-run the restricted-items / denied-party / carrier gate against a cart. Returns per-line allow/block with hard-vs-recoverable classification and the rule version that triggered the block.",
    scope: "cart:write",
    auditEvent: "cart.check_restrictions",
    idempotent: true,
    inputSchema: Input,
    outputSchema: Output,
    handler: async (input) => {
      const rules: RestrictedItemRule[] = input.rules.map((r) => ({
        taxonomyKey: r.taxonomyKey,
        countryCode: r.countryCode,
        ...(r.subdivisionCode !== undefined ? { subdivisionCode: r.subdivisionCode } : {}),
        restrictionKind: r.restrictionKind as RestrictionKind,
        ...(r.minAge !== undefined ? { minAge: r.minAge } : {}),
        ...(r.licenseRequiredOf !== undefined ? { licenseRequiredOf: r.licenseRequiredOf } : {}),
        effectiveFrom: r.effectiveFrom,
        ...(r.effectiveTo !== undefined ? { effectiveTo: r.effectiveTo } : {}),
        registryVersion: r.registryVersion,
      }));

      const buyer: BuyerContext = {
        shipToCountry: input.buyer.shipToCountry,
        ...(input.buyer.shipToSubdivision !== undefined
          ? { shipToSubdivision: input.buyer.shipToSubdivision }
          : {}),
        ...(input.buyer.buyerVerifiedAge !== undefined
          ? { buyerVerifiedAge: input.buyer.buyerVerifiedAge }
          : {}),
        ...(input.buyer.buyerHasLicense !== undefined
          ? { buyerHasLicense: input.buyer.buyerHasLicense }
          : {}),
        isSanctionedParty: input.buyer.isSanctionedParty,
        carriersAvailable: input.buyer.carriersAvailable,
      };

      const results = input.lines.map((line) => {
        const listing: ListingClassification = {
          taxonomyKeys: line.taxonomyKeys,
          isHazmat: line.isHazmat,
          isAgeRestricted: line.isAgeRestricted,
          ...(line.minAge !== undefined ? { minAge: line.minAge } : {}),
          ...(line.exportControlClass !== undefined ? { exportControlClass: line.exportControlClass } : {}),
          countryOfOrigin: line.countryOfOrigin,
          productId: line.productId,
        };
        const r = checkListingShippability(listing, buyer, rules, input.now);
        if (r.allowed) {
          return { productId: line.productId, listingId: line.listingId, allowed: true };
        }
        return {
          productId: line.productId,
          listingId: line.listingId,
          allowed: false,
          reason: r.reason!,
          reasonClass: classifyReason(r.reason!),
          ...(r.triggeredRule
            ? {
                triggeredRuleVersion: r.triggeredRule.registryVersion,
                triggeredTaxonomyKey: r.triggeredRule.taxonomyKey,
              }
            : {}),
        };
      });

      return {
        allowed: results.every((x) => x.allowed),
        results,
      };
    },
    errorCatalog: [
      { code: "validation", httpStatus: 400, description: "Input failed schema validation." },
    ],
  });
}
