# SOP 13 — Untrusted-Content Envelope (Prompt-injection Defence)

All seller-supplied catalog text and inter-agent messages are wrapped in an untrusted-content
envelope before they reach any LLM-driven surface (search ranker, summariser, buyer-agent
context). Sanitisation, length caps, suspicion scoring, and honeypot canaries are layered
defences.

## Actors
- **Seller / sender agent** — produces text input.
- **Server (catalog or messaging)** — wraps with envelope, scores, persists.
- **Downstream consumers** — search ranker, agent context-builder, moderation queue. Must always read the envelope, never the raw string.

---

## Step 1 — Catalog text ingestion
**Surface:** `REST: POST /v1/listings` and `PATCH /v1/listings/:id`
Calls `sanitizeCatalogInput`:
- Wraps `title`, `description`, each attribute with `sanitizeUntrusted({ origin: "seller:<orgId>" })`.
- Applies field caps (`FIELD_LIMITS.productTitle/Description/Attribute`); truncated text marks `truncated: true`.
- Scans for suspicion keywords (`ignore previous`, `you are now`, `<system>`, `<assistant>`, `<tool>`, …) → `suspicionScore` 0..100.
- `flagged = true` whenever any field was sanitized OR `suspicion > 0` → routes to moderation queue.

**Status:** ✅ logic (3 tests in `domain/test/sanitize.test.ts`); ✅ MCP preview surface (`seller.preview_listing` returns wrapped fields + suspicion score + routing decision: `auto_publish` / `moderation_queue` / `review_block`, 8 tests in `mcp-server/test/seller.test.ts`); 🟡 REST publish + moderation-queue write

**Caveat (worth knowing):** `flagged` flips only on sanitisation or `suspicionScore > 0`. Pure truncation is not flagged today — fields that simply exceed `FIELD_LIMITS.productTitle/Description/Attribute` get truncated and pass through. If silent truncation is unacceptable for some field, raise a hard validation error at the seller-publish entry instead of relying on the moderation queue.

## Step 2 — Message ingestion (A2A / DM)
**Surface:** server-internal at `A2A: send_message` and `MCP: messaging.send`
Calls `sanitizeMessage`:
- Same envelope, `origin: "<senderKind>:<senderId>"`, capped at `FIELD_LIMITS.message`.
- `flagged = sanitized || truncated`. Flagged messages go to a slower delivery lane with extra moderation.

**Status:** ✅ logic + A2A surface (`messaging.send` returns wrapped body, flagged status, and `deliveryLane: "fast" | "slow_with_moderation"`, 7 tests in `a2a-server/test/messaging.test.ts`)

## Step 3 — Honeypot canaries
The server seeds occasional canary tokens in agent-visible context (e.g., a fake "system override password"). When a downstream agent action **echoes** the canary back, that is treated as proof of injection:
- Review-side: `honeypotEcho: true` → `+100` suspicion → instant suppress (SOP 12, Step 3).
- Outbound-message-side: senderId quarantined; further messages held for review.

**Status:** ⬜ (canary generator + echo-detection job not wired)

## Step 4 — Downstream consumption
Every consumer of `UntrustedContent` must:
- Read `.text` only after acknowledging `origin`. Embedding into a system-prompt position is forbidden.
- Surface `truncated`/`sanitized` flags to the user when it materially changed meaning (e.g., search snippet).
- Never feed raw seller text into a tool-call argument; argument values come from authenticated inputs (productId, sku) only.

**Status:** 🟡 (search ranker reads `.text`; full lint on raw-string reads ⬜)

## Step 5 — Audit & transparency
Each sanitization is logged with `{ orgId, field, sanitizedKinds[], suspicionScore, registryVersion, at }`. Used for:
- Repeat-offender seller penalties.
- Tuning suspicion-keyword set without redeploy.
- Quarterly transparency report.

**Status:** ⬜

## Failure paths to test
- Title with `<script>` and known prompt-injection phrase → sanitized + suspicionScore ≥ 15 + flagged. ✅
- Pure-ASCII safe title → not flagged, suspicion 0. ✅
- Message with system-tag injection → sanitized + flagged. ✅
- Description right at `FIELD_LIMITS.productDescription` → not truncated; one byte over → truncated + flagged. ✅
- Catalog ingestion timeout to moderation-queue write → reject the publish (fail-closed) rather than silently store unflagged.
- Honeypot canary detection: planted canary in agent context, agent echoes it in a review → SOP 12 instant-suppress fires.
- Argument substitution: an agent attempts to use seller-supplied attribute text as a tool-call value → rejected at the tool boundary, not just sanitized.

## Status roll-up
| Step | Status |
|------|--------|
| 1 catalog ingestion preview (MCP) | ✅ |
| 1b catalog publish + moderation-queue write | 🟡 |
| 2 message ingestion (A2A `messaging.send`) | ✅ |
| 3 honeypot canaries | ⬜ |
| 4 downstream consumption discipline | 🟡 |
| 5 audit + transparency | ⬜ |
