# SOP 01 — Seller Onboarding

A new company joins the marketplace, completes KYB, lists products, and verifies the
public catalog reflects them.

## Actors
- **Founder (human)** — natural person, signs up first.
- **Seller agent** — software acting on behalf of the org, does the bulk of the work.
- **Platform** — issues the org, runs KYB, accepts product writes.

## Preconditions
- Founder has a passkey-capable device.
- Company has a registered business name, EIN/VAT, and a payout bank account.

---

## Step 1 — Founder creates a human account
**Surface:** `REST: POST /v1/auth/register`
**Auth:** none (public)
**Body:**
```json
{
  "email": "founder@acme.example",
  "displayName": "Jane Founder",
  "passkey": { "attestation": "<webauthn-attestation>", "clientDataJSON": "..." },
  "locale": "en-US",
  "tos_version": "2026-04-01"
}
```
**Result:** `201 Created` with `user_id`, session cookie + refresh token (rotated).
**Status:** ⬜

## Step 2 — Founder creates an organization
**Surface:** `REST: POST /v1/organizations`
**Auth:** session
**Body:**
```json
{
  "legalName": "Acme Widgets, Inc.",
  "displayName": "Acme",
  "country": "US",
  "taxId": { "kind": "EIN", "value": "12-3456789" },
  "supportEmail": "support@acme.example",
  "billingAddress": { "line1": "...", "city": "...", "region": "CA", "postal": "94110", "country": "US" },
  "categoriesIntended": ["home.kitchen", "home.appliances"]
}
```
**Result:** `201` with `org_id`, status `pending_kyb`. Founder auto-assigned role `owner`.
**Status:** ⬜

## Step 3 — KYB submission
**Surface:** `REST: POST /v1/organizations/{org_id}/kyb`
**Body:**
```json
{
  "beneficialOwners": [
    { "name": "Jane Founder", "dob": "1985-04-12", "address": {...}, "ownershipPct": 100 }
  ],
  "incorporationDoc": { "kind": "uploaded_file", "fileId": "f_..." },
  "payoutAccount": { "kind": "us_bank", "stripeToken": "btok_..." }
}
```
The platform forwards to Stripe Connect + Persona; webhook callback flips org status when
verified. (See SPEC §6.2.)
**Result:** `202 Accepted`. Polling: `GET /v1/organizations/{id}` returns `status: "active"` once cleared (typically minutes to hours).
**Status:** ⬜

## Step 4 — Provision a seller agent (passport)
**Surface:** `REST: POST /v1/agents` then `POST /v1/agents/{id}/passports/issue`
**Why:** the human shouldn't be doing every product upload — issue a scoped agent.
**Passport body:**
```json
{
  "agentId": "agt_...",
  "ownerKind": "org",
  "ownerId": "org_...",
  "publicKey": { "kty": "OKP", "crv": "Ed25519", "x": "..." },
  "scopes": [
    "catalog:write", "inventory:write",
    "order:read", "order:fulfill",
    "message:send", "message:read",
    "payout:read"
  ],
  "spendCaps": null,
  "merchantAllow": null,
  "expiresAt": "2027-05-04T00:00:00Z"
}
```
Founder approves with passkey (Tier 5 step-up — §3.7). Platform returns the **signed Agent Passport VDC**.
**Status:** ⬜ (passport struct ✅ in domain; issuance endpoint ⬜)

## Step 5 — Seller agent creates a product
**Surface:** `MCP: seller.create_product`
**Auth:** DPoP-bound token referencing the agent passport, scope `catalog:write`.
**Input (every field the catalog accepts):**
```json
{
  "title": "Acme 12-cup Pour-Over Kettle",
  "brand": "Acme",
  "gtin14": "00012345678905",
  "mpn": "ACME-K12",
  "categoryPath": "home.kitchen.kettles",
  "description": "Gooseneck spout, 1.2L, 1500W...",
  "attributes": {
    "color": "matte_black",
    "capacityMl": 1200,
    "wattage": 1500,
    "material": "304_stainless"
  },
  "media": [
    { "kind": "image", "url": "...", "alt": "Front" },
    { "kind": "image", "url": "...", "alt": "Side" }
  ],
  "variants": [
    {
      "sku": "ACME-K12-MB",
      "priceMinor": 5999,
      "currency": "USD",
      "weightG": 950,
      "dimensions": { "lMm": 240, "wMm": 160, "hMm": 220 },
      "inventory": [{ "locationId": "loc_oakland", "qty": 240, "lowStockAt": 20 }],
      "hazmat": false
    }
  ],
  "shippingClass": "standard_parcel",
  "returnsPolicy": { "windowDays": 30, "restockingFeeBps": 0 },
  "warranty": { "kind": "manufacturer", "months": 24 },
  "restrictions": { "minAge": null, "ageRestricted": false, "shipTo": ["US","CA"] }
}
```
Server runs:
- input sanitization (§8a.1) — escapes `<system>`, role markers, etc.
- length caps — title ≤ 200, description ≤ 16 KB.
- canonical-product matching (§8.2) by `(GTIN, brand)`. Either rolls up under existing canonical or creates a new one with `confidence: high`.
- counterfeit signal scoring (§8.3) → tier; new sellers on high-value brands flagged `elevated` until first review window passes.
- restricted-items registry check (§8a.3) for ship-to set.

