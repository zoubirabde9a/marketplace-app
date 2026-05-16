#!/usr/bin/env python3
"""Add iter-70 findings to agents.json known_limitations: counterfeitRisk
silent ambiguity + the 4 silently-ignored params (?inLanguage=, ?ship_to=,
?shipping=, ?region=). Audit 2026-05-16.
"""
import json
import pathlib

p = pathlib.Path(
    "/opt/marketplace/packages/web/public/.well-known/agents.json"
)
d = json.loads(p.read_text())
d["protocols"]["rest"]["known_limitations"]["counterfeitRisk_silent"] = {
    "note": (
        "?counterfeitRisk= accepts values low/high/etc. but doesn't "
        "differentiate them. low and high both return the baseline "
        "catalog total. AI agents wanting to filter to only-low-risk "
        "listings cannot use this param — read counterfeitRisk from the "
        "response data items and filter client-side."
    ),
    "evidence": (
        "audit 2026-05-16: baseline=50033; ?counterfeitRisk=low=50033; "
        "?counterfeitRisk=high=50033."
    ),
}
d["protocols"]["rest"]["known_limitations"]["silently_ignored_filters"] = {
    "note": (
        "These commonly-tried filter params are silently accepted but "
        "have no filtering effect (return baseline): ?inLanguage=, "
        "?ship_to= (use the correct ?shipsTo= form), ?shipping=, "
        "?region=. The supported filter list is in /llms-full.txt and "
        "in the empirical-verification summary above. Don't trust filter "
        "params not on that list."
    ),
    "evidence": (
        "audit 2026-05-16: ?inLanguage=fr and ?inLanguage=ar both "
        "return baseline; ?ship_to=DZ same; ?shipping=DZ same; "
        "?region=Alger same."
    ),
}
p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
print("OK")
