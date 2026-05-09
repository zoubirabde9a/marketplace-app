# Runbook 07 — deploy a change to vps-eu

How to push a code change from the operator's laptop to the production stack on `vps-eu`. **Manual** by design (single operator, no CI yet — see `protocols.md` § Deploy mechanics for the rationale).

## TL;DR

```bash
# 1. From repo root, ship the working tree to the server
#    .env / .env.* are excluded — the laptop's dev .env must NOT overwrite
#    /opt/marketplace/.env (the prod secrets file). See 2026-05-09 CHANGELOG.
tar --exclude=node_modules --exclude=.next --exclude=dist --exclude=.git \
    --exclude='.env' --exclude='.env.*' \
    -czf - . \
  | ssh vps-eu "tar -xzf - -C /opt/marketplace"

# 2. Rebuild & restart on the server
ssh vps-eu '
  cd /opt/marketplace
  docker compose -f docker-compose.prod.yml build api web
  docker compose -f docker-compose.prod.yml up -d api web caddy
  docker compose -f docker-compose.prod.yml ps
'

# 3. Verify
curl -sS https://api.teno-store.com/livez
curl -sSI https://teno-store.com/ | head -1
```

End-to-end: ~3 minutes for a typical change. ~15 s of traffic loss while `api` / `web` containers restart (acceptable until we have real users).

## When to use which subcommand

| Type of change | Rebuild needed? | Command |
|---|---|---|
| Edit a `Caddyfile` | No image rebuild | `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile` |
| Edit `.env` (server-side, `/opt/marketplace/.env`) | No image rebuild; container reads on start | `docker compose restart api` (or `web`, depending on which env var) |
| Add a TypeScript dep, change web/api code | **Yes**, rebuild image | full TL;DR above |
| Run a DB migration after a schema change | No rebuild needed | `docker compose exec api pnpm --filter @marketplace/db db:migrate` |
| Static asset only (e.g. `packages/web/public/foo.png`) | Re-tar + restart `web` | `tar | ssh` then `docker compose up -d web` |

## Pre-flight checks (do these every time)

```bash
# On the laptop — type-check + tests should pass before shipping
pnpm typecheck
pnpm test

# Confirm the diff is what you expect
git status
git diff --stat
```

## Detailed steps

### 1. Sync the source tree

The repo at `/opt/marketplace` is a snapshot, not a git checkout. We use `tar | ssh` so `node_modules`, `.next`, `dist`, `.git`, and **any `.env` / `.env.*` file** don't get shipped (the build artifacts rebuild inside the image; the prod secrets live only at `/opt/marketplace/.env` on the server and shipping the laptop's dev `.env` would clobber them — this happened on 2026-05-09 and broke the first restart attempt). If you ever need a clean wipe:

```bash
ssh vps-eu 'rm -rf /opt/marketplace/* /opt/marketplace/.??*'
# then re-tar
```

### 2. Build the images

The Compose file's `build:` keys point at `packages/api/Dockerfile` and `packages/web/Dockerfile`. Both are multi-stage. The web image needs the `NEXT_PUBLIC_SITE_URL` arg at build time (see CHANGELOG 2026-05-08 for the SEO bug this fixed):

```yaml
# docker-compose.prod.yml (excerpt)
web:
  build:
    context: .
    dockerfile: packages/web/Dockerfile
    args:
      NEXT_PUBLIC_SITE_URL: ${NEXT_PUBLIC_SITE_URL}
```

`NEXT_PUBLIC_SITE_URL` lives in `/opt/marketplace/.env` and **must** be set to `https://teno-store.com` for the canonical URL, sitemap host, and robots.txt host to render correctly.

### 3. Bring services back up

`docker compose up -d` is idempotent — it leaves running containers alone unless their image hash changed. So a rebuild followed by `up -d` only restarts the containers whose image actually changed.

If the api or db schema changed, run migrations after `up -d`:

```bash
ssh vps-eu '
  cd /opt/marketplace
  docker compose -f docker-compose.prod.yml exec api pnpm --filter @marketplace/db db:migrate
'
```

### 4. Smoke tests

```bash
curl -sS https://api.teno-store.com/livez                        # → {"status":"ok"}
curl -sSI https://teno-store.com/                                # → 200
curl -sSI https://www.teno-store.com/                            # → 301 → apex
curl -sS https://teno-store.com/sitemap.xml | grep -c '<url>'    # → ≥ 2
```

If any of those fail, check container logs:

```bash
ssh vps-eu 'docker compose -f /opt/marketplace/docker-compose.prod.yml logs --tail=200 api web caddy'
```

### 5. Record the change

Append a `deploy/CHANGELOG.md` entry. Format:

```
## YYYY-MM-DD — short summary of what shipped

- Bullet 1.
- Bullet 2.
```

This is the only audit trail we have — don't skip it.

## Rollback

If a deploy breaks production:

```bash
# Option A: rebuild from a clean local checkout of the last good commit
git checkout <last-good-sha>
# … re-run the TL;DR …

# Option B: revert just the running container (works only if the previous image is still on the host)
ssh vps-eu '
  cd /opt/marketplace
  docker images --format "{{.Repository}}:{{.Tag}} {{.ID}}" | grep marketplace
  # find the previous IMAGE ID, then:
  docker tag <prev-id> marketplace-api:local
  docker compose -f docker-compose.prod.yml up -d api
'
```

Docker keeps old images around until you `docker image prune`. As long as you haven't pruned, Option B is the fastest rollback.

## Things that are NOT deploys

Avoid using this runbook for:
- Editing files **on** the server with `vim` / `nano`. The repo at `/opt/marketplace` is a deploy artifact, not source-of-truth. Edit locally, deploy.
- Running `git pull` on the server. There's no `.git` directory there by design.

## When to graduate to CI

This runbook becomes painful once any of the following is true:
- Two or more operators ship code (concurrent `tar | ssh` will race).
- Deploys happen more than ~3× per day.
- Smoke tests need more steps than fit on a postcard.

The migration path is in `protocols.md` § Deploy mechanics: GitHub Actions builds an arm64 image on push to `main`, pushes it to GHCR, then either (a) `vps-eu` runs a watchtower-style poller, or (b) the action SSHs in and runs `docker compose pull && up -d`. Today is **not** that day.
