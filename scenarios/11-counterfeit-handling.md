# SOP 11 — Counterfeit Risk Scoring & Handling

A listing is scored continuously for counterfeit risk; the score drives a deterministic
action ladder (visibility, payout hold, supply-chain doc demand) and a brand-led /
marketplace-led arbitration path.

## Actors
- **Server (catalog risk job)** — computes `RiskScore` from layered signals.
- **Brand owner** — registered in Brand Registry; can escalate or arbitrate listings on their marks.
- **Seller** — receives action decision, may submit supply-chain docs.
- **Buyer** — entitled to auto-refund on confirmed counterfeit.

---

## Step 1 — Collect signals
Inputs (all live in `CounterfeitSignals`):
- `brandRegistryMismatch` — brand is on listing but seller isn't on the brand's authorized list.
- `priceVsAuthorizedFloorBps` — listing price vs. brand-set floor for this GTIN.
- `sellerAgeDays`, `sellerReputationBps` — combined "new + low-rep" gate.
- `imageHashHits` — perceptual-hash matches on counterfeit corpus.
- `descriptionAnomalies` — wrong-region language, malformed serial, brand misspelled.
- `refundRateBps` vs. `categoryBaselineRefundBps` — buyer-side trailing signal.

**Status:** 🟡 (struct + scoring ✅; image-hash corpus + brand registry ingestion ⬜)

## Step 2 — Score
**Surface:** server-internal (nightly job + on-edit)
`scoreCounterfeit(signals) → { risk, score, contributors }` with weights:
- brand mismatch 35, price anomaly 25, new+low-rep 15, image hit 30, description ≤8, buyer-side 12.
- Bands: `<25 = low`, `25–49 = elevated`, `≥50 = high`.

**Status:** ✅ (5 tests in `domain/test/counterfeit.test.ts`)

## Step 3 — Apply action ladder
**Surface:** server-internal; visible to seller via `REST: GET /v1/listings/:id/risk`
`counterfeitActions(risk)`:
- **low** — visible, no derank, no payout hold.
- **elevated** — visible, deranked, payout held, supply-chain doc required.
- **high** — hidden from search, deranked, payout held, supply-chain doc required, 48h review SLA.

**Status:** ✅ logic + MCP surface (`catalog.score_counterfeit` returns risk band, score, contributors, and the action ladder in one call — 9 tests in `mcp-server/test/risk.test.ts`); 🟡 payout-hold wiring + supply-chain-doc upload not wired

## Step 4 — Brand-led arbitration
- Brand opens a takedown via `REST: POST /v1/brand/takedowns`.
- Server flips listing to `high` immediately, opens an arbitration case.
- Seller has 7d to submit supply-chain docs; missed → confirmed counterfeit.
- Confirmed → seller penalty (rating reset, payouts frozen N days), buyer auto-refund + credit-note VDC.
**Status:** ⬜

## Step 5 — Marketplace-led arbitration
- Triggered when `risk = high` and brand has not registered (or hasn't responded).
- Marketplace test-buy program orders the item; physical inspection vendor scores authenticity.
- Same outcome paths as Step 4.
**Status:** ⬜

## Step 6 — Buyer auto-refund
On confirmed counterfeit (any path), open orders for the listing in last N days are refunded
to original source via the §7.2 routing waterfall, and a credit-note VDC is issued.
**Status:** 🟡 (refund routing ✅; trigger-from-counterfeit-confirm not wired)

## Failure paths to test
- Brand-mismatch + image hash hit → score 65 → high. ✅
- Price 60% of floor + new seller → elevated. ✅
- Description anomalies cap at 8 (3 anomalies = full 8). ✅
- Buyer-side refund rate ≤ 1.5× baseline → no contribution. ✅
- Brand registry lookup times out → fail-closed (treat as mismatch) for unregistered brands; fail-open is not allowed.
- Seller submits supply-chain docs after 7d window → still rejected as confirmed.
- Test-buy item physically inconclusive → escalate to brand if registered, otherwise default to confirmed when score ≥ 50.

## Status roll-up
| Step | Status |
|------|--------|
| 1 collect signals | 🟡 |
| 2 score | ✅ |
| 3 apply action ladder (MCP `catalog.score_counterfeit`) | ✅ |
| 3b payout-hold + supply-chain-doc upload wiring | 🟡 |
| 4 brand-led arbitration | ⬜ |
| 5 marketplace-led arbitration | ⬜ |
| 6 buyer auto-refund on confirm | 🟡 |
