// Server-only helpers for reading the seller session cookie. The cookie holds
// the raw `mp_<jwt>` issued by the API's POST /v1/auth/google endpoint. We
// pass it as `Authorization: Bearer <jwt>` when calling seller-write routes.

import { cookies } from "next/headers";
import { getMe, type MeResponse } from "@/lib/api";

// Unified session cookie for buyers + sellers + agent-link recipients. Holds
// the raw `mp_<jwt>` issued by either POST /v1/auth/google or
// POST /v1/auth/exchange-link.
export const SELLER_COOKIE = "mp_session";

export async function getSessionJwt(): Promise<string | null> {
  const jar = await cookies();
  const c = jar.get(SELLER_COOKIE);
  return c?.value ?? null;
}

export async function getCurrentUser(): Promise<{ jwt: string; user: MeResponse["user"] } | null> {
  const jwt = await getSessionJwt();
  if (!jwt) return null;
  try {
    const me = await getMe(jwt);
    return { jwt, user: me.user };
  } catch {
    return null;
  }
}

/** The synthetic agentId the API derives from a session-authenticated request. */
export function syntheticAgentId(userId: string): string {
  return `user:${userId}`;
}
