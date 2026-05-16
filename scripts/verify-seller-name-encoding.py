#!/usr/bin/env python3
"""Quick helper: print the live-API sellerDisplayName as bytes to
confirm the iter-63 'mojibake' was a Windows-side display artifact, not
a real DB issue."""
import json
import subprocess

url = (
    "https://api.teno-store.com/v1/products?sellerId="
    "019e08a4-97cd-7d98-afd7-670878dc51c2&limit=1"
)
resp = subprocess.check_output(["curl", "-s", url], text=True)
data = json.loads(resp)
name = data["data"][0]["sellerDisplayName"]
print("  name (utf-8 print):", name)
print("  bytes (hex):", " ".join(f"{b:02x}" for b in name.encode("utf-8")))
non_ascii = [(c, hex(ord(c))) for c in name if ord(c) > 0x7F]
print("  non-ASCII codepoints:", non_ascii)
print()
em_bytes_in_name = b"\xe2\x80\x94" in name.encode("utf-8")
print(
    f"  contains correct UTF-8 em-dash bytes (e2 80 94)? {em_bytes_in_name}"
)
mojibake = "â€”" in name
print(f"  contains double-encoded mojibake chars? {mojibake}")
