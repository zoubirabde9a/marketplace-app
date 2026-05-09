// Review-write eligibility: only buyers with a settled order item for this listing
// or canonical product, within the seller's review window.

import { ConflictError, ForbiddenError } from "@marketplace/shared/errors";

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
  const cutoff = input.now.getTime() - input.reviewWindowDays * 24 * 3600 * 1000;
  const eligible = input.reviewerSettledItems.find(
    (i) =>
      (i.productId === input.productId ||
        (!!input.canonicalProductId && i.canonicalProductId === input.canonicalProductId)) &&
      i.settledAt.getTime() >= cutoff,
  );
  if (!eligible) {
    throw new ForbiddenError("review_no_settled_purchase");
  }
  if (input.existingReviewsOnItem > 0) {
    throw new ConflictError("review_already_exists_for_order_item");
  }
  return { orderItemId: eligible.orderItemId, ...(eligible.outcome ? { outcome: eligible.outcome } : {}) };
}
