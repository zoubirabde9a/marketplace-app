# SOP 12 — Review Eligibility & Fraud Moderation

Reviews are gated at write-time by a verified-purchase eligibility check, then scored
post-hoc for coordination signals. A deterministic ladder decides whether the review
is visible, excluded from the rating average, or suppressed.

## Actors
- **Buyer (human or agent)** — submits a review.
- **Server** — gates write, scores moderation, applies ladder.
- **Seller** — sees public reviews; receives penalty on confirmed fraud rings.

---

## Step 1 — Eligibility (write-time)
**Surface:** `REST: POST /v1/products/:id/reviews`
Calls `selectEligibleOrderItem`:
- Reviewer must have **either** `userId` or `agentId` (`ForbiddenError review_no_principal` otherwise).
- A settled order item must exist for this `productId` or its `canonicalProductId`, within `reviewWindowDays`. Else `ForbiddenError review_no_settled_purchase`.
- One review per order item — second attempt → `ConflictError review_already_exists_for_order_item`.

Outcome (`kept` vs `returned`) is carried through so display can label "Reviewed after return".
**Status:** ✅ logic (10 tests in `domain/test/review.test.ts`); ✅ MCP surface (`review.write` tool, 13 tests in `mcp-server/test/review.test.ts`)

## Step 2 — Authorship tagging
Every persisted review carries:
- `authorKind` — `human | agent | mixed`.
- `agentId`, `passportId` if agent-authored or agent-assisted.
- `verifiedPurchase: true` because step 1 enforces it.

**Status:** ✅ (`review.write` returns `authorKind` ("agent" if `reviewerAgentId` set, else "human") and a hard-coded `verifiedPurchase: true` because step 1 already enforced it)

## Step 3 — Coordination scoring
**Surface:** server-internal (per-write + nightly re-score)
`moderateReview(signals)` accumulates a suspicion score:
- `selfReview` → +100 (instant suppress + seller penalty).
- `honeypotEcho` → +100 (proves agent-injection — instant suppress).
- `incentiveDetected` → +50 (refund-for-review side channel).
- `burstCount > burstThreshold` → +30.
- `linguisticSimilarity ≥ 0.92` → +25.
- `brandConcentrationBps ≥ 8000` → +15 (reviewer's history concentrated on one brand).
- `!verifiedPurchase` → +20 (defense in depth — should never fire after step 1).

Bands: `<25 visible`, `25–49 excluded_from_avg`, `≥50 suppressed`.
**Status:** ✅ logic + MCP wiring (the same `review.write` call runs the classifier synchronously and returns `moderation.{status, suspicionScore, reasons, notifyReviewer, sellerPenalty}`); 🟡 burst / linguistic / honeypot signal feeds (today the caller supplies signals — feature jobs that compute them are not yet built)

## Step 4 — Apply decision
- `visible` — no action.
- `excluded_from_avg` — review still shown, but rating average recomputed without it; transparency badge.
- `suppressed` — hidden, reviewer notified (`notifyReviewer: true`), appeal allowed.
- Any decision with `sellerPenalty: true` (incentive or self-review) → seller rating reset, payout hold, dispatched to ops.

**Status:** ⬜ (notify + appeal + seller-penalty wiring)

## Step 5 — Transparency report
Aggregate counts published quarterly: total reviews, % suppressed, top reasons, appeal-overturn rate.
**Status:** ⬜

## Failure paths to test
- Settled-but-stale purchase (past review window) → blocked. ✅
- Returned outcome — eligible to review with `outcome: "returned"` carried through. ✅
- Same canonical product, different listing — eligible. ✅
- Self-review (agent reviews seller-org it controls) → +100. ✅
- Honeypot canary echoed back from a buyer agent — proves prompt-injection, suppress instantly. ✅
- Burst of 6 reviews from same payment graph in 1h with `burstThreshold = 3` → +30. ✅
- Appeal overturn must restore the review and roll back any seller penalty atomically.

## Status roll-up
| Step | Status |
|------|--------|
| 1 eligibility gate (MCP) | ✅ |
| 2 authorship tagging | ✅ |
| 3 coordination scoring (MCP wiring) | ✅ |
| 3b signal feeds (burst / linguistic / honeypot) | 🟡 |
| 4 apply decision (notify/penalty/appeal) | ⬜ |
| 5 transparency report | ⬜ |
