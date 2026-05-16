#!/usr/bin/env python3
"""Add concise MCP capability declaration to agents.json so AI agents
don't waste round-trips probing resources/list and prompts/list. The
server only supports `tools` per the audit at 2026-05-16.
"""
import json
import pathlib

p = pathlib.Path(
    "/opt/marketplace/packages/web/public/.well-known/agents.json"
)
d = json.loads(p.read_text())
d["protocols"]["mcp"]["capabilities_supported"] = {
    "tools": True,
    "resources": False,
    "prompts": False,
    "logging": False,
    "completion": False,
    "instructions_field_in_initialize": False,
    "note": (
        "Tools-only MCP server (audit 2026-05-16). Probing resources/list or "
        "prompts/list returns method_not_found (-32601). Per-tool guidance "
        "is in protocols.mcp.tools[].summary and the live tool descriptions "
        "from tools/list. The initialize response carries no 'instructions' "
        "string."
    ),
}
p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
print("OK")
