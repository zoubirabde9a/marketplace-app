# Floating major-version tag — gets the current Caddy 2.x release with its
# matching Go toolchain. cache-handler tracks Caddy releases closely and may
# require a newer Go than an older pinned base ships; floating avoids the
# rebuild-time mismatch (2026-05-18: cache-handler v0.16.0 required Go 1.24,
# caddy:2.8.4-builder-alpine had 1.23, build failed).
FROM caddy:2-builder-alpine AS builder

RUN xcaddy build \
    --with github.com/caddyserver/cache-handler \
    --with github.com/mholt/caddy-ratelimit

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
