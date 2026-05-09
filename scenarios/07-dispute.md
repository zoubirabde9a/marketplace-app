# SOP 07 — Dispute

Buyer claims item not as described; seller refuses refund; platform mediates.

## Actors
- **Buyer agent** (`dispute:open` scope).
- **Seller agent** (`dispute:respond` scope).
- **Platform mediator** (T&S team, mostly via tool calls).

---

## Step 1 — Open the dispute
**Surface:** `MCP: dispute.open`
```json
{
  "order_id": "ord_...",
  "kind": "not_as_described",
  "claim": "Capacity is 0.9L, listing said 1.2L.",
  "amountClaimedMinor": 5699,
  "evidence": [{ "kind": "image", "fileId": "f_..." }, { "kind": "text", "value": "Photo of measuring jug." }]
}
```
Server:
- Validates order eligibility (within dispute window).
- Looks up the original Cart Mandate VDC (§3.5) — required evidence for dispute defense.
- Holds payout for that order line in escrow if not already there.
**Status:** 🟡 (dispute domain logic ✅; tool ⬜)

## Step 2 — Seller responds
**Surface:** `MCP: dispute.respond`
```json
{
  "dispute_id": "dsp_...",
  "stance": "deny",
  "rebuttal": "Listing clearly states 1.2L; buyer received correct item.",
  "evidence": [{ "kind": "image", "fileId": "f_..." }]
}
```
Server prompts for response within configured SLA (default 72h). Auto-rules in favor of
buyer if seller doesn't respond.

## Step 3 — Mediation
- For values < $250 with a clear listing-vs-shipped-product mismatch, automated rules can resolve immediately.
- Otherwise, T&S agent reviews via `MCP: dispute.evidence_upload` + decision tools.
- Decision options: `refund_buyer_full`, `refund_buyer_partial`, `deny_claim`, `escalate`.

## Step 4 — Outcome
**`refund_buyer_full`:**
- Triggers the same routing waterfall as SOP 06 step 4.
- Marketplace recoups from seller's reserve (§8.3) if seller's reputation is poor or the issue is a confirmed counterfeit/misrepresentation.
- Seller's dispute-rate metric ticks up (reputation §7a).

**`deny_claim`:**
- Mandate VDC is the dispute-grade evidence (§3.5).
- Buyer can appeal via `dispute.appeal` (one round); separate reviewer.

**`escalate`:**
- Goes to chargeback path through Stripe. Mandate + transcript hashes attached as defense.

## Step 5 — Audit & reputation
Append-only `audit.audit_events` row chained with prior root. Both seller and buyer agent
reputations adjusted per signals (settlement count, dispute severity, recency-weighted —
§7a). Reputation is per-marketplace; export endpoint signs a VDC if either party wants
to take it elsewhere.

---

## Failure paths to test
- Seller no-show past SLA → auto-rule for buyer.
- Buyer files dispute outside window → `ConflictError dispute_window_expired`.
- Repeat-offender seller (3rd substantiated counterfeit / not-as-described in 12 months) → account termination, payouts frozen for the dispute window (§8.3).
- Coordinated buyer fraud (same buyer agent files mass disputes against many sellers) → flagged by anti-collusion scan (✅ `anti-collusion.ts`).

## Status roll-up
| Step | Status |
|------|--------|
| 1 dispute.open | 🟡 |
| 2 respond | 🟡 |
| 3 mediation | ⬜ |
| 4 outcome | 🟡 |
| 5 audit + reputation | 🟡 |

## End-to-end lifecycle journey
`agent-sim/test/dispute-lifecycle.test.ts` walks the entire dispute flow against the real
MCP tools — `order.apply_event`, `dispute.apply_event`, `dispute.check_sla`, and
`refund.preview_route` — in a single journey. 7 tests cover: seller-accepts-buyer-refund
with original-source routing; seller-defends with extra escalate step; seller-settles-own-favor
(no refund); buyer-withdraws after response; seller-silent-past-7d-SLA → auto-escalated; dispute
opened from shipped (not just delivered); and refund routing falling through to wallet when
original source isn't recreditable.

## End-to-end exercise
Two MCP tools surface the dispute state machine end-to-end: `dispute.apply_event` (apply
a transition, return new status + terminal flag + current SLA pressure) and
`dispute.check_sla` (read-only auto-escalate / approaching-deadline / hours-remaining).
12 contract tests in `mcp-server/test/dispute.test.ts` cover every forward transition,
withdraw-as-terminal, two invalid-transition rejections, three SLA paths, and missing-scope
denial. Handler-side actions (refund execution, audit emission, reputation update) remain 🟡.
