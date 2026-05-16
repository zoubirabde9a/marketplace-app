#!/usr/bin/env python3
"""One-shot helper: document combined-filter AND semantics, snapshot
envelope properties, and the ?inStock= silent ambiguity that the iter-57
audit surfaced.
"""
import json
import pathlib

p = pathlib.Path(
    "/opt/marketplace/packages/web/public/.well-known/agents.json"
)
d = json.loads(p.read_text())

# Add a new known_limitation for the ?inStock= silent ambiguity
d["protocols"]["rest"]["known_limitations"]["instock_filter_silent"] = {
    "note": (
        "?inStock= accepts any value but always applies the same filter "
        "(filters ~50 items off the baseline regardless of value). "
        "true/false do not differentiate. AI agents cannot use ?inStock= "
        "to fetch ONLY in-stock or ONLY out-of-stock listings."
    ),
    "evidence": (
        "audit 2026-05-16: baseline=49,660; ?inStock=true=49,606; "
        "?inStock=false=49,606; ?inStock=1=49,606; ?inStock=0=49,606."
    ),
}

# Document combined-filter semantics (positive confirmation)
d["protocols"]["rest"]["combined_filters"] = {
    "semantics": "AND (intersection)",
    "evidence": (
        "audit 2026-05-16: ?brand=HP&category=informatique=2,431, "
        "?brand=HP&category=telephones=43 - both match facets "
        "cross-distribution. Multiple filter params combine cleanly."
    ),
    "example_useful_combos": [
        "?brand=Samsung&category=telephones",
        "?brand=HP&category=informatique&sort=price_asc",
        "?sellerId=<uuid>&sort=newest",
    ],
}

# Document the snapshot envelope properties (cache, noindex, etc.)
existing = d["protocols"]["rest"].get("response_shape", {})
existing["snapshot_envelope_properties"] = {
    "url_pattern": "https://teno-store.com/s/<base64-token>",
    "ttl_seconds": 86400,
    "cache_control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400, immutable",
    "robots_meta": "noindex, nofollow (matches the /s/ Disallow in robots.txt)",
    "purpose": (
        "Each list response returns a fresh snapshot URL that pins the "
        "exact state the agent observed. Pass to a human via chat / email "
        "to let them replay it inside 24 hours. Safe to cache forever "
        "client-side (immutable directive)."
    ),
}
d["protocols"]["rest"]["response_shape"] = existing

p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
print("OK")
