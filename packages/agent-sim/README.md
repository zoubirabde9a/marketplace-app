# @marketplace/agent-sim

In-process simulation harness. Runs end-to-end "agent journeys" — seller
onboarding, buyer purchase, dispute, auction, negotiation — as **vitest
tests** that exercise the same domain code as the real HTTP/MCP/A2A surfaces,
without booting a server or hitting the network.

This is the validated business-logic path documented in
[`../../README.md`](../../README.md#option-a--in-process-simulation-no-server).
It's the fastest way to verify a domain change end-to-end.

## Layout

```
src/
├── index.ts                # Harness entrypoint — wires in-memory deps
└── journeys/
    ├── seller-onboarding.ts
    ├── buyer-purchase.ts
    ├── buyer-full-lifecycle.ts
    ├── auction-english.ts
    ├── negotiate-and-buy.ts
    └── dispute-lifecycle.ts
```

Every journey has a paired test in `test/` that asserts the expected sequence
of domain events.

## Running

```sh
pnpm --filter @marketplace/agent-sim test
```

Expect 36 tests across 6 files (current as of May 2026 — counts will drift as
journeys are added).

## How journeys map to scenarios

The human-readable scenario descriptions in [`../../scenarios/`](../../scenarios/)
are the SOP-level intent. The journeys here are the executable form — same
flow, expressed as code that runs against the domain layer. When a scenario
changes shape, both should change together.

## Adding a journey

1. Add `src/journeys/<name>.ts` exporting an async function that drives the
   flow against the harness-provided dependencies.
2. Add `test/<name>.test.ts` asserting the events / final state.
3. Add or update the matching `scenarios/NN-*.md` so the human and machine
   forms stay aligned.
