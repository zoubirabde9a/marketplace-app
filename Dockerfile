# syntax=docker/dockerfile:1.7

# ---- builder ----------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# Use the pnpm version pinned in package.json's packageManager field.
RUN corepack enable

# Cache-friendly install: copy only manifests (root + every workspace
# package.json) before running install. pnpm needs every workspace
# package.json to resolve `workspace:*` cross-refs, but does NOT need
# source. As long as no manifest changes, the install layer survives any
# source edit — which keeps the Docker build cache from ballooning by a
# fresh ~700 MB on every rebuild (the prior shape copied `packages/`
# before install, so any code edit cache-busted node_modules).
# .npmrc carries `dangerously-allow-all-builds=true` for pnpm 10's strict
# ERR_PNPM_IGNORED_BUILDS behavior on esbuild/sharp transitive build scripts.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json .npmrc ./
COPY packages/a2a-server/package.json   packages/a2a-server/
COPY packages/agent-sim/package.json    packages/agent-sim/
COPY packages/api/package.json          packages/api/
COPY packages/db/package.json           packages/db/
COPY packages/domain/package.json       packages/domain/
COPY packages/mcp-server/package.json   packages/mcp-server/
COPY packages/shared/package.json       packages/shared/
COPY packages/test-utils/package.json   packages/test-utils/
COPY packages/web/package.json          packages/web/

RUN pnpm install --frozen-lockfile

# Source comes after install so this layer changes per commit but is small.
COPY packages ./packages
# Explicit dependency-order build. We can't rely on `pnpm --filter ...` topology
# because @marketplace/domain has a package.json dep on @marketplace/db (but
# the code doesn't actually import db), which makes pnpm see a cycle and pick
# an arbitrary order — usually building db first, which then can't resolve
# its real runtime import of @marketplace/domain.
#
# Code-level order is: shared → domain → db → api.
RUN pnpm --filter @marketplace/shared build \
 && pnpm --filter @marketplace/domain build \
 && pnpm --filter @marketplace/db build \
 && pnpm --filter @marketplace/api build

# ---- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3100

RUN corepack enable

# Copy built workspace from builder (node_modules + compiled dist/ in each package).
COPY --from=builder /app /app

# .env is intentionally NOT copied (excluded by .dockerignore). It is mounted at
# runtime by docker-compose or supplied with `docker run --env-file .env`.

EXPOSE 3100

# Run the API directly with node (compiled JS from packages/api/dist).
CMD ["node", "packages/api/dist/start.js"]
