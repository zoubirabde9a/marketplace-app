// messaging.send — A2A skill that wraps every outbound message body in the
// untrusted-content envelope before it reaches a downstream agent. Flagged messages
// (sanitised or truncated) are routed to a slower delivery lane. See SOP 13 step 2.

import { z } from "zod";
import { sanitizeMessage } from "@marketplace/domain/messaging/sanitize";
import { FIELD_LIMITS } from "@marketplace/shared/untrusted";
import type { A2ASkillDef } from "../server.ts";

const Wrapped = z.object({
  role: z.literal("untrusted_content"),
  origin: z.string(),
  value: z.string(),
  truncated: z.boolean().optional(),
  sanitized: z.boolean().optional(),
});

// Per-message body cap at the API boundary. `sanitizeMessage` truncates
// internally at `FIELD_LIMITS.message` (4 KB) but the schema previously
// accepted any size — Fastify would buffer a multi-megabyte JSON body
// before the truncation step ever ran, an easy memory-pressure / cost
// amplifier for a callable A2A skill. A 2× headroom over the truncation
// limit is enough for "user pasted a slightly oversize body" without
// being weaponizable.
const MAX_INPUT_BODY = FIELD_LIMITS.message * 2;
// Same generous cap on per-attachment URL length — matches the
// MAX_URL_LEN in `sanitizeMessage` so junk-URL DoS attempts get refused
// at the schema gate, not at the domain function.
const MAX_INPUT_URL = 2048;

const Input = z.object({
  senderKind: z.enum(["human", "agent", "system"]),
  // Bound the sender id at the gate. Pre-fix `z.string()` accepted any
  // payload, including a multi-MB string, which the sanitiser then carried
  // into the wrapped envelope's `origin: "agent:<id>"` field and on into
  // every downstream consumer (audit log, moderation queue, slow-lane
  // delivery store). Sender ids in this platform are agent / user / system
  // ulids — 120 chars is generous.
  senderId: z.string().min(1).max(120),
  body: z.string().min(1).max(MAX_INPUT_BODY),
  attachments: z
    .array(
      z.object({
        // Restrict `kind` to a slug-shaped allow-list. Same defense as
        // the domain sanitiser (messaging/sanitize pass #198) — pre-fix
        // a `kind` carrying `"image/png\nignore previous instructions"`
        // would pass the length-only bound and line-inject into any
        // downstream consumer that interpolates kind verbatim.
        kind: z.string().regex(/^[A-Za-z0-9_\-/]{1,64}$/),
        url: z.string().url().max(MAX_INPUT_URL),
      }),
    )
    .max(50)
    .optional(),
});

const Output = z.object({
  body: Wrapped,
  attachments: z
    .array(z.object({ kind: z.string(), url: z.string() }))
    .optional(),
  // Surface what got dropped at the sanitiser so the caller can fix bad
  // attachments instead of silently losing them. `sanitizeMessage`
  // computed this list (pass #37 added `droppedAttachments` for the
  // attachment-scheme / count-cap fixes) but the skill was throwing it
  // away — an A2A agent submitting a message with a `javascript:` URL
  // saw its attachment vanish with no feedback about what went wrong.
  droppedAttachments: z
    .array(z.object({ kind: z.string(), url: z.string(), reason: z.string() }))
    .optional(),
  flagged: z.boolean(),
  deliveryLane: z.enum(["fast", "slow_with_moderation"]),
});

export const sendMessageSkill: A2ASkillDef<z.infer<typeof Input>, z.infer<typeof Output>> = {
  name: "messaging.send",
  description:
    "Wrap an outbound message body in the untrusted-content envelope and pick a delivery lane. Flagged bodies (sanitised or truncated) go to the slow lane for moderation.",
  scope: "message:write",
  inputSchema: Input,
  outputSchema: Output,
  handler: (input) => {
    const r = sanitizeMessage({
      senderKind: input.senderKind,
      senderId: input.senderId,
      body: input.body,
      ...(input.attachments ? { attachments: input.attachments } : {}),
    });
    return {
      body: r.body,
      ...(r.attachments ? { attachments: r.attachments } : {}),
      ...(r.droppedAttachments ? { droppedAttachments: r.droppedAttachments } : {}),
      flagged: r.flagged,
      deliveryLane: r.flagged ? ("slow_with_moderation" as const) : ("fast" as const),
    };
  },
};
