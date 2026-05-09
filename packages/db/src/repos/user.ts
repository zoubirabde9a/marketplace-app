import { and, desc, eq } from "drizzle-orm";
import { uuidv7 } from "@marketplace/shared/ids";
import { users, agents } from "../schema/identity.js";
import { agentActions } from "../schema/audit.js";
import type { DbClient } from "../client.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StoredUser {
  id: string;
  googleSub: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
  picture?: string;
  status: "active" | "suspended" | "deleted";
  createdAt: number;
  updatedAt: number;
}

function shape(row: typeof users.$inferSelect): StoredUser {
  return {
    id: row.id,
    googleSub: row.googleSub ?? "",
    email: row.email,
    emailVerified: row.emailVerified,
    ...(row.displayName ? { displayName: row.displayName } : {}),
    ...(row.picture ? { picture: row.picture } : {}),
    status: row.status as StoredUser["status"],
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export function makeUserRepo(db: DbClient) {
  return {
    async upsertByGoogleSub(input: {
      googleSub: string;
      email: string;
      emailVerified: boolean;
      displayName?: string;
      picture?: string;
    }): Promise<StoredUser> {
      const existing = await db.select().from(users).where(eq(users.googleSub, input.googleSub)).limit(1);
      if (existing[0]) {
        const [row] = await db
          .update(users)
          .set({
            email: input.email,
            emailVerified: input.emailVerified,
            displayName: input.displayName ?? existing[0].displayName ?? null,
            picture: input.picture ?? existing[0].picture ?? null,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existing[0].id))
          .returning();
        return shape(row!);
      }
      const id = uuidv7();
      const [row] = await db
        .insert(users)
        .values({
          id,
          email: input.email,
          emailVerified: input.emailVerified,
          displayName: input.displayName ?? null,
          picture: input.picture ?? null,
          googleSub: input.googleSub,
        })
        .returning();
      return shape(row!);
    },

    async get(userId: string): Promise<StoredUser | undefined> {
      if (!UUID_RE.test(userId)) return undefined;
      const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      return rows[0] ? shape(rows[0]) : undefined;
    },

    /**
     * Agents whose `owner_user_id` is this user. Used by the web observer to
     * show the user "your agents" section. Excludes deleted agents.
     */
    async listAgents(userId: string): Promise<Array<{
      id: string;
      name: string;
      kind: "buyer" | "seller" | "both";
      status: string;
      createdAt: number;
    }>> {
      if (!UUID_RE.test(userId)) return [];
      const rows = await db
        .select({
          id: agents.id,
          name: agents.name,
          kind: agents.agentKind,
          status: agents.status,
          createdAt: agents.createdAt,
        })
        .from(agents)
        .where(and(eq(agents.ownerUserId, userId)))
        .orderBy(desc(agents.createdAt))
        .limit(50);
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind as "buyer" | "seller" | "both",
        status: r.status,
        createdAt: r.createdAt.getTime(),
      }));
    },

    /**
     * Recent agent_action rows for any agent whose `owner_user_id` is this user.
     * Joined with agents.name so the feed can display human-friendly labels.
     */
    /**
     * Insert one audit.agent_actions row. Called by the API audit middleware
     * after a passport-authenticated request finishes. Best-effort: callers
     * should wrap in try/catch — a missing agent or passport row (FK
     * violation) shouldn't fail the actual response.
     */
    async recordAgentAction(input: {
      agentId: string;
      passportId: string;
      toolName: string;
      scope: string;
      status: "ok" | "denied" | "error";
      latencyMs: number;
      occurredAt: number;
      errorCode?: string | null;
    }): Promise<void> {
      if (!UUID_RE.test(input.agentId)) return; // synthetic principals → skip
      const id = uuidv7();
      await db.insert(agentActions).values({
        id,
        agentId: input.agentId,
        passportId: UUID_RE.test(input.passportId) ? input.passportId : null,
        toolName: input.toolName.slice(0, 96),
        scope: input.scope.slice(0, 64),
        status: input.status,
        latencyMs: Math.max(0, Math.floor(input.latencyMs)),
        occurredAt: new Date(input.occurredAt),
        errorCode: input.errorCode ? input.errorCode.slice(0, 64) : null,
      });
    },

    async recentActivity(userId: string, limit = 50): Promise<Array<{
      id: string;
      agentId: string;
      agentName: string;
      toolName: string;
      scope: string;
      status: "ok" | "denied" | "error" | string;
      latencyMs: number;
      occurredAt: number;
      errorCode: string | null;
    }>> {
      if (!UUID_RE.test(userId)) return [];
      const cap = Math.min(Math.max(1, limit), 200);
      const rows = await db
        .select({
          id: agentActions.id,
          agentId: agentActions.agentId,
          agentName: agents.name,
          toolName: agentActions.toolName,
          scope: agentActions.scope,
          status: agentActions.status,
          latencyMs: agentActions.latencyMs,
          occurredAt: agentActions.occurredAt,
          errorCode: agentActions.errorCode,
        })
        .from(agentActions)
        .innerJoin(agents, eq(agents.id, agentActions.agentId))
        .where(eq(agents.ownerUserId, userId))
        .orderBy(desc(agentActions.occurredAt))
        .limit(cap);
      return rows.map((r) => ({
        id: r.id,
        agentId: r.agentId,
        agentName: r.agentName,
        toolName: r.toolName,
        scope: r.scope,
        status: r.status,
        latencyMs: r.latencyMs,
        occurredAt: r.occurredAt.getTime(),
        errorCode: r.errorCode ?? null,
      }));
    },
  };
}
