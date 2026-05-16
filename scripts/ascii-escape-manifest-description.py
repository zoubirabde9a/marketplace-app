#!/usr/bin/env python3
"""One-shot helper: rewrite the description string in
packages/web/src/app/manifest.ts to use \\uXXXX escapes for every
non-ASCII codepoint.

Rationale: Next.js's metadata-route serializer was reading the source
file's UTF-8 bytes as Latin-1, then re-encoding as UTF-8, producing
double-encoded mojibake in the live /manifest.webmanifest response.
Escapes carry only ASCII bytes through the build; V8 decodes them
directly to the correct codepoints regardless of how the file is read.

Idempotent: re-running on a file that's already ASCII-escaped is a no-op.
"""
import re
import sys
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "packages" / "web" / "src" / "app" / "manifest.ts"
src = PATH.read_text(encoding="utf-8")
m = re.search(r'(description:\s*\n\s*")([^"]*)(")', src, flags=re.S)
if not m:
    print("no description string found")
    sys.exit(1)
literal = m.group(2)

# Escape every non-ASCII char (codepoint >= 0x80) as \uXXXX. ASCII chars
# pass through unchanged.
escaped_parts = []
for ch in literal:
    cp = ord(ch)
    if cp < 0x80:
        escaped_parts.append(ch)
    else:
        escaped_parts.append("\\u%04x" % cp)
escaped = "".join(escaped_parts)

if escaped == literal:
    print("already ASCII (nothing to do)")
    sys.exit(0)

new_src = src[: m.start(2)] + escaped + src[m.end(2) :]
PATH.write_text(new_src, encoding="utf-8")
print("rewrote description: %d non-ASCII codepoints escaped" % sum(1 for c in literal if ord(c) >= 0x80))
