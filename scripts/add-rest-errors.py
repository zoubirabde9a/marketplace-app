#!/usr/bin/env python3
"""One-shot helper: document REST error envelope (RFC 7807 Problem Details)
in agents.json so AI agents reading the manifest know which surface has
clean error semantics. Empirically verified 2026-05-16 — /v1/products/<bogus>
returns 404 with proper Problem Details JSON, /v1/products/<valid-nonexistent>
returns 404, /v1/products/<valid> returns 200.
"""
import json
import pathlib

p = pathlib.Path(
    "/opt/marketplace/packages/web/public/.well-known/agents.json"
)
d = json.loads(p.read_text())
d["protocols"]["rest"]["error_envelope"] = {
    "format": "RFC 7807 Problem Details (application/problem+json)",
    "fields": ["type", "title", "status", "detail", "instance"],
    "example_404": (
        '{"type":"https://marketplace.dev/errors/not-found",'
        '"title":"product not found","status":404,'
        '"detail":"No product with id=<id>",'
        '"instance":"/v1/products/<id>"}'
    ),
    "example_401": (
        '{"type":"https://marketplace.dev/errors/unauthorized",'
        '"title":"Unauthorized","status":401,'
        '"detail":"dpop_token_required",'
        '"instance":"/v1/products/"}'
    ),
    "vs_mcp": (
        "REST error semantics are correct (proper 401/404/etc with "
        "Problem Details body). MCP is different — see "
        "protocols.mcp.error_envelope, which always returns HTTP 500 "
        "with JSON-RPC error code -32000 regardless of error kind."
    ),
    "trailing_slash_quirk": (
        "GET /v1/products (no trailing slash) is the public list endpoint "
        "(200). GET /v1/products/ (with trailing slash) is treated as a "
        "different route requiring auth (401, dpop_token_required). Always "
        "use the no-slash form."
    ),
    "audit_date": "2026-05-16",
}
p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
print("OK - wrote protocols.rest.error_envelope")
