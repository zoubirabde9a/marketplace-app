#!/bin/sh
set -eu
BASE="${BASE:-https://api.teno-store.com}"

probe() {
  label="$1"; query="$2"
  printf '\n=== %s (q=%s) ===\n' "$label" "$query"
  curl -sS "$BASE/v1/products?q=$query&limit=10" | python3 -c '
import sys, json
d = json.load(sys.stdin)
for h in d["data"]:
    title = h["title"]["value"]
    brand = h.get("brand", "-")
    score = h.get("relevanceScore", 0)
    print(f"  {round(score, 3):>7}  |  brand={brand:<15}  |  {title}")
total = d["pagination"]["totalEstimate"]
print(f"  total: {total}")
'
}

probe "Oppo (was buggy)"  "Oppo"
probe "iphn (typo)"        "iphn"
probe "samsng (typo)"      "samsng"
probe "ipho (prefix)"      "ipho"
probe "iphone (exact)"     "iphone"
probe "robe (FR)"          "robe"
probe "pizza (no match)"   "pizza"
