#!/usr/bin/env bash
# status.sh — one-shot health check for the scrape-and-seed loop on vps-eu.
#
# Usage (from anywhere):
#   ssh vps-eu /opt/marketplace/scripts/status.sh           # default: last 10 runs
#   ssh vps-eu /opt/marketplace/scripts/status.sh -n 30     # show last 30
#   ssh vps-eu /opt/marketplace/scripts/status.sh --errors  # show only failed runs
#   ssh vps-eu /opt/marketplace/scripts/status.sh --tail    # follow live (Ctrl-C to stop)
#
# Output sections:
#   1. systemd timer state (active? next fire? when started?)
#   2. systemd service state (last finish, exit code)
#   3. Recent runs from metrics.jsonl (parseable, one row per run)
#   4. Aggregate stats over the whole metrics.jsonl
#   5. Page-progression state (next_start_page per seller-category)
#   6. Recent error lines from per-run logs (only if any present)

set -euo pipefail

DATA_DIR="/opt/marketplace/data"
LOG_DIR="$DATA_DIR/logs"
STATE_FILE="$DATA_DIR/run-loop-state.json"
METRICS="$LOG_DIR/metrics.jsonl"

LIMIT=10
ERRORS_ONLY=0
TAIL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n)        LIMIT="$2"; shift 2 ;;
    --errors)  ERRORS_ONLY=1; shift ;;
    --tail)    TAIL=1; shift ;;
    -h|--help) sed -n '2,/^$/p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
dim()  { printf '\033[2m%s\033[0m\n' "$*"; }

if (( TAIL == 1 )); then
  bold "tailing $METRICS (Ctrl-C to exit)"
  exec tail -F "$METRICS"
fi

# ─── 1. systemd timer ────────────────────────────────────────────────────
bold "[timer]"
if systemctl is-active --quiet marketplace-scrape-loop.timer; then
  systemctl status marketplace-scrape-loop.timer --no-pager 2>/dev/null \
    | sed -n '1,5p; /Trigger:/p; /Triggers:/p' | sed 's/^/  /'
else
  echo "  marketplace-scrape-loop.timer is NOT active"
fi
echo

# ─── 2. systemd service (last invocation) ────────────────────────────────
bold "[service — last invocation]"
LAST_LINE="$(journalctl -u marketplace-scrape-loop.service -n 1 --no-pager -o short-iso 2>/dev/null | tail -1)"
echo "  $LAST_LINE"
LAST_RC="$(systemctl show marketplace-scrape-loop.service -p ExecMainStatus --value 2>/dev/null)"
LAST_RESULT="$(systemctl show marketplace-scrape-loop.service -p Result --value 2>/dev/null)"
echo "  exit_code=${LAST_RC:-?} result=${LAST_RESULT:-?}"
echo

# ─── 3. Recent runs from metrics.jsonl ───────────────────────────────────
bold "[recent runs] (most recent first, $LIMIT shown)"
if [[ ! -s "$METRICS" ]]; then
  echo "  no metrics yet"
else
  python3 - "$METRICS" "$LIMIT" "$ERRORS_ONLY" <<'PY'
import json, sys
path, limit, errors_only = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
rows = [json.loads(l) for l in open(path) if l.strip()]
rows.reverse()
header = ["ts", "pages", "next", "seeded", "dup", "invalid", "before→after", "delta"]
out = []
for r in rows:
    if len(out) >= limit: break
    seeded = r.get("seeded")
    if errors_only and (seeded is not None and seeded > 0): continue
    sp = r.get("start_page", "?")
    lp = r.get("last_page", "?")
    bf = r.get("before"); af = r.get("after"); dl = r.get("delta")
    bf_s = "?" if bf is None else str(bf)
    af_s = "?" if af is None else str(af)
    dl_s = "?" if dl is None else (f"+{dl}" if dl >= 0 else str(dl))
    out.append([
        r.get("ts","?"),
        f"{sp}..{lp}",
        str(r.get("next_start_page","?")),
        str(seeded if seeded is not None else "-"),
        str(r.get("dup_skipped") if r.get("dup_skipped") is not None else "-"),
        str(r.get("invalid_skipped") if r.get("invalid_skipped") is not None else "-"),
        f"{bf_s}→{af_s}",
        dl_s,
    ])
widths = [max(len(header[i]), *(len(row[i]) for row in out)) if out else len(header[i]) for i in range(len(header))]
def fmt(row): return "  " + "  ".join(c.ljust(w) for c, w in zip(row, widths))
print(fmt(header))
print("  " + "  ".join("-" * w for w in widths))
for row in out:
    print(fmt(row))
PY
fi
echo

# ─── 4. Aggregate stats ──────────────────────────────────────────────────
bold "[aggregate]"
if [[ ! -s "$METRICS" ]]; then
  echo "  (no data)"
else
  python3 - "$METRICS" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
real = [r for r in rows if not r.get("dry_run")]
total_seeded   = sum(r.get("seeded",0)          or 0 for r in real)
total_dup      = sum(r.get("dup_skipped",0)     or 0 for r in real)
total_invalid  = sum(r.get("invalid_skipped",0) or 0 for r in real)
zero_seeded    = sum(1 for r in real if (r.get("seeded") or 0) == 0)
print(f"  runs:          {len(rows)} ({len(real)} real, {len(rows)-len(real)} dry-run)")
print(f"  total_seeded:  {total_seeded}")
print(f"  total_dup:     {total_dup}")
print(f"  total_invalid: {total_invalid}")
print(f"  idle_runs:     {zero_seeded} (seeded=0)")
firsts = [r for r in real if r.get("before") is not None]
lasts  = [r for r in real if r.get("after")  is not None]
if firsts and lasts:
    print(f"  api_total:     {firsts[0]['before']} → {lasts[-1]['after']} ({lasts[-1]['after']-firsts[0]['before']:+d})")
PY
fi
echo

# ─── 5. Page-progression state ───────────────────────────────────────────
bold "[page-progression state]"
if [[ -s "$STATE_FILE" ]]; then
  python3 - "$STATE_FILE" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
for k, v in d.items():
    print(f"  {k}: next_start_page={v.get('next_start_page')}")
PY
else
  echo "  no state yet"
fi
echo

# ─── 6. Recent error lines ───────────────────────────────────────────────
bold "[errors in recent run logs]"
ERR_FILES="$(ls -t "$LOG_DIR"/run-*.log 2>/dev/null | sed -n '1,20p')"
if [[ -z "$ERR_FILES" ]]; then
  echo "  no run logs"
else
  ERR_LINES="$( { grep -h '\[error\]\|\[warn\]\|exit_code=[1-9]' $ERR_FILES 2>/dev/null || true; } | tail -10)"
  if [[ -z "$ERR_LINES" ]]; then
    echo "  none in the last 20 runs"
  else
    echo "$ERR_LINES" | sed 's/^/  /'
  fi
fi
