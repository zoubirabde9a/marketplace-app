// REST surface for /v1/snapshots — spec §8.4.
//
// Returns a frozen copy of an MCP catalog tool result so a human can see
// exactly what the agent saw at the time of the request. Snapshots are
// stored under an unguessable token, are publicly readable by anyone with
// the link, and expire after 24 hours.

import type { FastifyInstance } from "fastify";
import { NotFoundError } from "@marketplace/shared/errors";
import type { catalog } from "@marketplace/domain";

export interface SnapshotsRouteDeps {
  store: catalog.SnapshotStore;
}

export async function registerSnapshotRoutes(
  app: FastifyInstance,
  deps: SnapshotsRouteDeps,
): Promise<void> {
  app.get<{ Params: { id: string } }>("/v1/snapshots/:id", async (req, reply) => {
    const { id } = req.params;
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      throw new NotFoundError("snapshot", id);
    }
    const snap = await deps.store.get(id);
    if (!snap) {
      // `return reply.send(...)` so Fastify treats the response as fully
      // owned by the handler — bare `.send()` without return triggered
      // FST_ERR_REP_ALREADY_SENT 500s on the success path; same risk here.
      return reply
        .code(410)
        .header("content-type", "application/problem+json")
        .send({
          type: "https://marketplace.dev/errors/snapshot-expired",
          title: "Snapshot expired or not found",
          status: 410,
          detail: "Snapshots expire 24 hours after creation.",
          instance: req.url,
        });
    }
    // Snapshots are immutable + token-addressed (the unguessable id IS
    // the credential — see auth.ts PUBLIC_MATCHERS comment). After
    // creation the content never changes; the entry expires after 24h
    // via Redis TTL. Cache aggressively at the edge so audit-trail
    // recipients (agents sharing a snapshot URL as proof of what they
    // saw) don't all hit origin. Was 'private, max-age=300' which
    // blocked CDN caching entirely — every viewer re-fetched.
    // Set cache header and return the body so Fastify auto-sends — using
    // .send() inside the handler without `return reply` caused
    // FST_ERR_REP_ALREADY_SENT 500s under HEAD requests (live probe found
    // HEAD /v1/snapshots/{id} → 500 in production logs).
    reply.header("cache-control", "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400, immutable");
    return {
      id: snap.id,
      kind: snap.kind,
      input: snap.input,
      output: snap.output,
      createdAt: snap.createdAt,
      expiresAt: snap.expiresAt,
    };
  });
}
