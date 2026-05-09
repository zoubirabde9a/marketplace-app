# syntax=docker/dockerfile:1.7
#
# Multi-stage build for @marketplace/web (Next.js 15, App Router, React 19).
#
# Build context MUST be the repo root, not packages/web/, because the web
# package depends on workspace siblings (e.g. @marketplace/shared) via pnpm.
# Compose handles this automatically — see docker-compose.prod.yml.

# ---- builder ----------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable

# Copy lockfile + workspace metadata first for cache-friendly installs.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages ./packages

RUN pnpm install --frozen-lockfile

# NEXT_PUBLIC_* vars are inlined at build time, not runtime. Setting them in
# docker-compose's environment: section has no effect on the Next.js bundle.
# This ARG accepts the public site URL at build time so canonical/sitemap/
# robots/OG tags point at the real origin.
ARG NEXT_PUBLIC_SITE_URL=https://teno-store.com
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

# Google OAuth client ID — shipped to the browser, so NEXT_PUBLIC_*. Build-time
# inline; without this the login button has no client ID and renders an error.
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID

# @marketplace/web has no workspace siblings as deps (verify in
# packages/web/package.json), so we only need to build web itself.
RUN pnpm --filter @marketplace/web build

# ---- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3200 \
    NEXT_TELEMETRY_DISABLED=1

# Standalone output ships its own minimal node_modules, so we don't need pnpm here.
# The .next/standalone/ directory contains a self-contained Node app that
# expects .next/static/ and public/ to be alongside it.
COPY --from=builder /app/packages/web/.next/standalone ./
COPY --from=builder /app/packages/web/.next/static ./packages/web/.next/static
COPY --from=builder /app/packages/web/public ./packages/web/public

EXPOSE 3200

# server.js is the entrypoint Next.js generates inside .next/standalone.
CMD ["node", "packages/web/server.js"]
