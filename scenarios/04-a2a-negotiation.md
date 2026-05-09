# SOP 04 — Agent-to-Agent Price Negotiation

A buyer agent attempts to negotiate a better unit price for a bulk order. Server enforces
seller's private floor and quantity bands; transcript is hashed for anti-collusion audit.

## Actors
- **Buyer agent** (with passport + intent mandate authorising max bid).
- **Seller policy** (server-side; seller doesn't run a real-time agent — server speaks for them).

---

## Step 1 — Buyer asks for a custom quote
**Surface:** `A2A: request_custom_quote`
```json
{
  "variantId": "ACME-K12-MB",
  "qty": 25,
  "deliverBy": "2026-06-01"
}
```
Returns the seller's *public* listing context: list price, available quantity bands, no floor.

## Step 2 — Buyer proposes a price
**Surface:** `A2A: negotiate_price` (✅ implemented end-to-end)
```json
{
  "policy": {
    "sellerOrgId": "org_acme",
    "variantId": "ACME-K12-MB",
    "floorPriceMinor": 4500,
    "listPriceMinor": 5999,
    "currency": "USD",
    "quantityBands": [
      { "minQty": 10, "discountBps": 500 },
      { "minQty": 50, "discountBps": 1200 }
    ],
    "forbiddenSegments": []
  },
  "request": {
    "buyerAgentId": "agt_alex",
    "buyerSegments": ["consumer"],
    "qty": 25,
    "proposedUnitPriceMinor": 5400,
    "now": "2026-05-04T14:00:00Z"
  }
}
```
**Server runs `evaluateNegotiation`:**
- qty 25 → falls in `minQty:10` band → `discountBps: 500` → min allowed price `5699` minor.
- proposed `5400 < 5699` → `accepted: false`, `counterUnitPriceMinor: 5699`, reason `discount_exceeds_allowed_band`.

**Status:** ✅ (live in `a2a-server`, 7 tests)

## Step 3 — Buyer accepts the counter
Buyer agent re-proposes `5699`. Same skill returns `accepted: true`, `effectiveDiscountBps: 500`.
The seller's floor `4500` is **never disclosed** to the buyer (§7b).

## Step 4 — Pin the negotiated price into a cart
**Surface:** `MCP: cart.add_item`
```json
{ "cart_id": "...", "sku": "ACME-K12-MB", "qty": 25, "negotiatedQuoteId": "neg_..." }
```
Server validates: the quote id exists, isn't expired, matches variant + qty, agent + seller match transcript.
**Status:** 🟡

## Step 5 — Transcript hashing & anti-collusion
After the dialogue closes, the server records the transcript (§7b):
- `negotiation.transcriptHash(...)` (✅) writes a SHA-256 to `messaging.agent_dialogues`.
- Periodic statistical scan (anti-collusion ✅ in `domain/negotiation/anti-collusion.ts`) runs nightly to detect coordinated bidding patterns across buyer-orgs.

## Failure paths to test
- **Below floor:** propose 4000 → `accepted:false, counterUnitPriceMinor: 4500, reason: below_floor_price`. ✅
- **Forbidden segment:** buyer in segment listed in `policy.forbiddenSegments` → `ForbiddenError negotiation_segment_blocked`. ✅
- **Invalid qty/price:** zero or negative → `ConflictError`. ✅
- **Buyer-buyer coordination signal:** anti-collusion scan flags repeating bid patterns across colluding orgs.

## Auctions (related — same skill server)
Spec §7b also defines `auction.english`, `auction.dutch`, `auction.sealed_bid`. Each is a state
machine with bids bound to a Cart Mandate pre-authorising the maximum bid.
**Status:** 🟡 (state machines ✅ in `domain/test/auctions.test.ts`; A2A skill not registered yet)

## Status roll-up
| Step | Status |
|------|--------|
| 1 request_custom_quote | ⬜ |
| 2 negotiate_price | ✅ |
| 3 accept counter | ✅ |
| 4 pin negotiated price | ✅ (in-process, via `agent-sim/negotiate-and-buy`) |
| 5 transcript hash | ✅ |
| auctions | 🟡 |
