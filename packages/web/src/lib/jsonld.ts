// Serialize JSON-LD safely for embedding in <script type="application/ld+json">.
// Untrusted seller text (titles, descriptions, attributes) flows into these
// payloads, and `</script>` inside any string would close the script tag and
// allow injection. Escape the characters that matter for HTML script context
// to their unicode equivalents — JSON parsers accept either form.
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
