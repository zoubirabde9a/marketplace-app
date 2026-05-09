# @marketplace/domain

Business logic for every bounded context. This is where the rules live —
catalog, identity, payment, auctions, returns, dispute resolution — expressed
without reference to HTTP, MCP, or A2A.

The HTTP edge (`@marketplace/api`), MCP tool surface (`@marketplace/mcp-server`),
and A2A skill server (`@marketplace/a2a-server`) all call into this package.

## Bounded contexts

```
src/
├── cart/           # cart line items, totals, anonymous + session carts
├── catalog/        # products, variants, search, facets, ranking
├── checkout/       # quote → confirm flow, taxes, shipping, payment selection
├── dispute/        # buyer/seller dispute lifecycle, evidence, arbitration
├── escrow/         # held funds, release/refund triggers
├── identity/       # users, sellers, agent passports, sessions
├── ledger/         # double-entry account postings (immutable)
├── messaging/      # buyer/seller threads, attachments, redaction
├── negotiation/    # A2A price negotiation state machine
├── order/          # order lifecycle, fulfillment, returns
├── payment/        # payment intents, mandates, refunds, captures
├── review/         # ratings, fake-review signals, moderation hooks
├── seller/         # seller onboarding, KYB, payout config
├── subscription/   # recurring intent, per-cycle billing
└── webhooks/       # outbound webhook signing + delivery
```

Each context exports a small surface from `index.ts` — usually a service
factory (`createX(deps)`) plus the types its callers need.

## Rules

- **No HTTP types here.** No `FastifyRequest`, no `Headers`. Translate at the
  edge package.
- **Repos are interfaces, not implementations.** A context defines
  `interface ProductRepo { ... }`; the concrete Drizzle implementation lives in
  `@marketplace/db`. Tests pass an in-memory repo.
- **Errors come from `@marketplace/shared/errors`.** Don't invent a new error
  base class per context.
- **Pure functions where possible.** State changes go through the repo
  interface so they're observable in tests.

## Testing

```sh
pnpm --filter @marketplace/domain test
```

Domain tests run with no database — they wire the in-memory repos from
`@marketplace/test-utils`.
