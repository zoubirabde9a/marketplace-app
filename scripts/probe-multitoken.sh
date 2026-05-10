#!/bin/sh
set -eu
BASE="${BASE:-https://api.teno-store.com}"
probe() {
  printf '\n=== %s (q=%s) ===\n' "$1" "$2"
  curl -sS --get --data-urlencode "q=$2" --data-urlencode "limit=5" "$BASE/v1/products" | python3 -c '
import sys, json
d = json.load(sys.stdin)
for h in d["data"]:
    score = h.get("relevanceScore", 0)
    title = h["title"]["value"]
    print(f"  {round(score, 3):>7}  |  {title}")
total = d["pagination"]["totalEstimate"]
print(f"  total: {total}")
'
}

# Multi-token cases — should be much tighter now
probe "samsung note (was 184)"        "samsung note"
probe "samsung galaxy (FTS hit)"      "samsung galaxy"
probe "iphone 256gb (multi)"          "iphone 256gb"
probe "oppo find x9"                  "oppo find x9"
probe "MacBook M3"                    "MacBook M3"

# Single-token (typo tolerance must still work)
probe "iphn (single typo)"            "iphn"
probe "samsng (single typo)"          "samsng"
probe "frigo (synonym)"               "frigo"
probe "Oppo (single)"                 "Oppo"

# Regressions
probe "iphone (single)"               "iphone"
probe "pizza (no-match)"              "pizza"
