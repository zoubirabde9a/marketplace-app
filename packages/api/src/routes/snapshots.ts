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
      void reply
        .code(410)
        .header("content-type", "application/problem+json")
        .send({
          type: "https://marketplace.dev/errors/snapshot-expired",
          title: "Snapshot expired or not found",
          status: 410,
          detail: "Snapshots expire 24 hours after creation.",
          instance: req.url,
        });
      return;
    }
    void reply
      .header("cache-control", "private, max-age=300")
      .send({
        id: snap.id,
        kind: snap.kind,
        input: snap.input,
        output: snap.output,
        createdAt: snap.createdAt,
        expiresAt: snap.expiresAt,
      });
  });
}
