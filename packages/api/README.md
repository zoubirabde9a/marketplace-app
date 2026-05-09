# @marketplace/api

The Fastify HTTP edge — the public REST surface served at
`https://api.teno-store.com` and `pnpm dev:api` locally.

This package is a thin translation layer: it parses requests, runs middleware
(auth, idempotency, audit), and calls into `@marketplace/domain`. No business
rules live here.

## Layout

```
src/
├── server.ts         # Fastify app factory — plugins, routes, error handler
├── start.ts          # Process entrypoint — reads env, builds app, listens
├── demo.ts           # `pnpm demo` — end-to-end smoke against a running server
├── routes/           # One file per resource: products, cart, orders, …
├── middleware/
│   ├── auth.ts       # OAuth 2.1 + DPoP + Agent Passport verification
│   ├── idempotency.ts# `idempotency-key` header replay protection
│   └── audit.ts      # Structured audit-log emission per request
├── repos/            # Drizzle-backed repository wiring (production)
├── auth/             # Google OAuth + session JWT helpers
├── catalog/          # HTTP-side catalog adapters (cursor, facets, search)
└── types/            # Edge-only types (request envelopes, headers)
```

## Running

```sh
pnpm dev:api          # tsx watch mode at http://127.0.0.1:3100
pnpm --filter @marketplace/api start   # built artifact (after pnpm build)
pnpm demo             # smoke test against a running dev server
```

Public endpoints — see the auth matrix in [`../../README.md`](../../README.md#end-user-human-sign-in-google-oauth)
and the full spec in [`../../SPEC.md`](../../SPEC.md) §5.

## Auth surfaces

Three coexisting auth modes, picked per route:

1. **Anonymous** — catalog browse, cart, guest checkout.
2. **Session JWT** — issued by `POST /v1/auth/google`, used by human users.
3. **Agent Passport + DPoP** — issued by an external issuer (see
   `../../minimal-issuer/`), used by agents acting on behalf of users.

The `auth` middleware decodes whichever the request carries and attaches a
typed `request.principal`. Routes assert the principal type they require.

## Tests

```sh
pnpm --filter @marketplace/api test
```

- Unit tests: handlers + middleware in isolation.
- Contract tests (`test/contract/`): exercise the JSON envelope and error
  shape against `SPEC.md` examples.
- E2E tests (`test/*-e2e.test.ts`): boot the full app with in-memory repos.

## Adding a route

1. Add a file in `src/routes/<resource>.ts` exporting a Fastify plugin.
2. Register it in `src/server.ts`.
3. Define request/response Zod schemas inline; let Fastify generate the JSON
   schema from them.
4. Call into a domain service — never reach into a repo from here.
5. Add a contract test that pins the response shape.
