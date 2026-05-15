// Catalog-side sanitization: wraps seller-supplied text with the untrusted envelope
// (§8a.1) and applies field length caps before persistence.

import {
  sanitizeUntrusted,
  FIELD_LIMITS,
  safeOrigin,
  isForbiddenAttrKey,
  type UntrustedContent,
} from "@marketplace/shared/untrusted";

export interface CatalogSanitizeInput {
  sellerOrgId: string;
  title: string;
  description?: string;
  attributes: Record<string, string>;
}

export interface CatalogSanitizeResult {
  title: UntrustedContent;
  description?: UntrustedContent;
  attributes: Record<string, UntrustedContent>;
  /** Aggregate "did anything get sanitized or truncated?" flag for moderation queue routing. */
  flagged: boolean;
  /** Suspicion score 0..100 (basic heuristic — replace with classifier in production). */
  suspicionScore: number;
}

const SUSPICION_KEYWORDS = [
  "ignore previous",
  "you are now",
  "system prompt",
  "act as",
  "<system>",
  "<assistant>",
  "<tool>",
  // Mirror the tokeniser-level injection markers added to the redactor
  // (shared/untrusted pass #176). The sanitiser already strips them, but
  // the suspicion-score gate decides whether a listing routes to
  // moderation (>= 25) / review-block (>= 60) — a seller who keeps
  // submitting these markers (even though each individual attempt is
  // redacted) is signalling intent and should be queued for human review.
  "<|im_start|>",
  "<|im_end|>",
  "[inst]",
  "[/inst]",
  "<<sys>>",
  "<</sys>>",
];

export function sanitizeCatalogInput(input: CatalogSanitizeInput): CatalogSanitizeResult {
  // safeOrigin caps + strips control bytes (shared/untrusted pass #171).
  const origin = safeOrigin("seller", input.sellerOrgId);
  const title = sanitizeUntrusted(input.title, { maxLength: FIELD_LIMITS.productTitle, origin });
  const description = input.description
    ? sanitizeUntrusted(input.description, { maxLength: FIELD_LIMITS.productDescription, origin })
    : undefined;

  // Use a null-prototype map and skip the prototype-pollution-prone keys.
  // `JSON.parse('{"__proto__": …}')` produces a real own property named
  // `__proto__`, which `Object.entries` iterates and a regular `{}`
  // assignment then re-creates on the output object. Downstream consumers
  // doing `attributes[key]` lookups (or iterating Object.entries again)
  // would surface that key in product responses, audit logs, and LLM-
  // rendered prompts. Drop the dangerous names entirely.
  const attributes: Record<string, UntrustedContent> = Object.create(null) as Record<string, UntrustedContent>;
  for (const [key, value] of Object.entries(input.attributes)) {
    if (isForbiddenAttrKey(key)) continue;
    attributes[key] = sanitizeUntrusted(value, { maxLength: FIELD_LIMITS.productAttribute, origin });
  }

  let suspicion = 0;
  // Include attribute KEYS in the suspicion scan. Previously only values were
  // joined into the haystack — a malicious seller could submit
  // `{"<system>do bad</system>": "value"}` and the key would land verbatim in
  // the catalog row, available to render into any downstream LLM prompt.
  const attrKeysJoined = Object.keys(input.attributes).join("\n");
  const attrValuesJoined = Object.values(input.attributes).join("\n");
  const haystack = [
    input.title,
    input.description ?? "",
    attrKeysJoined,
    attrValuesJoined,
  ]
    .join("\n")
    .toLowerCase();
  for (const kw of SUSPICION_KEYWORDS) {
    if (haystack.includes(kw)) suspicion += 15;
  }
  suspicion = Math.min(100, suspicion);

  // Truncation alone is NOT a moderation signal — legitimate sellers
  // sometimes write verbose descriptions, and routing every overlong
  // listing to manual review adds toil for low-value signal. Only
  // sanitisation (an injection pattern matched and was redacted) or a
  // non-zero suspicion score flips the flag.
  const flagged =
    Boolean(title.sanitized) ||
    Boolean(description?.sanitized) ||
    Object.values(attributes).some((a) => a.sanitized) ||
    suspicion > 0;

  return {
    title,
    ...(description !== undefined ? { description } : {}),
    attributes,
    flagged,
    suspicionScore: suspicion,
  };
}
