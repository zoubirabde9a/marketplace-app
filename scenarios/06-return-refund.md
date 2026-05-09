# SOP 06 — Return & Refund

Buyer received item, wants to return it. Refund routes via the original instrument when
possible, falling back to wallet credit or bank payout.

## Actors
- **Buyer agent** (returns scope on passport).
- **Seller agent** (configures return policy, processes RMA).
- **Platform** (refund routing, ledger).

---

## Step 1 — Buyer agent files an RMA
**Surface:** `MCP: return.request`
```json
{
  "order_id": "ord_...",
  "items": [{ "sku": "ACME-K12-MB", "qty": 1, "reason": "defective", "description": "Switch sticks" }],
  "evidence": [{ "kind": "image", "fileId": "f_..." }]
}
```
Server checks:
- order in a returnable state (delivered, within seller's `returnsPolicy.windowDays`).
- item not in a non-returnable category (perishables, custom-made).
**Result:** `rma_id`, status `pending_seller_review`.
**Status:** ⬜

## Step 2 — Seller approves & issues label
**Surface:** `MCP: return.label`
```json
{ "rma_id": "rma_...", "approved": true, "shipFromBuyer": true }
```
Generates a prepaid label (deducted from seller's balance). RMA state `awaiting_return`.
**Status:** ⬜

## Step 3 — Carrier scan → received
Asynchronous webhook from carrier flips RMA to `received`. Seller has up to N days
(per policy, default 3) to inspect and either `accept` or `dispute`.

## Step 4 — Refund
**Surface:** `MCP: return.refund` (or auto-fired on accept)
```json
{ "rma_id": "rma_...", "amountMinor": 5699, "restockingFeeMinor": 0 }
```
Server runs the routing waterfall (§7.2):
1. **Original instrument first** — if Stripe says funding source still valid → `source_transfer_reversal`. (~95% of cases.)
2. **Wallet credit** — credit `payment.wallet_balance` for principal. Returns within 7y, transferable.
3. **Manual payout** — micro-deposit / Plaid verified bank account.
4. **Issued credit-note VDC** — last resort, signed, non-expiring.

Whichever route executes, the choice is immutable on the refund record:
```json
{
  "refund_id": "ref_...",
  "amountMinor": 5699,
  "routingMethod": "original_instrument",
  "stripeRefundId": "re_..."
}
```

Ledger entries (double-entry):
- `seller_revenue → seller_refund_payable`
- `seller_refund_payable → cash`

`assertBalanced` (✅) verifies the entry. State machine moves the order line to `refunded`.
**Status:** ✅ routing decision (`refund.preview_route` MCP tool returns the chosen leg + the rejected legs with reasons; 8 tests in `mcp-server/test/refund.test.ts`); 🟡 execution leg (provider integrations not wired)

## Step 5 — Reputation adjustment
- Seller refund-rate metric ticks up. If above category baseline → counterfeit-risk re-score (§8.3).
- Buyer's account: refund-recency timestamp updated for fraud heuristics.

---

## Failure paths to test
- **Past return window** → `ConflictError return_window_expired`.
- **Already refunded** → idempotent: same `idempotency_key` returns existing refund row.
- **Routing waterfall — all 4 fail** (rare): RMA stays `refund_pending_manual_review`; on-call paged.
- **Counterfeit finding** triggers full refund + return-shipping covered by marketplace regardless of seller policy (§8.3); marketplace recoups from seller's reserve.

## Status roll-up
| Step | Status |
|------|--------|
| 1 RMA request | ⬜ |
| 2 label | ⬜ |
| 3 carrier received | ⬜ |
| 4 refund routing decision (MCP) | ✅ |
| 4b refund execution legs (Stripe / wallet / bank / VDC) | 🟡 |
| 5 reputation update | 🟡 |