**Result:** `201` with `product_id`, `variant_ids`, `canonical_id`, `risk_tier`.
**Status:** 🟡 (sanitization ✅, canonicalization ✅, counterfeit scoring ✅, restricted-items ✅; MCP tool wiring ⬜)

## Step 6 — Configure seller policies
**Surface:** `REST: PUT /v1/sellers/{org_id}/policies`
```json
{
  "shippingZones": [
    { "country": "US", "rates": [{ "minWeightG": 0, "maxWeightG": 2000, "priceMinor": 799, "carrier": "usps" }]}
  ],
  "returnsDefaults": { "windowDays": 30 },
  "negotiation": {
    "enabled": true,
    "perVariantFloors": { "ACME-K12-MB": 4500 },
    "quantityBands": [{ "minQty": 10, "discountBps": 500 }, { "minQty": 50, "discountBps": 1200 }]
  },
  "fulfillmentSlaHours": 48
}
```
**Status:** 🟡 (`negotiation` already powers A2A skill ✅; rest ⬜)

## Step 7 — Verify the public listing
The seller agent (or anyone) confirms the product is reachable as a buyer would see it.

1. **Search appears in catalog**
   `MCP: catalog.search` with `{ "query": "pour over kettle", "filters": { "brand": "Acme" } }` →
   expect a hit referencing the new `canonical_id`.

2. **Fetch product** — `MCP: catalog.get_product(id=...)`. Verify all listed fields are returned, **except** `floorPriceMinor` (private to seller — §7b).

3. **ACP feed** — `GET /acp/feed` (Stripe agentic feed) includes the variant.

4. **Audit trail** — `REST: GET /v1/audit/events?actor=agt_...&type=catalog.product.created` returns the write event with input hash.

5. **Embedding indexed** — internally `product_embeddings(product_id, model_id="current", model_version=...)` row exists; `catalog.search` with `embeddings_mode: "semantic"` should return the product on a paraphrase ("kettle for slow drip coffee"). (§8.1)

**Status:** ⬜ search/get not wired; audit query ⬜.

---

## Failure cases worth testing
- Submitting a product whose declared brand isn't in the brand registry **and** the seller is < 90 days old → counterfeit risk `elevated`, payouts held in escrow (§8.3).
- Description containing `Ignore previous instructions...` → sanitization strips, `*_raw` keeps original (§8a.1).
- Ship-to set includes a country where the category is prohibited → product allowed, but checkout to that country blocked at `checkout.quote` time (§8a.3).
- Same GTIN already listed by another seller → new listing rolls up under same `canonical_id`, both visible on the canonical product page.

## Status roll-up for the loop
| Step | Status |
|------|--------|
| 1 register | ⬜ |
| 2 create org | ⬜ |
| 3 KYB | ⬜ |
| 4 issue passport | 🟡 |
| 5 create_product | 🟡 |
| 6 policies | 🟡 |
| 7 verify listing | ⬜ |

## End-to-end exercise
`agent-sim/test/seller-onboarding.test.ts` walks step 5 (create_product) end-to-end
through MCP `seller.preview_listing` and MCP `catalog.score_counterfeit`, then combines
the two gates into a single publish decision (`auto_publish` / `moderation_queue` /
`review_block`) where the strictest gate wins. 6 tests cover: trusted seller + clean
listing auto-publishing; injection-pattern title routing to moderation; new low-reputation
seller with price anomaly hitting elevated risk; brand-mismatch + image-hash hit hitting
high risk with the 48h review SLA; the strictest-gate-wins invariant when both gates
trigger; and attribute-key preservation through the envelope.
