#!/usr/bin/env python3
"""Document ETag / Last-Modified / 304 support per discovery file in
agents.json. Empirically verified 2026-05-16.
"""
import json
import pathlib

p = pathlib.Path(
    "/opt/marketplace/packages/web/public/.well-known/agents.json"
)
d = json.loads(p.read_text())

d["conditional_get_support"] = {
    "supported": [
        {"url": "https://teno-store.com/feed.xml", "headers": "ETag + Last-Modified"},
        {"url": "https://teno-store.com/llms.txt", "headers": "ETag (weak) + Last-Modified"},
        {"url": "https://teno-store.com/llms-full.txt", "headers": "ETag (weak) + Last-Modified"},
        {"url": "https://teno-store.com/.well-known/agents.json", "headers": "ETag (weak) + Last-Modified"},
    ],
    "not_supported": [
        {"url": "https://teno-store.com/sitemap.xml", "note": "no ETag, no Last-Modified. Multi-MB file; without 304 every crawler fetch returns the full body. Poll no more often than once per hour."},
        {"url": "https://teno-store.com/robots.txt", "note": "no ETag, no Last-Modified. Small file but heavily polled."},
    ],
    "verified_behaviour": (
        "Sent If-Modified-Since: <Last-Modified> back to /llms.txt — "
        "server returned HTTP 304 Not Modified. Conditional GET works "
        "on the supported list above. Audit 2026-05-16."
    ),
    "operator_followup": (
        "sitemap.xml + robots.txt should ship ETag + Last-Modified to enable "
        "304-NotModified responses for crawlers that already have a fresh "
        "copy. Localized change to the Next.js metadata routes or via "
        "middleware that hashes the response body."
    ),
}

p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
print("OK")
