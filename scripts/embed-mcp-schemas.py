#!/usr/bin/env python3
"""Embed compact per-tool input-schema summaries (required + all-params)
into each MCP tool entry in agents.json. Source of truth: live tools/list
response from the MCP server. AI agents reading the manifest now know
exactly which params each tool requires without a round-trip.
"""
import json
import pathlib
import subprocess

# Fetch live tools/list response.
mcp_resp = subprocess.run(
    [
        "curl", "-s", "-X", "POST", "https://api.teno-store.com/mcp",
        "-H", "Content-Type: application/json",
        "-H", "Accept: application/json, text/event-stream",
        "-d", '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}',
    ],
    capture_output=True, text=True, check=True,
).stdout
tools_live = json.loads(mcp_resp)["result"]["tools"]
schemas = {}
for t in tools_live:
    schema = t.get("inputSchema", {})
    schemas[t["name"]] = {
        "required": schema.get("required", []),
        "params": list(schema.get("properties", {}).keys()),
    }

p = pathlib.Path(
    "/opt/marketplace/packages/web/public/.well-known/agents.json"
)
d = json.loads(p.read_text())
for t in d["protocols"]["mcp"].get("tools", []):
    s = schemas.get(t["name"])
    if s:
        t["required_args"] = s["required"]
        t["all_args"] = s["params"]

d["protocols"]["mcp"]["schemas_note"] = (
    "Per-tool required_args + all_args are compact summaries derived from "
    "the live tools/list inputSchema. For full schemas (types, enums, "
    "descriptions, sub-object shapes), call tools/list directly on the "
    "MCP endpoint. Audit 2026-05-16."
)

p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
print(f"OK -- embedded schemas for {len(schemas)} tools")
