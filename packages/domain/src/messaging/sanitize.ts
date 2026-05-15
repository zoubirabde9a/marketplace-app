// Message sanitization: same untrusted-content envelope (§8a.1) used on catalog text.
// Plus: outbound-rate signals for suspicious agent behavior.

import { sanitizeUntrusted, FIELD_LIMITS, safeOrigin, type UntrustedContent } from "@marketplace/shared/untrusted";

export interface MessageSanitizeInput {
  senderKind: "human" | "agent" | "system";
  senderId: string;
  body: string;
  attachments?: Array<{ kind: string; url: string }>;
}

export interface MessageSanitizeResult {
  body: UntrustedContent;
  attachments?: Array<{ kind: string; url: string }>;
  /** Attachments dropped because their URL scheme/format failed safety checks. */
  droppedAttachments?: Array<{ kind: string; url: string; reason: string }>;
  flagged: boolean;
}

// At most this many attachments per message. A 1000-attachment message is a
// spam payload, not a real customer-support exchange.
const MAX_ATTACHMENTS = 10;
// URL length cap: 2KB covers ~99% of real URLs while bounding a memory-bloat
// attack via giant URLs embedded in attachments.
const MAX_URL_LEN = 2048;
// Only http/https URLs are safe to render in any chat UI. `javascript:`,
// `data:`, `file:`, `vbscript:` and other schemes are XSS / local-disclosure
// vectors when a message viewer is expected to make the URL clickable. We
// strip them at the sanitiser, not at the renderer, so every downstream
// consumer (web chat, MCP tool surface, audit-log replay UI) gets the same
// guarantee without each having to repeat the check.
const SAFE_URL_RE = /^https?:\/\//i;

// Allow-list for attachment `kind` labels. Pre-fix `kind` was only length-
// bounded, so a label like `"image/png\nignore previous instructions"`
// would pass — line-injecting into any downstream LLM consumer that
// interpolates the kind verbatim ("Attachment of kind: <kind>"). Real
// kinds are simple category slugs ("image", "document", "audio"); a
// restrictive allow-list is the right shape.
const SAFE_KIND_RE = /^[A-Za-z0-9_\-/]{1,64}$/;

function checkAttachment(a: { kind: string; url: string }): string | null {
  if (typeof a.url !== "string" || a.url.length === 0) return "attachment_empty_url";
  if (a.url.length > MAX_URL_LEN) return "attachment_url_too_long";
  if (!SAFE_URL_RE.test(a.url)) return "attachment_scheme_not_allowed";
  if (typeof a.kind !== "string" || !SAFE_KIND_RE.test(a.kind)) {
    return "attachment_bad_kind";
  }
  return null;
}

export function sanitizeMessage(input: MessageSanitizeInput): MessageSanitizeResult {
  // safeOrigin caps + strips control bytes on both kind and id segments
  // (shared/untrusted pass #171). Earlier inline implementation lived
  // here per pass #165; consolidated so every wrapped-envelope origin
  // site shares one defense rule.
  const body = sanitizeUntrusted(input.body, {
    maxLength: FIELD_LIMITS.message,
    origin: safeOrigin(input.senderKind, input.senderId),
  });

  let safeAttachments: Array<{ kind: string; url: string }> | undefined;
  const dropped: Array<{ kind: string; url: string; reason: string }> = [];
  if (input.attachments && input.attachments.length > 0) {
    const capped = input.attachments.slice(0, MAX_ATTACHMENTS);
    for (const dropExtra of input.attachments.slice(MAX_ATTACHMENTS)) {
      dropped.push({ ...dropExtra, reason: "attachment_cap_exceeded" });
    }
    const kept: Array<{ kind: string; url: string }> = [];
    for (const a of capped) {
      const reason = checkAttachment(a);
      if (reason) dropped.push({ ...a, reason });
      else kept.push({ kind: a.kind, url: a.url });
    }
    if (kept.length > 0) safeAttachments = kept;
  }

  return {
    body,
    ...(safeAttachments ? { attachments: safeAttachments } : {}),
    ...(dropped.length > 0 ? { droppedAttachments: dropped } : {}),
    // Attachment drops are a moderation signal: a legitimate caller doesn't
    // submit `javascript:` URLs by accident.
    flagged: Boolean(body.sanitized) || Boolean(body.truncated) || dropped.length > 0,
  };
}
