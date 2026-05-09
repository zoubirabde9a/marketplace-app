// Catalog-side sanitization: wraps seller-supplied text with the untrusted envelope
// (§8a.1) and applies field length caps before persistence.

import { sanitizeUntrusted, FIELD_LIMITS, type UntrustedContent } from "@marketplace/shared/untrusted";

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
];

export function sanitizeCatalogInput(input: CatalogSanitizeInput): CatalogSanitizeResult {
  const origin = `seller:${input.sellerOrgId}`;
  const title = sanitizeUntrusted(input.title, { maxLength: FIELD_LIMITS.productTitle, origin });
  const description = input.description
    ? sanitizeUntrusted(input.description, { maxLength: FIELD_LIMITS.productDescription, origin })
    : undefined;

  const attributes: Record<string, UntrustedContent> = {};
  for (const [key, value] of Object.entries(input.attributes)) {
    attributes[key] = sanitizeUntrusted(value, { maxLength: FIELD_LIMITS.productAttribute, origin });
  }

  let suspicion = 0;
  const haystack = `${input.title}\n${input.description ?? ""}\n${Object.values(input.attributes).join("\n")}`.toLowerCase();
  for (const kw of SUSPICION_KEYWORDS) {
    if (haystack.includes(kw)) suspicion += 15;
  }
  suspicion = Math.min(100, suspicion);

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
