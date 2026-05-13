#!/usr/bin/env bash
# run-loop.sh — one-shot Ouedkniss scrape + seed pipeline against the live API.
#
# Designed to run on `vps-eu` (the host where the marketplace docker stack
# lives). Orchestrates docker containers, no node runtime required on the host.
# Safe to invoke from cron or interactive SSH; uses a lockfile to prevent
# concurrent runs from stomping on each other.
#
# What it does, in order:
#   1. Refresh skip-urls dump from Postgres (per-seller sourceUrls already
#      in the catalog) — unless --no-dedup-refresh is passed.
#   2. Run scrape-ouedkniss.mjs in a node:22-alpine container on the
#      marketplace_default network. Up to --scrape-retries attempts with
#      exponential backoff on Ouedkniss 5xx / network failures.
#   3. Run seed-from-scraped.mjs in a similar container, with
#      SKIP_URLS_FILE pointing at the dump from step 1. Up to
#      --seed-retries attempts on hard failures (the seeder itself
#      tolerates per-listing errors and logs them).
#   4. Compare /v1/products totalEstimate before vs after, emit a structured
#      metric line, log human-readable summary.
#
# Files:
#   - Logs:    $LOG_DIR/run-YYYY-MM-DDTHH-MM-SSZ.log
#   - Metrics: $LOG_DIR/metrics.jsonl  (one JSON object per run)
#   - Lock:    $LOG_DIR/run-loop.lock  (flock-protected)
#
# Usage:
#   /opt/marketplace/scripts/run-loop.sh [options]
#
# Options:
#   --seller-id UUID         target seller (default: $SELLER_ID env)
#   --category SLUG          Ouedkniss category (default: telephones)
#   --categories LIST        Comma-separated category slugs to round-robin
#                            across runs (one category per invocation). Picks
#                            the next slug via a rotation counter stored in
#                            the state file under "_rotation/<seller>". Each
#                            category keeps its own next_start_page entry,
#                            so progress is preserved across rotations.
#                            Overrides --category if both are passed.
#   --pages N                index pages to walk (default: 2)
#   --max-listings N         hard cap on listings seeded per run (default: 50)
#   --max-products N         after seeding, prune oldest products for this
#                            seller until count <= N (cascades media+variants).
#                            Omit to disable pruning.
#   --base URL               api base for the seeder (default: http://api:3100)
#   --skip-urls-file PATH    override path to skip-urls dump
#                            (default: /opt/marketplace/data/skip_urls.txt)
#   --start-page N           override the next page to scrape (otherwise read
#                            from the state file). Useful for re-scraping a
#                            specific slice; the state file is still advanced.
#   --reset-state            reset next_start_page=1 for this seller+category
#                            before scraping. Use after a category exhausts
#                            and you want to re-walk from the top.
#   --state-file PATH        override the state file path
#                            (default: /opt/marketplace/data/run-loop-state.json)
#   --no-dedup-refresh       reuse existing skip-urls file, skip the psql dump
#   --reuse-recent-scrape    reuse the most recent scrape JSON from this UTC
#                            minute, skip re-scraping (intended for catching up
#                            after a transient failure within the same minute)
#   --dry-run                scrape only, don't seed
#   --scrape-retries N       (default: 3)
#   --seed-retries N         (default: 2)
#   --log-dir PATH           (default: /opt/marketplace/data/logs)
#   --quiet                  no stdout/stderr; everything goes to the log file
#   --help                   show this and exit
#
# Exit codes:
#   0   success (any non-error outcome; delta of 0 is fine)
#   2   bad arguments
#   3   prereqs missing (docker, api container, postgres container, network)
#   4   scrape failed all retries (transient — cron should try again)
#   5   seed failed all retries (transient)
#   6   skip-urls refresh failed (transient)
#   7   another instance is running (lock held)
#
# Env (read once, can be overridden by CLI):
#   SELLER_ID, CATEGORY, PAGES, PAGE_SIZE, MAX_LISTINGS, MAX_AGE_DAYS,
#   BATCH_PAUSE_MS, MARKETPLACE_BASE — same names the underlying mjs scripts
#   already read; pass-through via --env-file to docker.

