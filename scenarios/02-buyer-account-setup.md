# SOP 02 — Buyer Account Setup

A consumer signs up, registers their AI agent, and authorizes the agent to spend money on
their behalf within explicit limits.

## Actors
- **Consumer (human)** — passkey holder.
- **Buyer agent** — Claude / GPT / Gemini / custom; has its own keypair.

---

## Step 1 — Human registers
**Surface:** `REST: POST /v1/auth/register`
```json
{
  "email": "alex@example.com",
  "displayName": "Alex Buyer",
  "passkey": { "...": "..." },
  "locale": "en-GB",
  "tos_version": "2026-04-01"
}
```
**Status:** ⬜

## Step 2 — Add a payment instrument
**Surface:** `REST: POST /v1/payment-methods` (Stripe SetupIntent flow under the hood — no PAN at rest)
```json
{ "stripeSetupIntentId": "seti_..." }
```
Card is now tokenized; we only store `pm_...` ref + brand + last4.
**Status:** ⬜

## Step 3 — Add a shipping address
**Surface:** `REST: POST /v1/addresses`
```json
{
  "kind": "shipping",
  "name": "Alex Buyer",
  "line1": "1 Main St", "city": "London", "postal": "SW1A 1AA", "country": "GB",
  "phone": "+44..."
}
```
**Status:** ⬜

## Step 4 — Register a buyer agent
**Surface:** `REST: POST /v1/agents`
```json
{
  "displayName": "alex-shopper",
  "kind": "buyer",
  "publicKey": { "kty": "OKP", "crv": "Ed25519", "x": "..." },
  "modelHint": "claude-opus-4-7"
}
```
Returns `agent_id`. (Just the identity — no spending power yet.)
**Status:** ⬜

## Step 5 — Issue an Agent Passport with spend caps
**Surface:** `REST: POST /v1/agents/{id}/passports/issue`
**Triggers:** Tier 5 step-up (passkey + email challenge — §3.7). 24h cooldown if it's a scope-broadening change.
```json
{
  "scopes": ["catalog:read", "cart:write", "checkout:execute", "message:read", "message:send"],
  "spendCaps": {
    "currency": "GBP",
    "perTxMinor": 15000,
    "perDayMinor": 30000,
    "perMerchantMinor": 10000
  },
  "merchantAllow": null,
  "merchantDeny": ["org_blocked_..."],
  "categoryDeny": ["adult", "firearms"],
  "expiresAt": "2026-11-04T00:00:00Z"
}
```
**Result:** signed VDC: `{ passport_id, agent_id, owner_id, scopes, spend_caps, public_key, signature }`. Stored in `identity.agent_passports`. Audit trail commitment recorded.
**Status:** 🟡 (passport struct + spend-cap enforcement ✅ in domain; issuance API ⬜)

## Step 6 — Verify everything together
1. `GET /v1/agents/{id}/passports/active` → returns issued passport, status `active`.
2. `GET /.well-known/agent-passport-revocations` → not listed (good). (§3.6)
3. Try a privileged call without DPoP binding → `401 invalid_token` (DPoP-bound short-lived tokens — §3.3).
4. Inspect `audit.audit_events` filtered by `agent.id` → exactly two events: `agent.created`, `passport.issued`. Hash chain verifies (§4.11).

**Status:** ⬜ wiring; ✅ underlying audit-chain primitive.

---

## Test hooks
- `domain/test/passport.test.ts` (✅) covers passport issuance/expiry/revocation logic.
- `domain/test/spend-caps.test.ts` (✅) covers per-tx, per-day, per-merchant, currency-mismatch rejection.
- Missing: an integration test that runs steps 1–5 against a Fastify+Postgres testcontainer and asserts the audit events.

## Status roll-up
| Step | Status |
|------|--------|
| 1 register human | ⬜ |
| 2 payment method | ⬜ |
| 3 address | ⬜ |
| 4 register agent | ⬜ |
| 5 issue passport | 🟡 |
| 5b spend-cap dry-run (MCP `payment.check_spend_cap`) | ✅ |
| 5c velocity / step-up signal (MCP `payment.check_velocity`) | ✅ |
| 6 verify | 🟡 |
