// messaging.send — A2A skill that wraps every outbound message body in the
// untrusted-content envelope before it reaches a downstream agent. Flagged messages
// (sanitised or truncated) are routed to a slower delivery lane. See SOP 13 step 2.

import { z } from "zod";
import { sanitizeMessage } from "@marketplace/domain/messaging/sanitize";
import type { A2ASkillDef } from "../server.ts";

const Wrapped = z.object({
  role: z.literal("untrusted_content"),
  origin: z.string(),
  value: z.string(),
  truncated: z.boolean().optional(),
  sanitized: z.boolean().optional(),
});

const Input = z.object({
  senderKind: z.enum(["human", "agent", "system"]),
  senderId: z.string(),
  body: z.string().min(1),
  attachments: z
    .array(z.object({ kind: z.string(), url: z.string().url() }))
    .optional(),
});

const Output = z.object({
  body: Wrapped,
  attachments: z
    .array(z.object({ kind: z.string(), url: z.string() }))
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
      flagged: r.flagged,
      deliveryLane: r.flagged ? ("slow_with_moderation" as const) : ("fast" as const),
    };
  },
};
