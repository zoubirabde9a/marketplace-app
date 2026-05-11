import json
from collections import defaultdict
with open("/opt/marketplace/data/logs/metrics.jsonl") as f:
    lines = f.readlines()
rows = [json.loads(l) for l in lines[-15:]]
print(f"runs sampled: {len(rows)}")
by = defaultdict(lambda: {"runs": 0, "seeded": 0, "dup": 0, "inv": 0})
for r in rows:
    c = r.get("category", "?")
    by[c]["runs"] += 1
    by[c]["seeded"] += r.get("seeded", 0) or 0
    by[c]["dup"] += r.get("dup_skipped", 0) or 0
    by[c]["inv"] += r.get("invalid_skipped", 0) or 0
for c, v in sorted(by.items()):
    print(f"  {c:35s} runs={v['runs']:>2} seeded={v['seeded']:>4} dup={v['dup']:>3} invalid={v['inv']:>3}")
print("first:", rows[0]["ts"], "last:", rows[-1]["ts"])
