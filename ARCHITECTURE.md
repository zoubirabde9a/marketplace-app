# Architecture

A 5-minute tour of the code. For the full design, see [`SPEC.md`](./SPEC.md);
for production deployment, [`deploy/`](./deploy/).

## Shape

Three external surfaces speak to the same domain core. Humans never appear
except via delegated authorization (Google sign-in → Agent Passport).

```
   Human (browser)            Agent (MCP client)         Agent (A2A peer)
        │                            │                          │
   Google OAuth                 Streamable HTTP             A2A protocol
        │                            │                          │
        ▼                            ▼                          ▼
┌──────────────┐           ┌──────────────────┐        ┌──────────────────┐
│ @mp/api      │           │ @mp/mcp-server   │        │ @mp/a2a-server   │
│ Fastify REST │           │ MCP tool surface │        │ A2A skill server │
└──────┬───────┘           └────────┬─────────┘        └────────┬─────────┘
       │                            │                           │
       └────────────────┬───────────┴───────────────────────────┘
                        ▼
               ┌──────────────────┐
               │ @mp/domain       │   ← business rules; no I/O types
               │  catalog · cart  │
               │  checkout · pay  │
               │  identity · …    │
               └────────┬─────────┘
                        │ repo interfaces
                        ▼
               ┌──────────────────┐
               │ @mp/db           │   ← Drizzle schema + repos
               │ Postgres 17 +    │
               │ pgvector         │
               └──────────────────┘
```

## Package map

| Package | Role | README |
| --- | --- | --- |
| [`shared`](./packages/shared) | Pure utilities — errors, ids, money, time, untrusted-content envelopes | ✓ |
| [`db`](./packages/db) | Drizzle schema, migrations, repo implementations | ✓ |
| [`domain`](./packages/domain) | Business logic for every bounded context | ✓ |
| [`api`](./packages/api) | Fastify HTTP edge — public REST surface | ✓ |
| [`mcp-server`](./packages/mcp-server) | MCP tool registry + transport | ✓ |
| [`a2a-server`](./packages/a2a-server) | A2A skill server (negotiation, auctions, messaging) | ✓ |
| [`agent-sim`](./packages/agent-sim) | In-process scenario harness — journeys as vitest tests | ✓ |
| [`test-utils`](./packages/test-utils) | In-memory repos, builders, fixed clock | ✓ |

## Layer rules

1. **Edge packages (`api`, `mcp-server`, `a2a-server`) parse and authorize.**
   They never carry business rules and never reach into a repo directly. They
   call domain services and translate the result into their wire format.
2. **`domain` knows nothing about HTTP, MCP, or A2A.** No `FastifyRequest`,
   no MCP frames. Repos are interfaces; the concrete Drizzle implementation
   lives in `db`. Tests pass an in-memory repo from `test-utils`.
3. **`shared` is leaf.** No package below it. No business logic.
4. **`db` owns SQL.** Migrations are forward-only and live alongside schema
   changes in the same commit.

## Auth model

Three principal types coexist:

- **Anonymous** — catalog browse, cart, guest checkout.
- **User session** — issued by `POST /v1/auth/google`; identifies a human.
- **Agent Passport + DPoP** — issued by the (external) issuer service;
  identifies an agent acting on behalf of a user, with scopes and spend caps.

The `auth` middleware in `@mp/api` decodes whichever envelope a request
carries and attaches a typed `principal`. Routes assert the principal type
they require. The MCP and A2A surfaces use the same verification path.

See [`SPEC.md` §3](./SPEC.md#3-identity-authorization--agent-trust) for the
full identity / trust model.

## Data flow — buyer purchase (worked example)

1. Buyer agent calls MCP tool `search_products` (or `GET /v1/products`).
2. Edge verifies passport, calls `domain/catalog`, returns ranked results.
3. Agent calls `add_to_cart` → `domain/cart` mutates, returns the cart.
4. Agent calls `quote_checkout` → `domain/checkout` computes taxes,
   shipping, returns a quote with a payment-mandate envelope to sign.
5. Agent signs the mandate (AP2 VDC), calls `confirm_checkout`.
6. `domain/payment` runs the payment, `domain/order` writes the order, and
   `domain/ledger` posts the double-entry rows. All three commit in one
   transaction at the `db` layer.
7. Edge returns the order. The agent (or buyer's UI) tracks status via
   `GET /v1/orders/:id` until fulfilled.

The same sequence runs end-to-end as a vitest test in
[`@mp/agent-sim/test/buyer-purchase.test.ts`](./packages/agent-sim).

## Where things live

- **"How is X exposed?"** → `api/src/routes/`, `mcp-server/src/tools/`,
  `a2a-server/src/skills/`.
- **"What does X actually do?"** → `domain/src/<context>/`.
- **"What's the table look like?"** → `db/src/schema/` and the migration
  that introduced it.
- **"How do I run X end-to-end?"** → `agent-sim/src/journeys/` and the
  matching `scenarios/NN-*.md` for the prose form.

## Further reading

- [`SPEC.md`](./SPEC.md) — full design spec
- [`scenarios/`](./scenarios/) — SOP-style scenario descriptions
- [`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md) — refinement backlog
- [`deploy/`](./deploy/) — production deployment runbooks
