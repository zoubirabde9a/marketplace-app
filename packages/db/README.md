# @marketplace/db

PostgreSQL schema, migrations, and the Drizzle ORM client used by every other
package that talks to the database.

## Layout

```
packages/db/
├── drizzle.config.ts          # drizzle-kit config (schema path, output dir, dialect)
├── migrations/                # versioned SQL — source of truth for the DB schema
│   ├── 0000_init_extensions.sql
│   └── _meta/                 # drizzle-kit journal & snapshots (do not hand-edit)
├── src/
│   ├── client.ts              # createDb({ url }) → Drizzle client + close()
│   ├── migrate.ts             # `db:migrate` entry point (applies migrations/)
│   ├── seed.ts                # `db:seed` entry point (idempotent fixtures)
│   ├── schema/                # one file per bounded context, re-exported by index.ts
│   └── repos/                 # Drizzle-backed repository implementations
└── test/
```

## Local Postgres

The compose file in the repo root defines a `postgres` service using the
`pgvector/pgvector:pg17` image so the `vector` extension is available for the
embedding columns in `0000_init_extensions.sql`.

```sh
docker compose up -d postgres
```

Connection string (also the default in `.env.example`):

```
DATABASE_URL=postgres://marketplace:marketplace@localhost:5432/marketplace
```

## Scripts

Run from the repo root (each forwards to `pnpm --filter @marketplace/db ...`):

| Command            | What it does                                                        |
| ------------------ | ------------------------------------------------------------------- |
| `pnpm db:generate` | Diff `src/schema/` against the journal, emit a new SQL migration.   |
| `pnpm db:migrate`  | Apply every unapplied migration in `migrations/` to `DATABASE_URL`. |
| `pnpm db:seed`     | Insert/upsert deterministic fixtures (safe to re-run).              |
| `pnpm db:studio`   | Launch drizzle-kit studio in the browser for ad-hoc inspection.     |

## Authoring a schema change

1. Edit the relevant file in `src/schema/` — add a column, table, index, etc.
2. Run `pnpm db:generate`. Drizzle Kit writes a new file
   `migrations/NNNN_<slug>.sql` and updates `migrations/_meta/_journal.json`.
3. **Read the generated SQL.** If it looks right, commit it as-is alongside the
   schema change in the same commit. If Drizzle Kit produces a destructive
   diff you didn't intend (a `DROP COLUMN` you don't want, a rename it
   couldn't infer), fix the schema file and re-generate — do not hand-edit
   the generated SQL to paper over it.
4. `pnpm db:migrate` to apply locally. CI and prod run the same command on
   deploy.

## When to hand-write SQL

Drizzle Kit covers structural changes (DDL) but cannot express:

- Data backfills (`UPDATE` over existing rows after adding a NOT NULL column).
- Complex constraints, partial indexes with non-trivial predicates, custom
  trigger functions, or extension-specific DDL the kit doesn't model.
- Renames it can't auto-detect — you may prefer a hand-written migration to
  preserve data instead of drop+create.

For these, use `pnpm db:generate --custom` to scaffold an empty numbered file,
then write the SQL by hand. Keep one logical change per migration so a failed
deploy is easy to reason about.

## Ordering & rollback policy

- Migrations are **forward-only**. There is no `down` script.
- To revert a change, write a new migration that undoes it. This keeps the
  journal linear and the deployed state always reproducible from `migrations/`.
- Never edit a migration that has been merged to `main`. Edit-in-place breaks
  every environment that already applied the old version.
- Renumbering or deleting an applied migration requires resetting the
  `drizzle.__drizzle_migrations` table — only acceptable on dev databases you
  control.

## Connecting at runtime

Application code should never construct a Postgres client directly. Use:

```ts
import { createDb } from "@marketplace/db";

const { db, close } = createDb({ url: process.env.DATABASE_URL! });
// ... use db ...
await close();
```

Repository implementations live under `src/repos/` and are exposed via
`createRepos(db)` so HTTP handlers depend on interfaces, not on Drizzle.