set -euo pipefail

# ─── defaults ────────────────────────────────────────────────────────────
COMPOSE_DIR="/opt/marketplace"
SCRIPTS_DIR="$COMPOSE_DIR/scripts"
DATA_DIR="$COMPOSE_DIR/data"
ENV_FILE="$COMPOSE_DIR/.env"
NETWORK="marketplace_default"
NODE_IMAGE="node:22-alpine"
API_CONTAINER="marketplace-api"
PG_CONTAINER="marketplace-postgres"

SELLER_ID_ARG=""
CATEGORY_ARG=""
CATEGORIES_ARG=""
PAGES_ARG=""
MAX_LISTINGS_ARG=""
MAX_PRODUCTS_ARG=""
BASE_ARG=""
SKIP_URLS_FILE="$DATA_DIR/skip_urls.txt"
START_PAGE_ARG=""
DEDUP_REFRESH=1
REUSE_RECENT=0
DRY_RUN=0
SCRAPE_RETRIES=3
SEED_RETRIES=2
LOG_DIR="$DATA_DIR/logs"
STATE_FILE="$DATA_DIR/run-loop-state.json"
QUIET=0
RESET_STATE=0

usage() { sed -n '2,/^$/p' "$0" | sed 's/^# \?//'; exit 0; }

# ─── parse args ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --seller-id)         SELLER_ID_ARG="$2"; shift 2 ;;
    --category)          CATEGORY_ARG="$2"; shift 2 ;;
    --categories)        CATEGORIES_ARG="$2"; shift 2 ;;
    --pages)             PAGES_ARG="$2"; shift 2 ;;
    --max-listings)      MAX_LISTINGS_ARG="$2"; shift 2 ;;
    --max-products)      MAX_PRODUCTS_ARG="$2"; shift 2 ;;
    --base)              BASE_ARG="$2"; shift 2 ;;
    --skip-urls-file)    SKIP_URLS_FILE="$2"; shift 2 ;;
    --start-page)        START_PAGE_ARG="$2"; shift 2 ;;
    --reset-state)       RESET_STATE=1; shift ;;
    --state-file)        STATE_FILE="$2"; shift 2 ;;
    --no-dedup-refresh)  DEDUP_REFRESH=0; shift ;;
    --reuse-recent-scrape) REUSE_RECENT=1; shift ;;
    --dry-run)           DRY_RUN=1; shift ;;
    --scrape-retries)    SCRAPE_RETRIES="$2"; shift 2 ;;
    --seed-retries)      SEED_RETRIES="$2"; shift 2 ;;
    --log-dir)           LOG_DIR="$2"; shift 2 ;;
    --quiet)             QUIET=1; shift ;;
    --help|-h)           usage ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Resolve effective config: CLI > env > default. Reading .env directly here
# would conflict with docker --env-file (the mjs scripts read those values).
SELLER_ID="${SELLER_ID_ARG:-${SELLER_ID:-}}"
CATEGORY="${CATEGORY_ARG:-${CATEGORY:-telephones}}"
PAGES="${PAGES_ARG:-${PAGES:-2}}"
MAX_LISTINGS="${MAX_LISTINGS_ARG:-${MAX_LISTINGS:-50}}"
MAX_PRODUCTS="${MAX_PRODUCTS_ARG:-${MAX_PRODUCTS:-}}"
BASE="${BASE_ARG:-${MARKETPLACE_BASE:-http://api:3100}}"

# Sanity-check the cap: must be a positive integer >= 100. A typo like
# --max-products 0 or 5 would nuke the catalog; refuse loudly instead.
if [[ -n "$MAX_PRODUCTS" ]]; then
  if ! [[ "$MAX_PRODUCTS" =~ ^[0-9]+$ ]] || (( MAX_PRODUCTS < 100 )); then
    echo "fatal: --max-products must be an integer >= 100 (got '$MAX_PRODUCTS')" >&2
    exit 2
  fi
fi

# SELLER_ID is now optional: the seeder resolves a per-listing seller
# from the scraped user/store identity. If --seller-id IS set, it acts
# as a fallback for legacy dumps that don't carry seller fields, and
# scopes the skip-urls/prune queries to a single seller (legacy mode).
# When unset, both skip-urls and prune operate globally on all
# scraper-source products.

