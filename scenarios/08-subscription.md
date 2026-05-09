# SOP 08 — Subscription (Recurring Purchase)

Buyer agent sets up a monthly coffee-bean subscription. Authorization survives the
original session via a Recurring Intent Mandate.

## Actors
- **Buyer agent** with `subscription:create` scope.
- **Principal (human)** — must Tier-4 step-up to sign the parent mandate (§3.7).

---

## Step 1 — Create the recurring intent mandate
**Surface:** `REST: POST /v1/mandates` (kind `recurring_intent`)
**Step-up triggered:** live passkey + 60s freshness because subscriptions are open-ended commitments.
```json
{
  "kind": "recurring_intent",
  "scope": {
    "skus": ["ACME-BEAN-12OZ"],
    "merchants": ["org_acme"],
    "currency": "USD",
    "perCycleMaxMinor": 2500,
    "totalCapMinor": 60000,
    "recurrence": { "interval": "monthly", "endAfterCycles": 24 }
  },
  "delegateTo": "marketplace_signing_key_v3",
  "principalSignature": "ed25519:..."
}
```
Server stores raw VDC + hash row (§3.5). Mandate refresh expires in 12 months
unless re-signed (§7.1).
**Status:** 🟡 (mandate domain ✅; recurring kind ⬜)

## Step 2 — Create the subscription
**Surface:** `MCP: subscription.create`
```json
{
  "mandate_id": "mnd_...",
  "items": [{ "sku": "ACME-BEAN-12OZ", "qty": 1 }],
  "schedule": { "firstChargeAt": "2026-05-04", "interval": "monthly" },
  "shipTo": "addr_..."
}
```
Returns `subscription_id`, status `active`. First cycle fires immediately.
**Status:** 🟡 (renewal logic ✅ in `domain/test/subscription-renewal.test.ts`)

## Step 3 — Per-cycle renewal (background job)
For each renewal:
1. **72h pre-charge notification** — webhook `subscription.upcoming_renewal` + email/notification to principal (§7.1). Cancellation window enforced server-side.
2. **Synthesize per-cycle Cart Mandate** from the parent recurring mandate using the marketplace's delegated signing key.
3. **Per-cycle Payment Mandate** binds to the tokenized payment instrument.
4. **Charge** — same flow as SOP 03 step 6.
5. **Order created**, fulfillment runs as normal.

**Status:** 🟡 (synthesis logic ✅; notification webhook + scheduler ⬜)

## Step 4 — Failure handling
Retry schedule (§7.1): 1d → 3d → 7d → auto-pause after 14d. Each retry uses a *fresh*
per-cycle mandate. Dunning notifications sent at each step.

## Step 5 — Modification & cancellation
**Pause:** `MCP: subscription.pause` — no charges; resumes by `subscription.resume`.
**Cancel:** `MCP: subscription.cancel` — immediate or end-of-cycle.
**Update qty / sku:** `MCP: subscription.update`. If the change increases spend, server
emits a delta Cart Mandate the principal must approve (§7.1 — proration).

---

## Failure paths to test
- Mandate refresh deadline reached without re-sign → auto-pause (no silent failure).
- Per-cycle Mandate validation fails (e.g. SKU since removed) → notify principal, pause.
- Total cap reached mid-cycle → subscription auto-completes.

## Status roll-up
| Step | Status |
|------|--------|
| 1 recurring mandate | 🟡 |
| 2 subscription.create | 🟡 |
| 3 per-cycle renewal decision (MCP `subscription.preview_renewal`) | ✅ |
| 4 failure-handling retry / auto-pause decision (MCP `subscription.plan_retry`) | ✅ |
| 4b billing-leg execution against payment provider | 🟡 |
| 5 modify/cancel | ⬜ |
