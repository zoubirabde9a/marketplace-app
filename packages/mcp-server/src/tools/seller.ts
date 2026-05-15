// Seller tools — preview a listing through the untrusted-content envelope before
// committing to publish. Returns the wrapped fields, the moderation routing flag,
// and the suspicion score so an agent (or seller UI) can iterate before submitting.
// See SOP 13 step 1.

import { z } from "zod";
import { sanitizeCatalogInput } from "@marketplace/domain/catalog/sanitize";
import { FIELD_LIMITS } from "@marketplace/shared/untrusted";
import type { McpRegistry } from "../registry.js";

const Wrapped = z.object({
  role: z.literal("untrusted_content"),
  origin: z.string(),
  value: z.string(),
  truncated: z.boolean().optional(),
  sanitized: z.boolean().optional(),
});

// `preview_listing` is by-design a "what would happen if I submit this?"
// tool, so we MUST accept input that exceeds FIELD_LIMITS — the whole point
// is to let the seller see truncation/sanitisation/flagging *before* they
// commit. The bounds below are therefore DoS guards (10× the corresponding
// FIELD_LIMIT or higher), not policy gates: they reject obviously-malicious
// 10 MB payloads while still leaving headroom to demonstrate truncation.
// The attribute-count cap matches the search-side MAX_ATTR_FILTERS=32
// (catalog/types.ts pass #87) so attribute-map size is bounded consistently.
const Input = z.object({
  sellerOrgId: z.string().min(1).max(120),
  title: z.string().min(1).max(FIELD_LIMITS.productTitle * 10),
  description: z.string().max(FIELD_LIMITS.productDescription * 4).optional(),
  attributes: z
    .record(z.string().max(120), z.string().max(FIELD_LIMITS.productAttribute * 10))
    .default({})
    .refine((v) => Object.keys(v).length <= 32, { message: "at_most_32_attributes" }),
});

const Output = z.object({
  title: Wrapped,
  description: Wrapped.optional(),
  attributes: z.record(z.string(), Wrapped),
  flagged: z.boolean(),
  suspicionScore: z.number().int().min(0).max(100),
  routing: z.enum(["auto_publish", "moderation_queue", "review_block"]),
});

function routingFor(flagged: boolean, score: number): "auto_publish" | "moderation_queue" | "review_block" {
  if (score >= 60) return "review_block";
  if (flagged) return "moderation_queue";
  return "auto_publish";
}

export function registerSellerTools(reg: McpRegistry): void {
  reg.register({
    name: "seller.preview_listing",
    description:
      "Run seller-supplied listing text through the untrusted-content envelope. Returns sanitised wrapped fields, suspicion score, and a routing decision (auto_publish / moderation_queue / review_block) so the seller can fix issues before submitting.",
    scope: "seller:product:write",
    auditEvent: "seller.preview_listing",
    idempotent: true,
    inputSchema: Input,
    outputSchema: Output,
    handler: async (input) => {
      const result = sanitizeCatalogInput({
        sellerOrgId: input.sellerOrgId,
        title: input.title,
        ...(input.description !== undefined ? { description: input.description } : {}),
        attributes: input.attributes,
      });
      return {
        title: result.title,
        ...(result.description !== undefined ? { description: result.description } : {}),
        attributes: result.attributes,
        flagged: result.flagged,
        suspicionScore: result.suspicionScore,
        routing: routingFor(result.flagged, result.suspicionScore),
      };
    },
    errorCatalog: [
      { code: "validation", httpStatus: 400, description: "Listing input failed schema validation." },
    ],
  });
}
