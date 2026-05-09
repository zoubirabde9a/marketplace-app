# SOP 05 — Seller Fulfillment

A seller agent receives an order, ships it, and triggers payout release.

## Actors
- **Seller agent** with `order:read`, `order:fulfill` scopes.
- **Carrier integration** (USPS / DHL / etc. — adapter behind interface).

---

## Step 1 — Receive notification
The order webhook fires when buyer's checkout confirms (SOP 03 step 6).
**Webhook topic:** `order.placed`
**Surface:** the seller's registered `webhooks_outbound` URL gets:
```json
{
  "topic": "order.placed",
  "occurredAt": "2026-05-04T14:05:00Z",
  "order_id": "ord_...",
  "items": [{ "sku": "ACME-K12-MB", "qty": 25, "unitPriceMinor": 5699 }],
  "shipTo": { "...": "..." },
  "signature": "ed25519:..."
}
```
Signed with platform Ed25519 key; idempotency token + at-least-once + exponential backoff (§5.5). Webhook signing+retry logic ✅.

## Step 2 — Inspect the order
**Surface:** `MCP: order.get`
```json
{ "order_id": "ord_..." }
```
Returns lines, ship-to, customs declarations (if cross-border), buyer's mandate id (for dispute reference, not buyer PII beyond what's needed to ship).
**Status:** 🟡

## Step 3 — Reserve inventory
**Surface:** internal `inventory.reserve(variantId, qty, locationId)`
Inventory levels decremented at the chosen warehouse. Low-stock alert fires at threshold.
**Status:** ⬜

## Step 4 — Buy a label
**Surface:** `MCP: shipping.purchase_label`
```json
{
  "order_id": "ord_...",
  "carrier": "usps",
  "service": "priority",
  "fromLocationId": "loc_oakland",
  "package": { "weightG": 950, "dimsMm": [240,160,220] }
}
```
Server runs:
- carrier prohibition check (no lithium batteries / aerosols if not declared — §8a.3).
- customs declaration auto-fill from product attributes if cross-border.
- HS codes from category mapping.

Returns `label_url`, `tracking_number`, `cost_minor` (debited from seller's Stripe balance).
**Status:** ⬜

## Step 5 — Confirm fulfillment
**Surface:** `MCP: seller.fulfill_order`
```json
{
  "order_id": "ord_...",
  "shipments": [{ "tracking_number": "...", "carrier": "usps", "items": [{ "sku": "...", "qty": 25 }] }]
}
```
Server transitions order: `paid → fulfilled` via order state machine (✅).
Webhook `order.fulfilled` fires.
**Status:** 🟡 (state machine ✅; tool ⬜)

## Step 6 — Carrier scans → delivered
Asynchronous webhook from carrier integration moves state to `shipped` then `delivered`.
**Status:** ⬜

## Step 7 — Escrow release & payout
For new sellers (< 90d) or high-risk categories, payout sits in `payment.escrow_holds`:
- `escrow.scheduleRelease` (✅) computes release time from policy (e.g. 7 days post-delivery).
- `escrow.release` event refuses premature release (✅ tested).
- Once released, the original Stripe transfer settles to seller's connected account; the
  marketplace's double-entry ledger records `escrow_liability → seller_revenue`.

**Surface for seller:** `MCP: seller.payout_status` →
```json
{ "available_balance_minor": 142475, "pending_release_minor": 56990, "next_release_at": "2026-05-11T..." }
```
**Status:** 🟡 (escrow logic ✅; tool ⬜)

---

## Failure paths to test
- **Carrier rejects** (e.g. lithium battery undeclared) → `shipping.purchase_label` returns 422 with reason; order stays `paid`, alerting seller.
- **Premature escrow release attempt** → rejected (✅ `escrow.test.ts`).
- **Cancellation after fulfillment** → not allowed by state machine (✅).

## Status roll-up
| Step | Status |
|------|--------|
| 1 webhook | ✅ (delivery), ⬜ (subscription wiring) |
| 2 order.get | 🟡 |
| 3 reserve inventory | ⬜ |
| 4 purchase_label | ⬜ |
| 5 fulfill_order (state-machine MCP `order.apply_event` + `order.allowed_events`) | ✅ |
| 6 carrier scans | ⬜ |
| 7 escrow + payout | 🟡 |
