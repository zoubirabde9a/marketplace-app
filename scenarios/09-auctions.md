# SOP 09 — Auctions (English / Dutch / Sealed-bid)

A buyer agent participates in a server-run auction. Bids are bound to a Cart Mandate that
pre-authorises the maximum amount; the seller's reserve price is never disclosed.

## Actors
- **Seller** — schedules an auction on a listing variant.
- **Buyer agent** — submits bids under an active Cart Mandate.
- **Server** — runs the state machine, enforces reserve, settles winner.

---

## Step 1 — Seller schedules the auction
**Surface:** `REST: POST /v1/auctions`
```json
{
  "kind": "english",
  "variantId": "ACME-K12-MB",
  "currency": "USD",
  "reserveMinor": 8000,
  "startingPriceMinor": 5000,
  "bidIncrementMinor": 100,
  "softCloseSeconds": 120,
  "startsAt": "2026-05-04T18:00:00Z",
  "endsAt": "2026-05-04T19:00:00Z"
}
```
Server stores reserve encrypted; only `startingPrice`, `endsAt`, `kind` are public.
**Status:** 🟡 (state machine ✅ in `domain/negotiation/auctions.ts`; REST surface not wired)

## Step 2 — Buyer pre-authorises a bid cap via mandate
**Surface:** `MCP: mandate.cart.issue`
```json
{ "passportId": "...", "scope": "auction:bid", "auctionId": "...", "maxBidMinor": 12000 }
```
Server returns a `cartMandateId`. Mandate hash is later included in every bid.
**Status:** 🟡 (mandate domain ✅; auction-scoped issuance not wired)

## Step 3 — Submit bid (English)
**Surface:** `A2A: auction.submit_bid`
```json
{ "auctionId": "...", "amountMinor": 8200, "cartMandateId": "..." }
```
Server runs `submitEnglishBid`:
- Rejects below `lastHigh + bidIncrement` → `ConflictError auction_bid_below_required:<n>`.
- Rejects outside `[startsAt, endsAt]` → `auction_bid_out_of_window`.
- Bids in last `softCloseSeconds` extend `endsAt` (anti-sniping).
- Rejects if `amountMinor > mandate.maxBidMinor` → `auction_mandate_cap_exceeded:<cap>`.
- Rejects revoked / expired / wrong-auction / wrong-bidder / mismatched mandate → `auction_mandate_*`.
**Status:** ✅ (`a2a-server/skills/auction.ts`, 11 tests in `a2a-server/test/auction.test.ts`)

## Step 4 — Settle (English)
**Surface:** server-internal at `endsAt`, exposed via `REST: GET /v1/auctions/:id`
- `settleEnglish(now)` returns `{winnerBid, finalPriceMinor, reason: "winner"}` if top bid ≥ reserve; otherwise `reserve_not_met`.
- On winner: server creates an Order from the winning bid's mandate.
**Status:** 🟡 (settlement logic ✅; order-creation handoff not wired)

## Step 5 — Dutch variant
**Surface:** `A2A: auction.accept_dutch`
- `dutchPriceAt(now)` is the current clock price (monotonically descending, floored at reserve).
- First valid `acceptDutch` closes the auction. Late bidders → `auction_already_accepted`.
- Mandate-cap enforced before state mutation (same family of `auction_mandate_*` errors).
**Status:** ✅ (`a2a-server/skills/auction.ts`, 5 tests in `a2a-server/test/auction-dutch-sealed.test.ts`)

## Step 6 — Sealed-bid variant
**Surface:** `A2A: auction.submit_sealed_bid`
- Bids hidden until `endsAt`; submission overwrites the same bidder's prior bid (one-per-bidder rule).
- `settleSealedBid` picks max amount above reserve at `endsAt`.
- Mandate-cap enforced before state mutation.
**Status:** ✅ submission (6 tests); 🟡 settle handoff to order creation

## Failure paths to test
- **Auction not open** (scheduled / closed / cancelled) → `auction_not_open:<status>`. ✅
- **Bid below increment** in English → `auction_bid_below_required`. ✅
- **Bid below clock** in Dutch → `auction_bid_below_clock`. ✅
- **Reserve not met** at settle → no winner, mandates released. ✅
- **Bid outside window** → `auction_bid_out_of_window`. ✅
- **Network partition during sealed-bid window** — bids queued for replay must not be accepted past `endsAt`.
- **Mandate revoked between bid and settle** — winning bid must be re-validated at settle time.

## Status roll-up
| Step | Status |
|------|--------|
| 1 schedule auction (REST) | 🟡 |
| 2 issue auction-scoped mandate | 🟡 |
| 3 submit English bid (A2A) | ✅ |
| 4 settle English → order | 🟡 (E2E walk-through ✅ in `agent-sim/test/auction-english.test.ts`; persistence + order-handoff still 🟡) |
| 5 Dutch accept (A2A) | ✅ |
| 6 sealed-bid submit (A2A) | ✅ |
| 6b sealed-bid settle → order | 🟡 |
