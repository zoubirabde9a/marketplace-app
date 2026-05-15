// negotiate_price — A2A skill wrapping domain.evaluateNegotiation.

import { z } from "zod";
import {
  evaluateNegotiation,
  type NegotiationRequest,
  type SellerOfferPolicy,
} from "@marketplace/domain/negotiation/negotiate";
import { Iso3166Alpha2Schema } from "@marketplace/shared/country";
import type { A2ASkillDef } from "../server.ts";

const Input = z.object({
  policy: z.object({
    sellerOrgId: z.string().min(1).max(120),
    variantId: z.string().min(1).max(120),
    // Money values must be strictly positive. A 0/negative floor breaks the
    // `proposed >= floor` comparison semantics; a 0/negative list price
    // would make every proposal trivially accepted at "list-or-better".
    floorPriceMinor: z.bigint().positive(),
    listPriceMinor: z.bigint().positive(),
    // ISO 4217 alpha-3 — same allow-list every money-bearing surface uses
    // (refund/payment passes #94/#95).
    currency: z.string().regex(/^[A-Z]{3}$/),
    // Cap quantity-bands at the gate. Real pricing policies use 3–10
    // bands; 100 is plenty of headroom while bounding the O(bands × qty)
    // discount-resolution loop.
    quantityBands: z.array(
      z.object({
        minQty: z.number().int().positive(),
        maxQty: z.number().int().positive().optional(),
        discountBps: z.number().int().min(0).max(10000),
      }),
    ).max(100),
    // Reject a collapsed promo window at the gate. With startsAt >= endsAt
    // the `now ∈ [startsAt, endsAt)` check inside the negotiator can never
    // hold, so the extra-discount never applies — looks like a working
    // policy to a seller dashboard but is a silent no-op.
    promo: z
      .object({
        extraDiscountBps: z.number().int().min(0).max(10000),
        startsAt: z.coerce.date(),
        endsAt: z.coerce.date(),
      })
      .refine((p) => p.endsAt > p.startsAt, {
        path: ["endsAt"],
        message: "endsAt must be after startsAt",
      })
      .optional(),
    forbiddenSegments: z.array(z.string().min(1).max(64)).max(100).optional(),
  }),
  request: z.object({
    buyerAgentId: z.string().min(1).max(120),
    buyerOrgId: z.string().min(1).max(120).optional(),
    // Tighten to ISO 3166-1 alpha-2 — pre-fix any string was accepted,
    // and the negotiator's jurisdiction-based forbidden-segment check
    // keyed on this value. A typo like "USA" would silently skip the
    // gate (no rule keyed on "USA" exists).
    buyerJurisdiction: Iso3166Alpha2Schema.optional(),
    buyerSegments: z.array(z.string().min(1).max(64)).max(100),
    qty: z.number().int().positive().max(1_000_000),
    proposedUnitPriceMinor: z.bigint().positive(),
    bundleVariantIds: z.array(z.string().min(1).max(120)).max(100).optional(),
    now: z.coerce.date(),
  }),
});

const Output = z.object({
  accepted: z.boolean(),
  counterUnitPriceMinor: z.bigint().optional(),
  reason: z.string(),
  effectiveDiscountBps: z.number().int().min(0),
});

export const negotiatePriceSkill: A2ASkillDef<z.infer<typeof Input>, z.infer<typeof Output>> = {
  name: "negotiate_price",
  description: "Buyer agent proposes a unit price; seller policy is evaluated server-side.",
  scope: "negotiate:read",
  inputSchema: Input,
  outputSchema: Output,
  handler: (input) => {
    const r = input.request;
    const req: NegotiationRequest = {
      buyerAgentId: r.buyerAgentId,
      buyerSegments: r.buyerSegments,
      qty: r.qty,
      proposedUnitPriceMinor: r.proposedUnitPriceMinor,
      now: r.now,
      ...(r.buyerOrgId !== undefined ? { buyerOrgId: r.buyerOrgId } : {}),
      ...(r.buyerJurisdiction !== undefined ? { buyerJurisdiction: r.buyerJurisdiction } : {}),
      ...(r.bundleVariantIds !== undefined ? { bundleVariantIds: r.bundleVariantIds } : {}),
    };
    return evaluateNegotiation(input.policy as SellerOfferPolicy, req);
  },
};
