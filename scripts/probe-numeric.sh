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

probe "256gb (no space)"      "256gb"
probe "256 gb (space)"        "256 gb"
probe "iphone 256gb"          "iphone 256gb"
probe "iphone 256 gb"         "iphone 256 gb"
probe "12gb ram"              "12gb ram"
probe "16/512"                "16/512"
probe "5g"                    "5g"

# Regressions
probe "iphone (regression)"   "iphone"
probe "frigo (synonym regress)" "frigo"
probe "Oppo (regression)"     "Oppo"
probe "pizza (no-match)"      "pizza"
