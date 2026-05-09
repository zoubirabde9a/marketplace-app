# @marketplace/shared

Pure-utility primitives shared by every other package. No I/O, no framework
dependencies, no business logic — just reusable helpers.

## What's in here

| Module | Purpose |
| --- | --- |
| `errors.ts` | Typed error classes (`AppError`, `ValidationError`, etc.) — used at every boundary. |
| `ids.ts` | UUIDv7 generation + prefixed-ID helpers (`prd_…`, `ord_…`). |
| `logger.ts` | Structured logger interface (pino-compatible) with no transport baked in. |
| `money.ts` | Minor-units arithmetic, currency-aware formatting, no float math. |
| `result.ts` | `Result<T, E>` discriminated union for fallible operations. |
| `time.ts` | Clock abstraction (`now()`, fixed clock for tests) and ISO helpers. |
| `untrusted.ts` | `Untrusted<T>` brand + envelope helpers — see SPEC §8a.1 (prompt-injection envelope). |

Each is exported from the package root and as a named subpath
(`@marketplace/shared/money`, etc.).

## Rules

- Pure TypeScript. No `fastify`, no `drizzle`, no database client, no `fetch`.
- No state. Functions are referentially transparent unless explicitly
  documenting otherwise (e.g. `time.now()` reads the wall clock).
- Adding a new module: it must be useful to ≥2 packages. Otherwise it belongs
  in the consumer.
