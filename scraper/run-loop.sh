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
#   --pages N                index pages to walk (default: 2)
#   --max-listings N         hard cap on listings seeded per run (default: 50)
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
PAGES_ARG=""
MAX_LISTINGS_ARG=""
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
    --pages)             PAGES_ARG="$2"; shift 2 ;;
    --max-listings)      MAX_LISTINGS_ARG="$2"; shift 2 ;;
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
BASE="${BASE_ARG:-${MARKETPLACE_BASE:-http://api:3100}}"

if [[ -z "$SELLER_ID" ]]; then
  echo "fatal: --seller-id (or SELLER_ID env) is required" >&2
  exit 2
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
api_total_estimate() {
  docker exec "$API_CONTAINER" wget -qO- "http://127.0.0.1:3100/v1/products?limit=1" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["pagination"]["totalEstimate"])'
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
refresh_skip_urls() {
  docker exec "$PG_CONTAINER" psql -U marketplace -d marketplace -At -c "
    SELECT attributes->>'sourceUrl'
    FROM catalog.products
    WHERE seller_id='$SELLER_ID'
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
# State file shape: { "<seller>-<category>": { "next_start_page": N } }
# Each successful run advances next_start_page by PAGES, wrapping to 1
# when the scraper reports hasMorePages=false (full category covered).
STATE_KEY="${SELLER_ID}-${CATEGORY}"
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
  SCRAPE_FILE="$(ls -t "$DATA_DIR/ouedkniss-${CATEGORY}-${NOW_MIN}"*.json 2>/dev/null | head -1 || true)"
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
  SCRAPE_FILE="$(ls -t "$DATA_DIR/ouedkniss-${CATEGORY}-"*.json | head -1)"
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
BEFORE="$(api_total_estimate || echo 0)"

run_seed() {
  docker run --rm --network "$NETWORK" \
    -v "$COMPOSE_DIR:/work" -w /work \
    --env-file "$ENV_FILE" \
    -e "MARKETPLACE_BASE=$BASE" -e "SELLER_ID=$SELLER_ID" \
    -e "SKIP_URLS_FILE=/work/${SKIP_URLS_FILE#$COMPOSE_DIR/}" \
    "$NODE_IMAGE" node scripts/seed-from-scraped.mjs "${SCRAPE_FILE#$COMPOSE_DIR/}" >>"$LOG_FILE" 2>&1
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

AFTER="$(api_total_estimate || echo 0)"
DELTA=$(( AFTER - BEFORE ))

# ─── step 4: report ──────────────────────────────────────────────────────
log info "result before=$BEFORE after=$AFTER delta=$DELTA seeded=$SEEDED dup_skipped=$DUPS invalid_skipped=$SKIPPED scrape_listings=$SCRAPE_LISTINGS pages=$START_PAGE..$LAST_PAGE has_more=$HAS_MORE"

# Structured metric line — append-only JSONL for ad-hoc analysis.
printf '{"ts":"%s","run_id":"%s","seller_id":"%s","category":"%s","start_page":%s,"last_page":%s,"has_more":%s,"next_start_page":%s,"before":%s,"after":%s,"delta":%s,"seeded":%s,"dup_skipped":%s,"invalid_skipped":%s,"scrape_listings":%s,"skip_urls_count":%s}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$RUN_ID" "$SELLER_ID" "$CATEGORY" \
  "$START_PAGE" "$LAST_PAGE" "$HAS_MORE" "$NEXT_START_PAGE" \
  "$BEFORE" "$AFTER" "$DELTA" "$SEEDED" "$DUPS" "$SKIPPED" "$SCRAPE_LISTINGS" "$SKIP_COUNT" \
  >> "$METRICS_FILE"

# Brief, parseable single-line summary on stdout for cron-style invocations.
if (( QUIET == 0 )); then
  printf 'OK  pages=%s..%s next=%s before=%s after=%s delta=%s seeded=%s dup=%s invalid=%s log=%s\n' \
    "$START_PAGE" "$LAST_PAGE" "$NEXT_START_PAGE" \
    "$BEFORE" "$AFTER" "$DELTA" "$SEEDED" "$DUPS" "$SKIPPED" "$LOG_FILE"
fi
