// negotiate_price — A2A skill wrapping domain.evaluateNegotiation.

import { z } from "zod";
import {
  evaluateNegotiation,
  type NegotiationRequest,
  type SellerOfferPolicy,
} from "@marketplace/domain/negotiation/negotiate";
import type { A2ASkillDef } from "../server.ts";

const Input = z.object({
  policy: z.object({
    sellerOrgId: z.string(),
    variantId: z.string(),
    floorPriceMinor: z.bigint(),
    listPriceMinor: z.bigint(),
    currency: z.string(),
    quantityBands: z.array(
      z.object({
        minQty: z.number().int().positive(),
        maxQty: z.number().int().positive().optional(),
        discountBps: z.number().int().min(0).max(10000),
      }),
    ),
    promo: z
      .object({
        extraDiscountBps: z.number().int().min(0).max(10000),
        startsAt: z.coerce.date(),
        endsAt: z.coerce.date(),
      })
      .optional(),
    forbiddenSegments: z.array(z.string()).optional(),
  }),
  request: z.object({
    buyerAgentId: z.string(),
    buyerOrgId: z.string().optional(),
    buyerJurisdiction: z.string().optional(),
    buyerSegments: z.array(z.string()),
    qty: z.number().int().positive(),
    proposedUnitPriceMinor: z.bigint(),
    bundleVariantIds: z.array(z.string()).optional(),
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
