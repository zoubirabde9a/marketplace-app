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
probe "frigo (was 0)"        "frigo"
probe "tlf (abbrev)"         "tlf"
probe "tel (abbrev)"         "tel"
probe "voiture (synonym auto)" "voiture"
probe "auto (synonym voiture)" "auto"
probe "pc (laptop synonym)"  "pc"
probe "casque"               "casque"
probe "iphone (regression)"  "iphone"
probe "Oppo (regression)"    "Oppo"
probe "pizza (no-match)"     "pizza"
