// Risk tools — wraps the counterfeit risk model + action ladder so internal callers
// (catalog ingestion job, brand-takedown handler, ops review tool) can score listings
// and get the same deterministic action set the action ladder produces. See SOP 11.

import { z } from "zod";
import {
  scoreCounterfeit,
  counterfeitActions,
} from "@marketplace/domain/catalog/counterfeit";
import type { McpRegistry } from "../registry.js";

// Bound every numeric signal at its semantic ceiling. Pre-fix several fields
// admitted any non-negative integer (incl. `Number.MAX_SAFE_INTEGER`); the
// scorer would then weight that contributor at ~1M× its intended influence,
// silently saturating the risk score in either direction depending on the
// contributor's sign. The rate-in-bps fields are 0–10000 by definition
// (10000 bps = 100%); `priceVsAuthorizedFloorBps` is allowed to exceed 10000
// (a price 2× the floor is 20000 bps) but the 1M ceiling still protects
// against MAX_SAFE_INTEGER overflow. Day counts are capped at ~273 years.
const Signals = z.object({
  brandRegistryMismatch: z.boolean(),
  priceVsAuthorizedFloorBps: z.number().int().nonnegative().max(1_000_000).optional(),
  sellerAgeDays: z.number().int().nonnegative().max(100_000),
  sellerReputationBps: z.number().int().min(0).max(10000).optional(),
  imageHashHits: z.number().int().nonnegative().max(1_000_000),
  descriptionAnomalies: z.number().int().nonnegative().max(1_000_000),
  refundRateBps: z.number().int().min(0).max(10000).optional(),
  disputeRateBps: z.number().int().min(0).max(10000).optional(),
  categoryBaselineRefundBps: z.number().int().min(0).max(10000).optional(),
});

const Input = z.object({
  listingId: z.string().min(1).max(200),
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
    description: [
      "Score a listing for counterfeit risk and return a deterministic action ladder. Pure function: same",
      "signals always yield the same score and actions; the platform calls this internally before",
      "publishing and again on any listing edit.",
      "",
      "Output fields (use these to explain to an honest seller why their listing was flagged):",
      "  • `risk`: tier (low / elevated / high / critical) — drives the action ladder.",
      "  • `score`: 0–100 numeric for fine-grained sorting; thresholds map to the tier above.",
      "  • `contributors`: ordered list of which signals pushed the score up, with each signal's weight.",
      "    This is what to surface when an operator asks 'why was my listing derankd / hidden?'",
      "  • `actions.visible` (false ⇒ hidden from buyers), `actions.derank` (true ⇒ visible but sorted",
      "    last), `actions.payoutHeld`, `actions.requireSupplyChainDoc`, `actions.reviewSlaHours`.",
      "",
      "Common false-positive paths a seller agent can walk an operator through:",
      "  • `brandRegistryMismatch` — seller is reselling a branded item but not authorized in the brand",
      "    registry. Fix: register with the brand or rephrase the title to not lead with the brand name.",
      "  • `priceVsAuthorizedFloorBps` very low — listing is priced suspiciously below the brand's known",
      "    floor. Fix: confirm the price reflects a real promotion and update if needed.",
      "  • `imageHashHits` — the photo matches images from other (possibly counterfeit) listings. Fix:",
      "    take fresh original photos.",
      "  • `sellerAgeDays` low — new sellers start with risk headroom that decays as reputation accrues;",
      "    nothing to 'fix' here other than time + clean fulfilment.",
      "",
      "This tool only SCORES — it does not apply the actions; the platform applies them at publish time.",
    ].join("\n"),
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
