#!/usr/bin/env python3
"""One-shot helper: add empirically-harvested per-tool OAuth scopes to
agents.json protocols.mcp.tools[].scope.

Scopes were captured by calling each MCP tool unauthenticated against the
live endpoint and parsing the "missing_scope:..." prefix from the JSON-RPC
error response.
"""
import json
import pathlib

SCOPES = {
    "seller.create_account": "seller:write",
    "product.create_listing": "seller:product:write",
    "cart.add_item": "buyer:cart:write",
    "cart.update_qty": "buyer:cart:write",
    "cart.remove_item": "buyer:cart:write",
    "cart.get": "buyer:cart:read",
    "checkout.confirm": "buyer:checkout:write",
    "order.get": "buyer:order:read",
    "seller.list_orders": "seller:order:read",
}

p = pathlib.Path(
    "/opt/marketplace/packages/web/public/.well-known/agents.json"
)
d = json.loads(p.read_text())
tools = d.get("protocols", {}).get("mcp", {}).get("tools", [])
for t in tools:
    if t.get("name") in SCOPES:
        t["scope"] = SCOPES[t["name"]]
d["protocols"]["mcp"]["scope_format"] = (
    "<role>:<resource>:<action> -- role is buyer or seller; resource is "
    "cart/order/checkout/product/(empty); action is read or write. Mint an "
    "OAuth token with the union of scopes for all tools you plan to invoke."
)
d["protocols"]["mcp"]["error_envelope"] = (
    "Tool errors return JSON-RPC error code -32000 inside an HTTP 500 "
    "response. The error.message string carries a machine-parseable prefix: "
    'Forbidden: missing_scope:<scope> for auth errors, '
    "mcp_tool_not_found:<name> for unknown tools. WARNING: the underlying "
    "HTTP 500 does not distinguish auth from server errors -- clients should "
    "parse error.message rather than retry on 500. Audit 2026-05-16."
)
p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
print("OK -- wrote scope on", len(SCOPES), "tools")
