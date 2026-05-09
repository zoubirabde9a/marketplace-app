# SOP 03 — Buyer Purchase Journey

A buyer agent goes from "find me a kettle" to a settled order.

## Actors
- **Buyer agent** with active passport from SOP 02.
- **Seller** with an active product from SOP 01.

---

## Step 1 — Search
**Surface:** `MCP: catalog.search`
```json
{ "query": "pour over kettle 1.2L", "filters": { "priceMaxMinor": 8000, "shipTo": "GB" }, "page": 1, "embeddings_mode": "hybrid" }
```
**Result:** list of canonical-product hits with cheapest live offer attached. Restricted-items filter (§8a.3) excludes anything illegal in `GB`.
**Status:** 🟡 (search + restricted-items ✅; MCP wiring ⬜)

## Step 2 — Compare
**Surface:** `MCP: catalog.compare`
```json
{ "ids": ["canon_abc", "canon_def", "canon_ghi"] }
```
Returns aligned attribute table — capacity, wattage, shipping cost to buyer's address, return policy, seller reputation (`agent.reputation` if seller agent has one — §7a).
**Status:** ⬜

## Step 3 — Create cart
**Surface:** `MCP: cart.create` → `{ cart_id }`. **Status:** ⬜
**Surface:** `MCP: cart.add_item`
```json
{ "cart_id": "cart_...", "sku": "ACME-K12-MB", "qty": 1 }
```
Server validates same-seller-per-variant (✅ enforced in `cart.addLine`), records `negotiatedQuoteId` if relevant.
**Status:** 🟡

## Step 4 — Quote (priced cart with tax + shipping)
**Surface:** `MCP: checkout.quote`
```json
{ "cart_id": "cart_...", "shipTo": { "country": "GB", "postal": "SW1A 1AA" } }
```
Returns:
```json
{
  "subtotalMinor": 5999,
  "shippingOptions": [
    { "carrier": "usps_intl", "service": "priority", "priceMinor": 1899, "etaDays": 7 }
  ],
  "taxMinor": 1380,
  "totalMinor": 9278,
  "currency": "GBP",
  "restrictionsCheck": "ok",
  "expiresAt": "2026-05-04T15:00:00Z"
}
```
Quote runs the restricted-items registry against the actual ship-to (§8a.3) — checkout gate, not just storefront filter.
**Status:** 🟡 (priceQuote ✅, tax/shipping engines ⬜)

## Step 5 — Issue an Intent Mandate (AP2)
The agent's passport says `perTxMinor: 15000`. Total is 9278 GBP-minor → fits cap → Tier 2 (§3.7) → **Open Intent Mandate** sufficient.

**Surface:** `MCP: mandate.create_intent` (or `REST: POST /v1/mandates`)
```json
{
  "kind": "intent",
  "agent_id": "agt_...",
  "principal_id": "usr_...",
  "scope": {
    "maxAmountMinor": 10000,
    "currency": "GBP",
    "categories": ["home.kitchen"],
    "merchants": ["org_acme"],
    "deadline": "2026-05-04T16:00:00Z"
  }
}
```
Signed by the principal's key (passkey-derived). Stored as VDC + hash row (§3.5).
**Status:** 🟡 (mandate verification ✅; mandate creation API ⬜)

## Step 6 — Confirm checkout
**Surface:** `MCP: checkout.confirm`
```json
{
  "cart_id": "cart_...",
  "mandate_id": "mnd_...",
  "shippingChoice": "usps_intl_priority",
  "payment_method": "pm_...",
  "idempotency_key": "..."
}
```
Server runs:
1. Load mandate → `verifyMandate` (✅): not expired, not revoked, signature valid, amount under cap, merchant allowed, ship-to allowed.
2. `enforceMandate` against the priced cart (✅).
3. `checkSpendCap` against passport caps + 24h usage (✅).
4. Create `payment_intents` row, call Stripe with `transfer_data[]` for the seller payout split + `application_fee_amount` (§7.3 — atomic via Stripe Connect).
5. Compute split legs (`computeSplitLegs` ✅) and write to double-entry ledger (`assertBalanced` ✅): `seller_revenue`, `marketplace_revenue`, `tax_payable`, `payment_processor_fee`.
6. Order in state `placed`; emits webhook `order.placed`.

**Result:** `{ order_id, status: "placed", paymentMandate: "<signed VDC>" }`.
**Status:** 🟡 (verifyMandate, enforceMandate, spend-caps, ledger, splits, webhooks ✅; orchestration ⬜)

## Step 7 — Track
**Surface:** `MCP: order.track`
```json
{ "order_id": "ord_..." }
```
Returns status history: `placed → paid → fulfilled → shipped → delivered`. State machine ✅ (`order-state-machine.test.ts`).
**Status:** 🟡

---

## Failure paths to test
- **Mandate expired** at confirm time → `MandateError` with code `mandate_expired`. ✅ unit-tested.
- **Cart total > mandate cap** → `MandateError` `amount_exceeds_cap`. ✅
- **Ship-to outside mandate jurisdictions** → `MandateError` `ship_to_outside_jurisdictions`. ✅
- **Spend cap blown** (e.g. 3rd purchase same day pushes past `perDayMinor`) → `ForbiddenError` `spend_cap_per_day_exceeded`. ✅
- **Idempotency replay** with same key returns the original order, not a duplicate.

## Status roll-up
| Step | Status |
|------|--------|
| 1 search | 🟡 |
| 2 compare | ⬜ |
| 3 cart | 🟡 |
| 4 quote | 🟡 |
| 5 mandate | 🟡 |
| 6 confirm | 🟡 |
| 7 track | 🟡 |

## End-to-end exercise — full lifecycle
`agent-sim/test/buyer-full-lifecycle.test.ts` walks the entire SOP 03 + 05 + 12 path in a
single journey: `payment.check_spend_cap` → `payment.check_velocity` → `cart.check_restrictions`
→ cart-add → `order.apply_event` (authorize → capture → begin_fulfillment → ship → deliver)
→ `review.write`. 7 tests cover happy-path delivery with full transition trace, spend-cap block,
velocity geo-jump block, anomaly-with-step-up branch (proceeds), sanctioned-buyer hard block,
prohibited-taxonomy block, and multi-line per-tx aggregation.

## End-to-end exercise — post-purchase only
`agent-sim/test/buyer-purchase.test.ts` runs the post-search portion of this SOP through
the real MCP `cart.check_restrictions` tool, builds a cart from the passing lines via the
cart domain module, performs a pseudo-settle, and submits a review via MCP `review.write`.
7 tests cover: benign cart with visible review, mixed cart with one recoverable block,
age-verified line passes, fully-blocked cart refusing checkout, self-review suppression
at the moderation step, short review window, and sanctioned-buyer hard block.
