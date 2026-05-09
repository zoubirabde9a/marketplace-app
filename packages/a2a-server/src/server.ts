// A2A skill server — agent↔agent dialogues per spec §5.3.
// Skills: negotiate_price (live), more to follow.

import { z, type ZodType } from "zod";
import { ConflictError } from "@marketplace/shared/errors";
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
    if (!skill) throw new ConflictError(`a2a_skill_not_found:${name}`);
    const parsed = skill.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ConflictError(`a2a_input_validation:${parsed.error.message}`);
    }
    const out = await skill.handler(parsed.data, ctx);
    return skill.outputSchema.parse(out);
  }
}

export { z };
