# syntax=docker/dockerfile:1.7

# ---- builder ----------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# Use the pnpm version pinned in package.json's packageManager field.
RUN corepack enable

# Copy lockfile + workspace metadata first for cache-friendly installs.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages ./packages

RUN pnpm install --frozen-lockfile
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
