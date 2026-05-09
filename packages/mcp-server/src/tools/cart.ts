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
import type { McpRegistry } from "../registry.js";

const ListingSchema = z.object({
  productId: z.string(),
  listingId: z.string(),
  taxonomyKeys: z.array(z.string()).min(1),
  isHazmat: z.boolean(),
  isAgeRestricted: z.boolean(),
  minAge: z.number().int().nonnegative().optional(),
  exportControlClass: z.string().optional(),
  countryOfOrigin: z.string().length(2),
});

const BuyerContextSchema = z.object({
  shipToCountry: z.string().length(2),
  shipToSubdivision: z.string().optional(),
  buyerVerifiedAge: z.number().int().nonnegative().optional(),
  buyerHasLicense: z.boolean().optional(),
  isSanctionedParty: z.boolean(),
  carriersAvailable: z.array(
    z.object({
      key: z.string(),
      prohibitedItems: z.array(z.string()),
    }),
  ),
});

const RuleSchema = z.object({
  taxonomyKey: z.string(),
  countryCode: z.string().length(2),
  subdivisionCode: z.string().optional(),
  restrictionKind: z.enum([
    "prohibited",
    "age_restricted",
    "license_required",
    "carrier_prohibited",
    "export_controlled",
    "hazmat",
  ]),
  minAge: z.number().int().nonnegative().optional(),
  licenseRequiredOf: z.enum(["seller", "buyer", "both"]).optional(),
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().optional(),
  registryVersion: z.string(),
});

const Input = z.object({
  lines: z.array(ListingSchema).min(1),
  buyer: BuyerContextSchema,
  rules: z.array(RuleSchema),
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
