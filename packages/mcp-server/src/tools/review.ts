// Review tools — gates write-time eligibility (verified purchase + window + one-per-item)
// then runs the moderation classifier on the same call. See SOP 12 steps 1–3.

import { z } from "zod";
import { selectEligibleOrderItem } from "@marketplace/domain/review/eligibility";
import { moderateReview, type CoordinationSignals } from "@marketplace/domain/review/moderation";
import type { McpRegistry } from "../registry.js";

const SettledItem = z.object({
  productId: z.string(),
  canonicalProductId: z.string().optional(),
  orderItemId: z.string(),
  settledAt: z.coerce.date(),
  outcome: z.enum(["kept", "returned"]).optional(),
});

const Signals = z.object({
  burstCount: z.number().int().nonnegative().default(0),
  burstThreshold: z.number().int().positive().default(5),
  linguisticSimilarity: z.number().min(0).max(1).optional(),
  brandConcentrationBps: z.number().int().min(0).max(10000).optional(),
  incentiveDetected: z.boolean().default(false),
  selfReview: z.boolean().default(false),
  honeypotEcho: z.boolean().default(false),
});

const Input = z
  .object({
    reviewerUserId: z.string().optional(),
    reviewerAgentId: z.string().optional(),
    productId: z.string(),
    canonicalProductId: z.string().optional(),
    // Cap the purchase-history array a caller can submit. Pre-fix an agent
    // could pass 1M settled items and force `selectEligibleOrderItem` to
    // scan all of them; 1000 is generous for any real buyer's window-of-
    // eligibility purchases on a single product family.
    reviewerSettledItems: z.array(SettledItem).max(1000),
    // Upper-bound the review window. Without a ceiling, `Number.MAX_SAFE_INTEGER`
    // is accepted; the domain layer's `now - windowMs` then underflows to
    // before-the-epoch (or `windowMs` overflows to `Infinity`), and EVERY
    // past settled purchase qualifies — silently defeating the eligibility
    // window. 3650 days (10 years) is well beyond any legitimate policy.
    reviewWindowDays: z.number().int().positive().max(3650),
    // Cap mirrors the array bound above: existing-reviews-on-item is
    // user-supplied caller state, not server-derived, and a huge value
    // would shift the "one-per-item" branch into nonsense territory.
    existingReviewsOnItem: z.number().int().nonnegative().max(1_000_000).default(0),
    now: z.coerce.date(),
    body: z.string().min(1).max(5000),
    rating: z.number().int().min(1).max(5),
    signals: Signals.optional(),
  })
  // The domain layer throws `review_no_principal` when both ids are missing.
  // Reject at the schema boundary so the caller gets a clear validation error
  // (and a clean Zod path) instead of a runtime domain error.
  .refine((d) => Boolean(d.reviewerUserId) || Boolean(d.reviewerAgentId), {
    path: ["reviewerUserId"],
    message:
      "review_no_principal: at least one of reviewerUserId or reviewerAgentId is required",
  });

const Output = z.object({
  orderItemId: z.string(),
  outcome: z.enum(["kept", "returned"]).optional(),
  authorKind: z.enum(["human", "agent"]),
  verifiedPurchase: z.literal(true),
  moderation: z.object({
    status: z.enum(["visible", "excluded_from_avg", "suppressed"]),
    suspicionScore: z.number().int().min(0).max(100),
    reasons: z.array(z.string()),
    notifyReviewer: z.boolean(),
    sellerPenalty: z.boolean(),
  }),
});

export function registerReviewTools(reg: McpRegistry): void {
  reg.register({
    name: "review.write",
    description: [
      "Submit a product review on behalf of a BUYER who has actually purchased the product. This is not",
      "a seller tool — a seller agent should not call this to write reviews of its own listings.",
      "",
      "The platform gates the call on three conditions, all enforced server-side:",
      "  • verified-purchase: the reviewer must have a settled order containing this product.",
      "  • review-window: the order's settlement must be within `reviewWindowDays`.",
      "  • one-per-order-item: each settled order-item can only be reviewed once.",
      "Self-review (the buyer is also the seller of the listing) is also rejected.",
      "",
      "A moderation classifier runs synchronously and the routing decision is returned alongside the",
      "review id. If the routing is `review_block` the review is rejected and not persisted; if",
      "`moderation_queue` the review is held for human review before going live. Tell the operator about",
      "either outcome rather than retrying with reworded text — re-submitting a flagged review without",
      "addressing the underlying signal often makes the score worse.",
    ].join("\n"),
    scope: "review:write",
    auditEvent: "review.write",
    idempotent: false,
    inputSchema: Input,
    outputSchema: Output,
    handler: async (input) => {
      const eligibility = selectEligibleOrderItem({
        ...(input.reviewerUserId !== undefined ? { reviewerUserId: input.reviewerUserId } : {}),
        ...(input.reviewerAgentId !== undefined ? { reviewerAgentId: input.reviewerAgentId } : {}),
        productId: input.productId,
        ...(input.canonicalProductId !== undefined
          ? { canonicalProductId: input.canonicalProductId }
          : {}),
        reviewerSettledItems: input.reviewerSettledItems.map((s) => ({
          productId: s.productId,
          orderItemId: s.orderItemId,
          settledAt: s.settledAt,
          ...(s.canonicalProductId !== undefined ? { canonicalProductId: s.canonicalProductId } : {}),
          ...(s.outcome !== undefined ? { outcome: s.outcome } : {}),
        })),
        reviewWindowDays: input.reviewWindowDays,
        existingReviewsOnItem: input.existingReviewsOnItem,
        now: input.now,
      });

      const sig: CoordinationSignals = {
        burstCount: input.signals?.burstCount ?? 0,
        burstThreshold: input.signals?.burstThreshold ?? 5,
        ...(input.signals?.linguisticSimilarity !== undefined
          ? { linguisticSimilarity: input.signals.linguisticSimilarity }
          : {}),
        ...(input.signals?.brandConcentrationBps !== undefined
          ? { brandConcentrationBps: input.signals.brandConcentrationBps }
          : {}),
        incentiveDetected: input.signals?.incentiveDetected ?? false,
        selfReview: input.signals?.selfReview ?? false,
        verifiedPurchase: true, // step 1 already enforced this
        honeypotEcho: input.signals?.honeypotEcho ?? false,
      };
      const moderation = moderateReview(sig);

      return {
        orderItemId: eligibility.orderItemId,
        ...(eligibility.outcome ? { outcome: eligibility.outcome } : {}),
        authorKind: input.reviewerAgentId ? ("agent" as const) : ("human" as const),
        verifiedPurchase: true as const,
        moderation,
      };
    },
    errorCatalog: [
      { code: "review_no_principal", httpStatus: 400, description: "Reviewer has neither user nor agent id." },
      { code: "review_no_settled_purchase", httpStatus: 403, description: "No settled purchase on this product within the review window." },
      { code: "review_already_exists_for_order_item", httpStatus: 409, description: "This order item has already been reviewed." },
    ],
  });
}
