// A2A skill server — agent↔agent dialogues per spec §5.3.
// Skills: negotiate_price (live), more to follow.

import { z, type ZodType } from "zod";
import {
  ConflictError,
  MarketplaceError,
  NotFoundError,
  ValidationError,
} from "@marketplace/shared/errors";
import { createLogger } from "@marketplace/shared/logger";

const log = createLogger("a2a-server");

export interface A2AContext {
  fromAgentId: string;
  toAgentId: string;
  dialogueId: string;
  mandateId?: string;
  now: () => number;
}

export interface A2ASkillDef<I, O> {
  name: string;
  description: string;
  scope: string;
  inputSchema: ZodType<I>;
  outputSchema: ZodType<O>;
  handler: (input: I, ctx: A2AContext) => Promise<O> | O;
}

export class A2ARegistry {
  private readonly skills = new Map<string, A2ASkillDef<unknown, unknown>>();

  register<I, O>(def: A2ASkillDef<I, O>): void {
    if (this.skills.has(def.name)) {
      throw new ConflictError(`a2a_skill_already_registered:${def.name}`);
    }
    this.skills.set(def.name, def as unknown as A2ASkillDef<unknown, unknown>);
    log.info({ skill: def.name, scope: def.scope }, "a2a_skill_registered");
  }

  list(): Array<{ name: string; description: string; scope: string }> {
    return [...this.skills.values()].map((s) => ({
      name: s.name,
      description: s.description,
      scope: s.scope,
    }));
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  async invoke(name: string, rawInput: unknown, ctx: A2AContext): Promise<unknown> {
    const skill = this.skills.get(name);
    // 404 NotFound, not 409 Conflict. The previous error class mapped to
    // HTTP 409 — clients seeing a 409 for an unknown skill name were
    // confused into thinking the skill exists but is in a conflicting
    // state. Same error-class normalization pattern as the MCP transport
    // (pass #8).
    if (!skill) throw new NotFoundError("a2a_skill", name);
    const parsed = skill.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      // Bad input is a 400 ValidationError, not 409. Map the Zod issues
      // into the standard problem-detail shape so the wire-level response
      // looks the same as REST validation errors elsewhere.
      throw new ValidationError(
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }
    const out = await skill.handler(parsed.data, ctx);
    const outParsed = skill.outputSchema.safeParse(out);
    if (!outParsed.success) {
      // A skill handler that returns a wrong-shape output is an INTERNAL
      // bug, not a client problem — surface as a 500 MarketplaceError so
      // monitoring distinguishes "client sent garbage" (ValidationError)
      // from "we returned garbage" (this).
      throw new MarketplaceError({
        type: "https://marketplace.dev/errors/a2a-bad-output",
        title: "a2a_skill_output_invalid",
        status: 500,
        detail: name,
        extensions: { issues: outParsed.error.issues },
      });
    }
    return outParsed.data;
  }
}

export { z };
