// User aggregate — Google-OAuth-identified end users.

import type { StoredUser } from "../types/store-types.js";

export type UserRecord = StoredUser;

export interface UserAgentSummary {
  id: string;
  name: string;
  kind: "buyer" | "seller" | "both";
  status: string;
  createdAt: number;
}

export interface AgentActionSummary {
  id: string;
  agentId: string;
  agentName: string;
  toolName: string;
  scope: string;
  status: string;
  latencyMs: number;
  occurredAt: number;
  errorCode: string | null;
}

export interface UserRepo {
  upsertByGoogleSub(input: {
    googleSub: string;
    email: string;
    emailVerified: boolean;
    displayName?: string;
    picture?: string;
  }): Promise<UserRecord>;

  get(userId: string): Promise<UserRecord | undefined>;

  /** Agents whose owner is this user. Used by /v1/me/activity. */
  listAgents(userId: string): Promise<UserAgentSummary[]>;

  /** Recent audit.agent_action rows joined to identity.agents.name. */
  recentActivity(userId: string, limit?: number): Promise<AgentActionSummary[]>;

  /** Append one audit.agent_action row. Idempotent only at the (id) level. */
  recordAgentAction(input: {
    agentId: string;
    passportId: string;
    toolName: string;
    scope: string;
    status: "ok" | "denied" | "error";
    latencyMs: number;
    occurredAt: number;
    errorCode?: string | null;
  }): Promise<void>;
}
