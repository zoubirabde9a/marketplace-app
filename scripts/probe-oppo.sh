#!/bin/sh
set -eu
curl -sS 'https://api.teno-store.com/v1/products?q=Oppo&limit=10' \
  | python3 -c '
import sys, json
d = json.load(sys.stdin)
for h in d["data"]:
    title = h["title"]["value"]
    score = h.get("relevanceScore", 0)
    brand = h.get("brand", "-")
    print(f"  {round(score, 3):>7}  |  brand={brand:<15}  |  {title}")
p = d["pagination"]
print(f"  total: {p['totalEstimate']}")
'
