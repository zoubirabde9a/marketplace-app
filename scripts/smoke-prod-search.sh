#!/bin/sh
# Hits the prod API through Cloudflare and prints relevance + title for each
# query. Run from vps-eu (or anywhere that can reach api.teno-store.com).

set -eu

BASE="${BASE:-https://api.teno-store.com}"

probe() {
  label="$1"
  query="$2"
  printf '\n=== %s (q=%s) ===\n' "$label" "$query"
  curl -sS "$BASE/v1/products?q=$query&limit=3" \
    | python3 -c '
import sys, json
d = json.load(sys.stdin)
for h in d["data"]:
    print(f"  {round(h.get(chr(114)+chr(101)+chr(108)+chr(101)+chr(118)+chr(97)+chr(110)+chr(99)+chr(101)+chr(83)+chr(99)+chr(111)+chr(114)+chr(101), 0), 3):>6}  |  {h[chr(116)+chr(105)+chr(116)+chr(108)+chr(101)][chr(118)+chr(97)+chr(108)+chr(117)+chr(101)]}")
print(f"  total: {d[chr(112)+chr(97)+chr(103)+chr(105)+chr(110)+chr(97)+chr(116)+chr(105)+chr(111)+chr(110)][chr(116)+chr(111)+chr(116)+chr(97)+chr(108)+chr(69)+chr(115)+chr(116)+chr(105)+chr(109)+chr(97)+chr(116)+chr(101)]}")
'
}

probe "iphone exact"   "iphone"
probe "iphn typo"      "iphn"
probe "samsng typo"    "samsng"
probe "ipho prefix"    "ipho"
probe "robe FR"        "robe"
probe "pizza no-match" "pizza"

printf '\n=== empty browse (smoke) ===\n'
curl -sS "$BASE/v1/products?limit=1" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(f"  total: {d[chr(112)+chr(97)+chr(103)+chr(105)+chr(110)+chr(97)+chr(116)+chr(105)+chr(111)+chr(110)][chr(116)+chr(111)+chr(116)+chr(97)+chr(108)+chr(69)+chr(115)+chr(116)+chr(105)+chr(109)+chr(97)+chr(116)+chr(101)]}")'

printf '\n=== livez ===\n  '
curl -sS "$BASE/livez"
printf '\n'
