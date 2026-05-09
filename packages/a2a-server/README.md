# @marketplace/a2a-server

Agent-to-Agent skill server. Exposes the marketplace's negotiation, messaging,
and auction surfaces as A2A skills so a buyer agent and the marketplace agent
can converse over the standard A2A protocol.

Where MCP is **tool calls** (request/response), A2A is **skill conversations**
(multi-turn, with state). Use this package for negotiation flows, auction
participation, and structured messaging.

## Layout

```
src/
├── server.ts        # Fastify app exposing the A2A skill registry
└── skills/
    ├── negotiate.ts # Buyer↔seller price negotiation (offer/counter/accept)
    ├── auction.ts   # English / Dutch / sealed-bid auction participation
    └── messaging.ts # Threaded buyer↔seller messages with attachments
```

## Skill model

Each skill exports a manifest the A2A server publishes at the well-known
discovery endpoint, plus a handler that owns the conversation state machine.
Auction state machines are server-authoritative — bids are mandate-bound and
validated server-side (see [`../../SPEC.md`](../../SPEC.md) §7b).

## Running

```sh
pnpm --filter @marketplace/a2a-server dev
pnpm --filter @marketplace/a2a-server test
```

## Tests

- `test/auction.test.ts`, `test/auction-dutch-sealed.test.ts` — auction state
  machines under each format.
- `test/messaging.test.ts` — thread lifecycle + redaction.
- `test/registry.test.ts` — skill discovery / manifest shape.

## Adding a skill

1. Create `src/skills/<name>.ts` exporting `{ manifest, handler }`.
2. Register in `src/server.ts`.
3. Handler is a state machine over A2A turns — keep state in the domain
   layer, not in the handler closure.
4. Add a vitest covering happy path + at least one adversarial path
   (timeout, malformed turn, principal mismatch).
