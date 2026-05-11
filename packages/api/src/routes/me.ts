// /v1/me/* — endpoints scoped to the currently signed-in user.
//
//   GET /v1/me/activity  — { user, agents[], recentActions[] }
//
// Session-required. The session bearer's `sub` is the userId.

import type { FastifyInstance } from "fastify";
import { requireUser } from "../middleware/auth.js";
import type { UserRepo } from "../repos/user.js";

export interface MeRouteDeps {
  users: UserRepo;
}

export async function registerMeRoutes(app: FastifyInstance, deps: MeRouteDeps): Promise<void> {
  app.get("/v1/me/activity", async (req, reply) => {
    // User activity feed — per-user data; never cacheable across users.
    reply.header("cache-control", "private, no-store");
    const sess = requireUser(req);
    const [user, agents, recentActions] = await Promise.all([
      deps.users.get(sess.userId),
      deps.users.listAgents(sess.userId),
      deps.users.recentActivity(sess.userId, 50),
    ]);
    return {
      user: user
        ? {
            id: user.id,
            email: user.email,
            displayName: user.displayName ?? null,
            picture: user.picture ?? null,
          }
        : null,
      agents,
      recentActions: recentActions.map((a: { occurredAt: number }) => ({
        ...a,
        occurredAt: new Date(a.occurredAt).toISOString(),
      })),
    };
  });
}
