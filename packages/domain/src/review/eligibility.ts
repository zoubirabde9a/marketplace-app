// Review-write eligibility: only buyers with a settled order item for this listing
// or canonical product, within the seller's review window.

import { ConflictError, ForbiddenError, ValidationError } from "@marketplace/shared/errors";

export interface ReviewEligibilityInput {
  reviewerUserId?: string;
  reviewerAgentId?: string;
  productId: string;
  canonicalProductId?: string;
  /** Order items the reviewer has settled. */
  reviewerSettledItems: Array<{ productId: string; canonicalProductId?: string; orderItemId: string; settledAt: Date; outcome?: "kept" | "returned" }>;
  reviewWindowDays: number;
  now: Date;
  /** Existing reviews on this order item (one-per-purchase rule). */
  existingReviewsOnItem: number;
}

export function selectEligibleOrderItem(input: ReviewEligibilityInput): { orderItemId: string; outcome?: "kept" | "returned" } {
  if (!input.reviewerUserId && !input.reviewerAgentId) {
    throw new ForbiddenError("review_no_principal");
  }
  if (input.reviewWindowDays <= 0) {
    // A 0/negative window makes `cutoff >= now` and no item can ever qualify.
    // Reject at the boundary so the misconfiguration is loud rather than
    // looking like "this user has no settled purchases".
    throw new ValidationError([
      { path: "reviewWindowDays", message: "must be > 0" },
    ]);
  }
  // Cap the window to 10 years. Without this ceiling, a caller passing
  // `Number.MAX_SAFE_INTEGER` would overflow the `days * 24 * 3600 * 1000`
  // multiplication to `Infinity`, making `cutoff = now - Infinity = -Infinity`
  // and silently letting EVERY past settled item qualify — defeating the
  // review-window restriction. Mirrors the MCP-side cap (review.ts pass #92)
  // so direct domain callers (REST route handlers, integration tests) get
  // the same defense-in-depth.
  if (input.reviewWindowDays > 3650) {
    throw new ValidationError([
      { path: "reviewWindowDays", message: "must be <= 3650 (10 years)" },
    ]);
  }
  const cutoff = input.now.getTime() - input.reviewWindowDays * 24 * 3600 * 1000;
  // Pick the MOST RECENT eligible settled item, not whichever happens to come
  // first in the array. If a buyer purchased the same product twice (e.g.
  // restocked a consumable), the fresher experience is the one worth
  // reviewing — and a deterministic pick is more replay-safe for audits.
  const eligible = input.reviewerSettledItems
    .filter(
      (i) =>
        (i.productId === input.productId ||
          (!!input.canonicalProductId && i.canonicalProductId === input.canonicalProductId)) &&
        i.settledAt.getTime() >= cutoff,
    )
    .sort((a, b) => b.settledAt.getTime() - a.settledAt.getTime())[0];
  if (!eligible) {
    throw new ForbiddenError("review_no_settled_purchase");
  }
  if (input.existingReviewsOnItem > 0) {
    throw new ConflictError("review_already_exists_for_order_item");
  }
  return { orderItemId: eligible.orderItemId, ...(eligible.outcome ? { outcome: eligible.outcome } : {}) };
}
