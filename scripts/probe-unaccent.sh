#!/bin/sh
set -eu
BASE="${BASE:-https://api.teno-store.com}"
probe() {
  label="$1"; query="$2"
  printf '\n=== %s (q=%s) ===\n' "$label" "$query"
  curl -sS --get --data-urlencode "q=$query" --data-urlencode "limit=6" "$BASE/v1/products" | python3 -c '
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

probe "refrigerateur (was 0)"  "refrigerateur"
probe "réfrigérateur (with)"   "réfrigérateur"
probe "ecran (was partial)"    "ecran"
probe "Écran (with)"           "Écran"
probe "telephone (regression)" "telephone"
probe "téléphone (regression)" "téléphone"
probe "scelle (was 0?)"        "scelle"
probe "iphone (regression)"    "iphone"
probe "Oppo (regression)"      "Oppo"
probe "samsng (typo regress)"  "samsng"
probe "pizza (no-match)"       "pizza"
