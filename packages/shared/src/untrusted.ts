// Untrusted-content envelope per spec §8a.1.
// Anything from a non-platform principal (sellers, buyers) MUST be wrapped before MCP exposure.

import { z } from "zod";

export const UntrustedContentSchema = z.object({
  role: z.literal("untrusted_content"),
  origin: z.string(), // e.g. "seller:org_xxx", "buyer:user_xxx"
  value: z.string(),
  truncated: z.boolean().optional(),
  sanitized: z.boolean().optional(),
});
export type UntrustedContent = z.infer<typeof UntrustedContentSchema>;

const INJECTION_PATTERNS: Array<RegExp> = [
  /<\/?(system|assistant|tool|user|developer)[^>]*>/gi,
  /\b(ignore (?:all |the )?(?:previous|prior|above) (?:instructions?|prompts?))/gi,
  /\b(you are now|act as|roleplay as|pretend to be) /gi,
  /\b(disregard (?:all |the )?(?:previous|prior|above) instructions)/gi,
  /\[\[(?:SYSTEM|INSTRUCTION|PROMPT)/gi,
  // ChatML / OpenAI special tokens. A seller embedding `<|im_start|>system`
  // in a product title or message can hijack a downstream ChatGPT-style
  // prompt template at the tokeniser level — many model providers parse
  // these as real role tokens even when they appear inside a "user"
  // message.
  /<\|(?:im_start|im_end|endoftext|system|user|assistant)\|>/gi,
  // Llama 2 / Llama 3 instruction tags. `[INST]` / `[/INST]` are the
  // primary delimiters; `<<SYS>>` / `<</SYS>>` wrap the system message.
  // Injection works the same way as ChatML — the tokeniser treats them
  // as role boundaries.
  /\[\/?INST\]/gi,
  /<<\/?SYS>>/gi,
  // Anthropic-style turn markers. `\n\nHuman:` / `\n\nAssistant:` were the
  // documented turn boundaries pre-Messages-API and remain in prompt
  // templates internal to many integrations. A seller writing those into
  // a product description would split the assistant's prompt context.
  /\n\n(?:Human|Assistant):/gi,
];

export interface SanitizeOptions {
  maxLength: number;
  origin: string;
}

export function sanitizeUntrusted(
  raw: string,
  opts: SanitizeOptions,
): UntrustedContent {
  let value = raw;
  let sanitized = false;

  // INJECTION_PATTERNS are module-level RegExp instances with the `g` flag.
  // `RegExp.prototype.test` on a `g` regex is stateful: it advances `lastIndex`
  // after a match and resumes from there on the next call. Because the array
  // is shared across every call to sanitizeUntrusted, a previous call could
  // leave `lastIndex` pointing past the start of the new input — so a fresh
  // string starting with an injection pattern would silently `test() === false`
  // and the sanitiser would skip the redact step entirely. Do the replace
  // unconditionally and infer "sanitized" from whether the string changed —
  // that doesn't depend on `lastIndex` at all.
  for (const pat of INJECTION_PATTERNS) {
    const replaced = value.replace(pat, "[redacted]");
    if (replaced !== value) {
      sanitized = true;
      value = replaced;
    }
  }

  let truncated = false;
  if (value.length > opts.maxLength) {
    value = value.slice(0, opts.maxLength);
    truncated = true;
  }

  const env: UntrustedContent = {
    role: "untrusted_content",
    origin: opts.origin,
    value,
  };
  if (sanitized) env.sanitized = true;
  if (truncated) env.truncated = true;
  return env;
}

export const FIELD_LIMITS = {
  productTitle: 200,
  productDescription: 16 * 1024,
  productAttribute: 1024,
  reviewBody: 8 * 1024,
  message: 4 * 1024,
  productBrand: 120,
} as const;

/**
 * Run the same injection-pattern + length sanitisation as `sanitizeUntrusted`
 * but return the cleaned string instead of the wrapped envelope. Use this for
 * fields where the wire format must stay a plain string (e.g. `brand`,
 * displayed verbatim on browse cards) but the value is still seller-controlled
 * and could otherwise carry `<system>`-style injection payloads into a
 * downstream LLM rendering surface.
 */
export function sanitizeUntrustedString(raw: string, opts: SanitizeOptions): string {
  return sanitizeUntrusted(raw, opts).value;
}

/**
 * Build a safe `origin` string for the wrapped-untrusted-content envelope.
 *
 * Every site that constructs an `origin: "<kind>:<id>"` (and many do —
 * seller/buyer/agent — across the catalog, messaging, order, dispute,
 * and checkout surfaces) needs the same two defenses:
 *
 *  1. Cap total length so a corrupted upstream id can't bloat the envelope
 *     and downstream audit/LLM-template rows.
 *  2. Strip ASCII control bytes (NUL/CR/LF/0x7F) so newlines embedded in
 *     the id can't split prompt boundaries in any LLM consumer that
 *     interpolates `origin` verbatim. JSON encoding escapes newlines on
 *     the wire, but when a consumer reads the parsed object and
 *     interpolates `origin` into a prompt template, the raw newline
 *     re-emerges and reads as a new line for the LLM.
 *
 * Passes #165–#170 applied this inline at ~10 call sites; this helper
 * consolidates the pattern so future callers can't forget either
 * defense.
 */
export function safeOrigin(kind: string, id: string | null | undefined): string {
  const safeKind = String(kind).slice(0, 32).replace(/[\x00-\x1f\x7f]/g, "?");
  const safeId = String(id ?? "unowned").slice(0, 120).replace(/[\x00-\x1f\x7f]/g, "?");
  return `${safeKind}:${safeId}`;
}

/**
 * Forbidden attribute-keys that, if used as object property names, can
 * pollute the prototype chain. `JSON.parse('{"__proto__": …}')` creates
 * `__proto__` as a real own property, which downstream `obj[key]`
 * lookups and `Object.entries` iterators then surface. Callers should
 * skip these keys when copying caller-supplied attribute maps into a
 * regular `{}` (or, better, write into an `Object.create(null)` map).
 */
export const FORBIDDEN_ATTR_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

export function isForbiddenAttrKey(key: string): boolean {
  return FORBIDDEN_ATTR_KEYS.has(key);
}
