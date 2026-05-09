// Message sanitization: same untrusted-content envelope (§8a.1) used on catalog text.
// Plus: outbound-rate signals for suspicious agent behavior.

import { sanitizeUntrusted, FIELD_LIMITS, type UntrustedContent } from "@marketplace/shared/untrusted";

export interface MessageSanitizeInput {
  senderKind: "human" | "agent" | "system";
  senderId: string;
  body: string;
  attachments?: Array<{ kind: string; url: string }>;
}

export interface MessageSanitizeResult {
  body: UntrustedContent;
  attachments?: Array<{ kind: string; url: string }>;
  flagged: boolean;
}

export function sanitizeMessage(input: MessageSanitizeInput): MessageSanitizeResult {
  const body = sanitizeUntrusted(input.body, {
    maxLength: FIELD_LIMITS.message,
    origin: `${input.senderKind}:${input.senderId}`,
  });
  return {
    body,
    ...(input.attachments ? { attachments: input.attachments } : {}),
    flagged: Boolean(body.sanitized) || Boolean(body.truncated),
  };
}
