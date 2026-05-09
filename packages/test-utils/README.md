# @marketplace/test-utils

Shared test helpers for every other package. Not published — purely internal.

## What's in here

- **In-memory repos.** Implementations of every `@marketplace/domain` repo
  interface that store data in `Map`s. Lets domain tests run with no
  database.
- **Fixed clock.** `freezeTime("2026-05-01T00:00:00Z")` for deterministic
  time-based assertions.
- **Builders.** `buildProduct(overrides)`, `buildSeller(overrides)`, etc. —
  produce valid domain objects with sane defaults so tests state only what
  matters.
- **Auth helpers.** Mint a test session JWT or a test Agent Passport without
  going through the real issuer.

## Rules

- No production code may import this package. Test-only.
- Builders return valid objects by default. If a test wants an invalid
  variant, it overrides explicitly — the default must always satisfy the
  domain invariants.
- Helpers must be deterministic. No `Date.now()`, no `Math.random()` without
  a seedable source.
