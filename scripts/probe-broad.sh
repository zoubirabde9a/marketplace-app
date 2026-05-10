#!/bin/sh
set -eu
BASE="${BASE:-https://api.teno-store.com}"

probe() {
  label="$1"; query="$2"
  printf '\n=== %s (q=%s) ===\n' "$label" "$query"
  curl -sS --get --data-urlencode "q=$query" --data-urlencode "limit=8" "$BASE/v1/products" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception as e:
    print(f"  parse error: {e}"); sys.exit(0)
for h in d.get("data", []):
    title = h["title"]["value"]
    brand = h.get("brand", "-")
    score = h.get("relevanceScore", 0)
    print(f"  {round(score, 3):>7}  |  brand={brand:<18}  |  {title}")
total = d.get("pagination", {}).get("totalEstimate", 0)
print(f"  total: {total}")
'
}

# Diacritics-light queries (Algerian customers often type Latin without accents)
probe "ecran (no accent)"     "ecran"
probe "réfrigérateur"          "réfrigérateur"
probe "refrigerateur"          "refrigerateur"
probe "telephone"              "telephone"
probe "téléphone"              "téléphone"

# Multi-word AND vs OR check (websearch_to_tsquery uses AND)
probe "iphone 15"              "iphone 15"
probe "samsung note"           "samsung note"

# Arabic / mixed
probe "arabic samsung"          "هاتف"
probe "darija (FR)"            "telephone neuf"

# Partial / brand only
probe "samsung"                 "samsung"
probe "huawei"                  "huawei"

# Common typos beyond what we already know works
probe "samsong"                 "samsong"
probe "ifone"                   "ifone"
probe "macbok"                  "macbok"

# Categories Algerian users would search
probe "voiture"                 "voiture"
probe "frigo"                   "frigo"
