// Risk tools — wraps the counterfeit risk model + action ladder so internal callers
// (catalog ingestion job, brand-takedown handler, ops review tool) can score listings
// and get the same deterministic action set the action ladder produces. See SOP 11.

import { z } from "zod";
import {
  scoreCounterfeit,
  counterfeitActions,
} from "@marketplace/domain/catalog/counterfeit";
import type { McpRegistry } from "../registry.js";

const Signals = z.object({
  brandRegistryMismatch: z.boolean(),
  priceVsAuthorizedFloorBps: z.number().int().nonnegative().optional(),
  sellerAgeDays: z.number().int().nonnegative(),
  sellerReputationBps: z.number().int().min(0).max(10000).optional(),
  imageHashHits: z.number().int().nonnegative(),
  descriptionAnomalies: z.number().int().nonnegative(),
  refundRateBps: z.number().int().nonnegative().optional(),
  disputeRateBps: z.number().int().nonnegative().optional(),
  categoryBaselineRefundBps: z.number().int().nonnegative().optional(),
});

const Input = z.object({
  listingId: z.string(),
  signals: Signals,
});

const RiskBand = z.enum(["low", "elevated", "high"]);

const Output = z.object({
  listingId: z.string(),
  risk: RiskBand,
  score: z.number().nonnegative(),
  contributors: z.array(
    z.object({
      name: z.string(),
      weight: z.number(),
    }),
  ),
  actions: z.object({
    visible: z.boolean(),
    derank: z.boolean(),
    payoutHeld: z.boolean(),
    requireSupplyChainDoc: z.boolean(),
    reviewSlaHours: z.number().int().positive().optional(),
  }),
});

export function registerRiskTools(reg: McpRegistry): void {
  reg.register({
    name: "catalog.score_counterfeit",
    description:
      "Score a listing for counterfeit risk and return the deterministic action ladder (visibility, derank, payout hold, supply-chain-doc demand, review SLA).",
    scope: "catalog:read",
    auditEvent: "catalog.score_counterfeit",
    idempotent: true,
    inputSchema: Input,
    outputSchema: Output,
    handler: async (input) => {
      const s = input.signals;
      const signals = {
        brandRegistryMismatch: s.brandRegistryMismatch,
        sellerAgeDays: s.sellerAgeDays,
        imageHashHits: s.imageHashHits,
        descriptionAnomalies: s.descriptionAnomalies,
        ...(s.priceVsAuthorizedFloorBps !== undefined ? { priceVsAuthorizedFloorBps: s.priceVsAuthorizedFloorBps } : {}),
        ...(s.sellerReputationBps !== undefined ? { sellerReputationBps: s.sellerReputationBps } : {}),
        ...(s.refundRateBps !== undefined ? { refundRateBps: s.refundRateBps } : {}),
        ...(s.disputeRateBps !== undefined ? { disputeRateBps: s.disputeRateBps } : {}),
        ...(s.categoryBaselineRefundBps !== undefined ? { categoryBaselineRefundBps: s.categoryBaselineRefundBps } : {}),
      };
      const { risk, score, contributors } = scoreCounterfeit(signals);
      const actions = counterfeitActions(risk);
      return {
        listingId: input.listingId,
        risk,
        score,
        contributors,
        actions,
      };
    },
    errorCatalog: [
      { code: "validation", httpStatus: 400, description: "Signals failed schema validation." },
    ],
  });
}
