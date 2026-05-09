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

  for (const pat of INJECTION_PATTERNS) {
    if (pat.test(value)) {
      sanitized = true;
      value = value.replace(pat, "[redacted]");
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
} as const;
