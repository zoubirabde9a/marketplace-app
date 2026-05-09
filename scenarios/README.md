# Scenarios — Standard Operating Procedures

Step-by-step playbooks for common end-to-end journeys. Because this marketplace has
**no UI**, every step is a concrete API or MCP/A2A tool call. Each scenario is written
so it can become an integration test (`agent-sim`) once the underlying surface is wired.

| # | File | Actor | Outcome |
|---|------|-------|---------|
| 01 | [seller-onboarding.md](./01-seller-onboarding.md) | Company / seller agent | Account → org → KYB → products → public listing verified |
| 02 | [buyer-account-setup.md](./02-buyer-account-setup.md) | Human + buyer agent | Account → passport issuance → spend caps → first mandate |
| 03 | [buyer-purchase.md](./03-buyer-purchase.md) | Buyer agent | Search → cart → quote → checkout → order |
| 04 | [a2a-negotiation.md](./04-a2a-negotiation.md) | Buyer agent ↔ seller policy | `negotiate_price` skill, counter-offers, transcript |
| 05 | [seller-fulfillment.md](./05-seller-fulfillment.md) | Seller agent | Receive order → fulfill → ship → notify |
| 06 | [return-refund.md](./06-return-refund.md) | Buyer + seller agents | RMA → label → refund routing |
| 07 | [dispute.md](./07-dispute.md) | Buyer agent + platform | Open dispute → evidence → arbitration → resolution |
| 08 | [subscription.md](./08-subscription.md) | Buyer agent | Recurring intent mandate → per-cycle renewal |
| 09 | [auctions.md](./09-auctions.md) | Buyer agent + seller + server | Schedule → bid (English/Dutch/sealed) → settle → order |
| 10 | [restricted-items-checkout-gate.md](./10-restricted-items-checkout-gate.md) | Server (gate) | Classification × jurisdiction + denied-party screen at checkout |
| 11 | [counterfeit-handling.md](./11-counterfeit-handling.md) | Server + brand owner + seller | Risk score → action ladder → arbitration → buyer auto-refund |
| 12 | [review-moderation.md](./12-review-moderation.md) | Buyer + server | Verified-purchase gate → coordination scoring → visible / excluded / suppressed |
| 13 | [prompt-injection-envelope.md](./13-prompt-injection-envelope.md) | Server | Untrusted-content envelope, sanitisation, honeypot canaries across catalog + messaging |

## Conventions used in every scenario

- **Calls** are shown as `<surface>: <noun.verb>` — e.g. `MCP: catalog.search`, `REST: POST /v1/orders`, `A2A: negotiate_price`. Surface names match `SPEC.md` §5.
- **Auth header** abbreviated to `Authorization: DPoP <jwt>` — assume OAuth 2.1 + DPoP throughout (§3.3).
- **Idempotency** — every mutating call carries `Idempotency-Key: <uuid>` (§5.1).
- **Status legend** at the bottom of each file:
  - ✅ implemented and unit-tested today
  - 🟡 domain logic exists, surface (REST/MCP/A2A) not wired
  - ⬜ not started

These status flags drive the improvement loop — moving a step from ⬜ → 🟡 → ✅ is one iteration.
