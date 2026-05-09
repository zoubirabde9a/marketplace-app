# SOP 10 — Restricted-items Checkout Gate

Before checkout, the server runs the prohibited-items registry × jurisdiction matrix
against the cart. The gate also performs denied-party screening on the buyer principal.

## Actors
- **Buyer agent** — proceeds to checkout with one or more listings.
- **Server** — looks up listing classifications and applicable jurisdiction rules.
- **Restricted-items registry** — source of truth for prohibited / age / license / hazmat / export-controlled rules per `(taxonomyKey, country, subdivision)`.

---

## Step 1 — Listing classification
Each listing carries a `ListingClassification` (taxonomy keys, hazmat flag, min age,
export-control class, country of origin). Sellers set this at publish time; moderation
may override.
**Status:** 🟡 (schema ✅ in `domain/catalog/restricted-items.ts`; ingestion API not wired)

## Step 2 — Buyer context assembled at checkout
- `shipToCountry`, `shipToSubdivision` — from order address.
- `buyerVerifiedAge` — from passport claims, only if step-up auth has elevated session.
- `buyerHasLicense` — from buyer-attached credential VDC if present.
- `isSanctionedParty` — denied-party screen against OFAC + UK + EU lists.
- `carriersAvailable` — fulfillment options resolved for this ship-to.

**Status:** 🟡 (denied-party screen ⬜; carrier roster ⬜; everything else ✅)

## Step 3 — Run shippability check
**Surface:** server-internal at `POST /v1/orders` and `MCP: cart.checkout`
Calls `enforceListingShippability(listing, buyer, rules, now)` per cart line. Throws
`ForbiddenError listing_blocked:<reason>` on the first failure. Reasons:
- `buyer_sanctioned_party` — denied-party hit, short-circuits before any rule check. ✅
- `prohibited_in_jurisdiction` — taxonomy is on the prohibited list for ship-to. ✅
- `age_verification_required_<minAge>` — age unset or below threshold. ✅
- `license_required_buyer` — buyer credential missing. ✅
- `itar_destination_blocked` — ITAR-classified item shipping outside US. ✅
- `no_carrier_available` — every available carrier prohibits this taxonomy. ✅
- `hazmat_no_carrier` — hazmat item with no hazmat-capable carrier. ✅

**Status:** ✅ (logic complete, 5 tests in `domain/test/restricted-items.test.ts`)

## Step 4 — Recoverable vs hard blocks
The gate distinguishes two classes:
- **Recoverable** (UI/agent can resolve) — `age_verification_required_*`, `license_required_*`, `no_carrier_available` (try a different carrier).
- **Hard** — `prohibited_in_jurisdiction`, `itar_destination_blocked`, `buyer_sanctioned_party`, `hazmat_no_carrier`. Agent must drop the line; checkout cannot proceed for that item.

The MCP tool `cart.check_restrictions` returns per-line results with `reasonClass: "hard" | "recoverable"`, plus the `triggeredRuleVersion` and `triggeredTaxonomyKey`, so agents can cache decisions and invalidate on registry update.
**Status:** ✅ (`mcp-server/tools/cart.ts`, 8 tests in `mcp-server/test/cart.test.ts`)

## Step 5 — Audit
Every block is written to the audit log with `{principalId, listingId, ruleId, registryVersion, decidedAt}`. Used by:
- Compliance reporting.
- Seller appeals (was the rule version current?).
- Registry-update regression tests (replay last 30 days against the new registry).

**Status:** ⬜

## Failure paths to test
- Sanctioned buyer on innocuous good → still blocked. ✅
- Prohibited taxonomy with subdivision-specific rule → blocks only when `shipToSubdivision` matches. ✅
- Rule outside `[effectiveFrom, effectiveTo]` → ignored. ✅
- Hierarchical taxonomy: rule on `weapons` matches listing tagged `weapons/firearms`. ✅
- ITAR class `ITAR-Cat-IV` shipping to non-US → `itar_destination_blocked`. ✅
- Hazmat item with carriers all prohibiting hazmat → `hazmat_no_carrier`. ✅
- **Race**: registry update lands mid-checkout — block decision must use the version captured at quote time, not at order-confirm time, to keep the agent's prior `cart.quote` honored within its TTL.
- **Registry stale** — fallback policy when registry fetch times out: deny by default for `prohibited` / `export_controlled`; allow for `age_restricted` if step-up already passed.

## Status roll-up
| Step | Status |
|------|--------|
| 1 listing classification | 🟡 |
| 2 buyer context (denied-party, carriers) | 🟡 |
| 3 shippability check | ✅ |
| 4 recoverable vs hard + registry version surfaced | ✅ |
| 5 audit log | ⬜ |