# ─── category rotation ───────────────────────────────────────────────────
# When --categories is passed (comma-separated list), round-robin one
# category per run using a rotation counter in the state file. Counter is
# stored under "_rotation/<seller>" (separate from per-category page state
# so each category keeps its own next_start_page independently).
CATEGORIES=()
if [[ -n "$CATEGORIES_ARG" ]]; then
  IFS=',' read -r -a CATEGORIES <<< "$CATEGORIES_ARG"
  # Strip whitespace from each entry.
  for i in "${!CATEGORIES[@]}"; do
    CATEGORIES[$i]="$(echo "${CATEGORIES[$i]}" | tr -d '[:space:]')"
  done
  if (( ${#CATEGORIES[@]} == 0 )); then
    echo "fatal: --categories was empty after parsing" >&2
    exit 2
  fi
  mkdir -p "$(dirname "$STATE_FILE")"
  ROT_INDEX="$(python3 -c "
import json, sys
path = '$STATE_FILE'
seller = '$SELLER_ID'
try:
    d = json.load(open(path))
except Exception:
    d = {}
rot = d.get('_rotation', {})
print(int(rot.get(seller, 0)))
")"
  N="${#CATEGORIES[@]}"
  PICK_INDEX=$(( ROT_INDEX % N ))
  CATEGORY="${CATEGORIES[$PICK_INDEX]}"
  NEXT_ROT=$(( (ROT_INDEX + 1) % N ))
  python3 -c "
import json, os
path = '$STATE_FILE'
seller = '$SELLER_ID'
nxt = $NEXT_ROT
try:
    d = json.load(open(path))
except Exception:
    d = {}
d.setdefault('_rotation', {})[seller] = nxt
tmp = path + '.tmp'
json.dump(d, open(tmp, 'w'))
os.replace(tmp, path)
"
  echo "rotation: picked '$CATEGORY' (index $PICK_INDEX/$N, next=$NEXT_ROT)" >&2
fi

mkdir -p "$LOG_DIR"
RUN_ID="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
LOG_FILE="$LOG_DIR/run-$RUN_ID.log"
METRICS_FILE="$LOG_DIR/metrics.jsonl"
LOCK_FILE="$LOG_DIR/run-loop.lock"

# ─── logging ─────────────────────────────────────────────────────────────
log() {
  local lvl="$1"; shift
  local line
  line="$(printf '%s [%s] %s' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$lvl" "$*")"
  printf '%s\n' "$line" >> "$LOG_FILE"
  if (( QUIET == 0 )); then printf '%s\n' "$line" >&2; fi
}

# ─── lock to prevent overlap ─────────────────────────────────────────────
exec 9>"$LOCK_FILE" || { echo "fatal: cannot open lock $LOCK_FILE" >&2; exit 3; }
if ! flock -n 9; then
  echo "another run-loop is already running (lock $LOCK_FILE held); exiting" >&2
  exit 7
fi

trap 'log info "exit_code=$?"' EXIT

log info "run_id=$RUN_ID seller=$SELLER_ID category=$CATEGORY pages=$PAGES max_listings=$MAX_LISTINGS base=$BASE"

# ─── prereq checks ───────────────────────────────────────────────────────
prereq_check() {
  command -v docker >/dev/null 2>&1 || { log error "docker not on PATH"; exit 3; }
  docker inspect -f . "$API_CONTAINER"   >/dev/null 2>&1 || { log error "$API_CONTAINER not running"; exit 3; }
  docker inspect -f . "$PG_CONTAINER"    >/dev/null 2>&1 || { log error "$PG_CONTAINER not running"; exit 3; }
  docker network inspect "$NETWORK" >/dev/null 2>&1 || { log error "$NETWORK not found"; exit 3; }
  [[ -d "$SCRIPTS_DIR" ]] || { log error "$SCRIPTS_DIR missing"; exit 3; }
  [[ -f "$ENV_FILE"   ]] || { log error "$ENV_FILE missing"; exit 3; }
}
prereq_check

# Ensure the node image is local before timing the run; first pull is slow
# and would distort the metrics.
docker image inspect "$NODE_IMAGE" >/dev/null 2>&1 || {
  log info "pulling $NODE_IMAGE (first run)"
  docker pull -q "$NODE_IMAGE" >>"$LOG_FILE" 2>&1 || { log error "docker pull failed"; exit 3; }
}

# ─── helpers ─────────────────────────────────────────────────────────────
# Returns the api's totalEstimate, retrying briefly if the api container
# is in the middle of being recreated (e.g. by a `docker compose up -d api`
# deploy that overlaps our run). Prints empty string + non-zero exit when
# unreachable after retries — callers must handle that to avoid bogus
# deltas like the historical `after=0 delta=-N`.
api_total_estimate() {
  local attempt=1 backoff=2 max=5 out
  while (( attempt <= max )); do
    out="$(docker exec "$API_CONTAINER" wget -qO- --timeout=10 "http://127.0.0.1:3100/v1/products?limit=1" 2>/dev/null \
      | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    n = d.get("pagination", {}).get("totalEstimate")
    if n is not None:
        print(int(n))
except Exception:
    pass
' 2>/dev/null)"
    if [[ -n "$out" ]]; then
      echo "$out"
      return 0
    fi
    log warn "api_total_estimate attempt $attempt: api unreachable; retry in ${backoff}s"
    sleep "$backoff"
    attempt=$(( attempt + 1 ))
    backoff=$(( backoff * 2 ))
  done
  echo ""
  return 1
}

with_retries() {
  # with_retries <max> <label> <cmd...>
  local max="$1" label="$2"; shift 2
  local attempt=1 backoff=2
  while :; do
    if "$@"; then return 0; fi
    if (( attempt >= max )); then
      log error "$label failed after $attempt attempts"
      return 1
    fi
    log warn "$label attempt $attempt failed; retrying in ${backoff}s"
    sleep "$backoff"
    attempt=$(( attempt + 1 ))
    backoff=$(( backoff * 2 ))
  done
}

# ─── step 1: refresh skip-urls ───────────────────────────────────────────
# Pull every sourceUrl already seeded by the scraper. Filtering by
# attributes->>'source' (set by the seeder for every scraped product) is
# the source-of-truth — scraped products carry seller_id=NULL since
# 2026-05-12, so any seller_id-based filter would match nothing.
refresh_skip_urls() {
  local where="attributes->>'source' = 'ouedkniss-public-listing'"
  docker exec "$PG_CONTAINER" psql -U marketplace -d marketplace -At -c "
    SELECT attributes->>'sourceUrl'
    FROM catalog.products
    WHERE $where
      AND attributes ? 'sourceUrl'
      AND attributes->>'sourceUrl' <> '';
  " > "$SKIP_URLS_FILE" 2>>"$LOG_FILE"
}

if (( DEDUP_REFRESH == 1 )); then
  if ! with_retries 2 "skip-urls refresh" refresh_skip_urls; then
    exit 6
  fi
else
  log info "skip-urls refresh: skipped (--no-dedup-refresh)"
fi
SKIP_COUNT=$(wc -l < "$SKIP_URLS_FILE" 2>/dev/null || echo 0)
log info "skip_urls_count=$SKIP_COUNT path=$SKIP_URLS_FILE"

# ─── step 2a: resolve START_PAGE from state ──────────────────────────────
# State file shape: { "<seller-or-global>-<category>": { "next_start_page": N } }
# Each successful run advances next_start_page by PAGES, wrapping to 1
# when the scraper reports hasMorePages=false (full category covered).
# In per-listing-seller mode (no SELLER_ID), key is "global-<category>" so
# all categories share the same page-progress namespace.
STATE_KEY="${SELLER_ID:-global}-${CATEGORY}"
read_state_page() {
  if [[ ! -s "$STATE_FILE" ]]; then echo 1; return; fi
  python3 -c "
import json, sys
try:
    d = json.load(open('$STATE_FILE'))
    print(int(d.get('$STATE_KEY', {}).get('next_start_page', 1)))
except Exception:
    print(1)
"
}
write_state_page() {
  local next="$1"
  python3 -c "
import json, os, sys
path = '$STATE_FILE'
key  = '$STATE_KEY'
nxt  = $next
try:
    d = json.load(open(path))
except Exception:
    d = {}
d.setdefault(key, {})['next_start_page'] = nxt
tmp = path + '.tmp'
json.dump(d, open(tmp, 'w'))
os.replace(tmp, path)
"
}

if (( RESET_STATE == 1 )); then
  log info "state: --reset-state, resetting next_start_page=1 for $STATE_KEY"
  write_state_page 1
fi

if [[ -n "$START_PAGE_ARG" ]]; then
  START_PAGE="$START_PAGE_ARG"
  log info "state: --start-page $START_PAGE (override; state file will still be advanced)"
else
  START_PAGE="$(read_state_page)"
  log info "state: next_start_page=$START_PAGE (from $STATE_FILE, key $STATE_KEY)"
fi

# ─── step 2b: scrape (or reuse) ──────────────────────────────────────────
SCRAPE_FILE=""
if (( REUSE_RECENT == 1 )); then
  NOW_MIN="$(date -u +%Y-%m-%dT%H-%M)"
  SCRAPE_FILE="$(ls -t "$DATA_DIR/ouedkniss-${CATEGORY}-${NOW_MIN}"*.json 2>/dev/null | sed -n '1p' || true)"
  if [[ -n "$SCRAPE_FILE" ]]; then
    log info "scrape: reusing $SCRAPE_FILE"
  else
    log info "scrape: --reuse-recent-scrape set but no file matched ${NOW_MIN}, will scrape fresh"
  fi
fi

run_scrape() {
  docker run --rm --network "$NETWORK" \
    -v "$COMPOSE_DIR:/work" -w /work \
    --env-file "$ENV_FILE" \
    -e "CATEGORY=$CATEGORY" -e "PAGES=$PAGES" -e "MAX_LISTINGS=$MAX_LISTINGS" \
    -e "START_PAGE=$START_PAGE" -e "MAX_AGE_DAYS=0" \
    "$NODE_IMAGE" node scripts/scrape-ouedkniss.mjs >>"$LOG_FILE" 2>&1
}

if [[ -z "$SCRAPE_FILE" ]]; then
  if ! with_retries "$SCRAPE_RETRIES" "scrape" run_scrape; then
    exit 4
  fi
  SCRAPE_FILE="$(ls -t "$DATA_DIR/ouedkniss-${CATEGORY}-"*.json | sed -n '1p')"
  log info "scrape: wrote $SCRAPE_FILE"
fi

# Pull lastPageScraped + hasMorePages from the scrape JSON to advance state.
read -r LAST_PAGE HAS_MORE SCRAPE_LISTINGS < <(python3 -c "
import json, sys
d = json.load(open('$SCRAPE_FILE'))
print(d.get('lastPageScraped', 0), str(d.get('hasMorePages', False)).lower(), len(d.get('items', [])))
" 2>/dev/null || echo "0 false 0")

# Advance state for next run. If category exhausted, wrap to 1.
if [[ "$HAS_MORE" == "true" ]]; then
  NEXT_START_PAGE=$(( LAST_PAGE + 1 ))
else
  NEXT_START_PAGE=1
  log info "state: scraper reports hasMorePages=false at page $LAST_PAGE; wrapping to 1"
fi
write_state_page "$NEXT_START_PAGE"
log info "state: advanced next_start_page=$NEXT_START_PAGE (last_page_scraped=$LAST_PAGE has_more=$HAS_MORE)"

if (( DRY_RUN == 1 )); then
  log info "dry-run: skipping seed step (scrape_listings=$SCRAPE_LISTINGS)"
  printf '{"ts":"%s","run_id":"%s","seller_id":"%s","category":"%s","scrape_listings":%s,"dry_run":true}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$RUN_ID" "$SELLER_ID" "$CATEGORY" "$SCRAPE_LISTINGS" \
    >> "$METRICS_FILE"
  exit 0
fi

# ─── step 3: seed ────────────────────────────────────────────────────────
BEFORE="$(api_total_estimate || true)"
if [[ -z "$BEFORE" ]]; then
  log warn "could not measure 'before' total — api unreachable. Continuing seed anyway."
fi

run_seed() {
  # Direct-DB seeder via the api image. Bypasses the HTTP auth surface
  # entirely (no DEV_BYPASS, no session JWT, no DPoP) — writes go through
  # the same db repos the API uses, so resulting rows are indistinguishable
  # from API-created products. See packages/db/src/seed-from-scraped.ts.
  # DATABASE_URL is built from POSTGRES_PASSWORD in $ENV_FILE (compose
  # constructs it the same way for the api service); we don't ship a
  # standalone DATABASE_URL var. Data dir is mounted read-only so the
  # seeder can read both the scrape JSON and the skip-urls file.
  local pg_password
  pg_password="$(grep -E '^POSTGRES_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
  if [[ -z "$pg_password" ]]; then
    log error "POSTGRES_PASSWORD not found in $ENV_FILE — cannot build DATABASE_URL"
    return 1
  fi
  docker run --rm --network "$NETWORK" \
    -v "$COMPOSE_DIR/data:/data:ro" \
    -e "DATABASE_URL=postgres://marketplace:${pg_password}@postgres:5432/marketplace" \
    -e "SELLER_ID=$SELLER_ID" \
    -e "SKIP_URLS_FILE=/data/${SKIP_URLS_FILE#$COMPOSE_DIR/data/}" \
    marketplace-api:local \
    node packages/db/dist/seed-from-scraped.js "/data/${SCRAPE_FILE#$COMPOSE_DIR/data/}" >>"$LOG_FILE" 2>&1
}

if ! with_retries "$SEED_RETRIES" "seed" run_seed; then
  exit 5
fi

# Parse the seeder's tail line: "seeded N products, skipped M/K (D as already-seeded duplicates)"
SEEDED=0; SKIPPED=0; DUPS=0
SUMMARY="$(grep -E '^seeded [0-9]+ products' "$LOG_FILE" | tail -1 || true)"
if [[ -n "$SUMMARY" ]]; then
  SEEDED="$(  echo "$SUMMARY" | sed -nE 's/^seeded ([0-9]+).*/\1/p')"
  SKIPPED="$( echo "$SUMMARY" | sed -nE 's/.*skipped ([0-9]+)\/.*/\1/p')"
  DUPS="$(    echo "$SUMMARY" | sed -nE 's/.*\(([0-9]+) as already-seeded.*/\1/p')"
fi

# ─── step 3.5: push newly-seeded URLs to IndexNow ─────────────────────────
# The seeder logs each new product as "  <productId> — <title> (DZD <price>)".
# We extract productIds from this run's log, build /product/<id> URLs, and
# pipe them into the IndexNow submitter. Bing/Yandex/Seznam/Naver learn
# about the URL within seconds of the seed; without this hook they had to
# wait for /sitemap.xml to be re-crawled (hours+).
#
# Non-blocking: failures are warned, never break the run. The seed itself
# is the source of truth — IndexNow is best-effort acceleration.
NEW_URLS=$(grep -oE '"  [0-9a-f-]{36} — ' "$LOG_FILE" | awk '{print $2}' | sort -u || true)
NEW_URL_COUNT=$(echo -n "$NEW_URLS" | grep -c "^" || true)
if [[ "$NEW_URL_COUNT" -gt 0 ]]; then
  if echo "$NEW_URLS" | sed 's|^|https://teno-store.com/product/|' \
    | docker run --rm --network marketplace_default -i \
        -v /opt/marketplace:/work -w /work \
        node:22-alpine node scripts/indexnow-submit.mjs --stdin \
        >> "$LOG_FILE" 2>&1; then
    log info "indexnow: pushed $NEW_URL_COUNT newly-seeded urls"
  else
    log warn "indexnow: push of $NEW_URL_COUNT urls failed (non-fatal — sitemap will catch up)"
  fi
fi

AFTER="$(api_total_estimate || true)"
if [[ -z "$AFTER" ]]; then
  log warn "could not measure 'after' total — api unreachable after seed. Reporting delta=?"
fi
if [[ -n "$BEFORE" && -n "$AFTER" ]]; then
  DELTA=$(( AFTER - BEFORE ))
else
  DELTA=""
fi

# ─── step 3.6: prune oldest products to cap ──────────────────────────────
# Keeps the catalog at a steady size: after seeding, delete the oldest
# (created_at ASC) until count <= MAX_PRODUCTS. Filtered by
# attributes->>'source' = 'ouedkniss-public-listing' so only scraper-
# created rows are eligible — scraped products carry seller_id=NULL
# since 2026-05-12, so any seller_id-based filter would be a no-op.
# Cascades wipe catalog.media + catalog.product_variants + inventory_levels
# automatically (via the FK onDelete: cascade in the schema). Images live
# as URL refs only — there is no local image bytes to clean up.
PRUNED=0
if [[ -n "$MAX_PRODUCTS" ]]; then
  PRUNE_WHERE="attributes->>'source' = 'ouedkniss-public-listing'"
  PRUNE_OUT="$(docker exec "$PG_CONTAINER" psql -U marketplace -d marketplace -At -v ON_ERROR_STOP=1 -c "
    WITH excess AS (
      SELECT id FROM catalog.products
      WHERE $PRUNE_WHERE
      ORDER BY created_at DESC, id DESC
      OFFSET $MAX_PRODUCTS
    ),
    deleted AS (
      DELETE FROM catalog.products
      WHERE id IN (SELECT id FROM excess)
      RETURNING 1
    )
    SELECT count(*) FROM deleted;
  " 2>>"$LOG_FILE" || echo "")"
  if [[ "$PRUNE_OUT" =~ ^[0-9]+$ ]]; then
    PRUNED="$PRUNE_OUT"
    log info "prune: deleted $PRUNED products older than rank $MAX_PRODUCTS (cap=$MAX_PRODUCTS)"
  else
    log warn "prune: delete query returned no count — assuming 0. See log for psql error."
  fi
else
  log info "prune: disabled (no --max-products)"
fi

# ─── step 4: report ──────────────────────────────────────────────────────
log info "result before=$BEFORE after=$AFTER delta=$DELTA seeded=$SEEDED dup_skipped=$DUPS invalid_skipped=$SKIPPED pruned=$PRUNED cap=${MAX_PRODUCTS:-none} scrape_listings=$SCRAPE_LISTINGS pages=$START_PAGE..$LAST_PAGE has_more=$HAS_MORE"

# Structured metric line — append-only JSONL for ad-hoc analysis.
# `before`/`after`/`delta` become JSON null when the api was unreachable
# (instead of silently logging 0, which used to produce bogus deltas).
printf '{"ts":"%s","run_id":"%s","seller_id":"%s","category":"%s","start_page":%s,"last_page":%s,"has_more":%s,"next_start_page":%s,"before":%s,"after":%s,"delta":%s,"seeded":%s,"dup_skipped":%s,"invalid_skipped":%s,"pruned":%s,"max_products":%s,"scrape_listings":%s,"skip_urls_count":%s}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$RUN_ID" "$SELLER_ID" "$CATEGORY" \
  "$START_PAGE" "$LAST_PAGE" "$HAS_MORE" "$NEXT_START_PAGE" \
  "${BEFORE:-null}" "${AFTER:-null}" "${DELTA:-null}" \
  "$SEEDED" "$DUPS" "$SKIPPED" "$PRUNED" "${MAX_PRODUCTS:-null}" "$SCRAPE_LISTINGS" "$SKIP_COUNT" \
  >> "$METRICS_FILE"

# Brief, parseable single-line summary on stdout for cron-style invocations.
# `?` substitutes for unmeasured before/after/delta so they stand out at a glance.
if (( QUIET == 0 )); then
  printf 'OK  pages=%s..%s next=%s before=%s after=%s delta=%s seeded=%s dup=%s invalid=%s pruned=%s log=%s\n' \
    "$START_PAGE" "$LAST_PAGE" "$NEXT_START_PAGE" \
    "${BEFORE:-?}" "${AFTER:-?}" "${DELTA:-?}" "$SEEDED" "$DUPS" "$SKIPPED" "$PRUNED" "$LOG_FILE"
fi
