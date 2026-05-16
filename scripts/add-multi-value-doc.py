#!/usr/bin/env python3
"""Document the multi-value-filter gap in agents.json so AI agents don't
waste round-trips trying common multi-brand / multi-category syntaxes
that all silently fail. Audit 2026-05-16.
"""
import json
import pathlib

p = pathlib.Path(
    "/opt/marketplace/packages/web/public/.well-known/agents.json"
)
d = json.loads(p.read_text())

d["protocols"]["rest"]["known_limitations"]["no_multi_value_filters"] = {
    "note": (
        "Filter params accept exactly one value each. None of the common "
        "multi-value syntaxes are supported: repeated param (?brand=HP&brand=Samsung), "
        "comma-separated (?brand=HP,Samsung or URL-encoded comma), or PHP array "
        "(?brand[]=HP&brand[]=Samsung) all return wrong results or fall back to "
        "the unfiltered baseline. For multi-brand or multi-category queries, "
        "make N separate requests and merge client-side, or omit the filter "
        "and filter the response data array yourself."
    ),
    "evidence": (
        "audit 2026-05-16: ?brand=HP&brand=Samsung -> empty; "
        "?brand=HP,Samsung -> 0 (treated as literal brand 'HP,Samsung'); "
        "?brand[]=HP&brand[]=Samsung -> 49,778 (baseline, ignored); "
        "?category=informatique,telephones -> 0."
    ),
    "workaround": (
        "Sequential single-value queries combined client-side: "
        "fetch(?brand=HP) + fetch(?brand=Samsung), dedupe by productId."
    ),
}

p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
print("OK")
