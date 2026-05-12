import type { FastifyInstance } from "fastify";

export type HealthCheck = () => Promise<{ ok: boolean; latencyMs?: number; msg?: string }>;
export interface HealthOptions {
  /** Optional dep probes. Failures or timeouts make /readyz return 503. */
  probes?: Record<string, HealthCheck>;
  /** Per-probe timeout. Default 1500ms. */
  probeTimeoutMs?: number;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let to: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) => {
        to = setTimeout(() => rej(new Error(`${label}_timeout_after_${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (to) clearTimeout(to);
  }
}

export async function registerHealth(app: FastifyInstance, opts: HealthOptions = {}): Promise<void> {
  // Liveness: process is up and responsive. Cheap, no dep checks — used by
  // Caddy's healthcheck so that a transient db/redis blip doesn't trigger
  // container churn during recovery.
  app.get("/livez", async () => ({ status: "ok" }));

  // Readiness: process is up AND its dependencies are reachable. Used by an
  // orchestrator that wants to drain traffic when a dep is down. Previously
  // a TODO that returned "ready" unconditionally — meaning the iter-22 Redis
  // OOM cycle never tripped readyz, and any LB pointing at this endpoint
  // would happily route traffic into a half-broken instance.
  app.get("/readyz", async (_req, reply) => {
    const probes = opts.probes ?? {};
    const timeoutMs = opts.probeTimeoutMs ?? 1500;
    const names = Object.keys(probes);
    if (names.length === 0) {
      return { status: "ready", checks: {} };
    }
    const results = await Promise.all(
      names.map(async (name) => {
        const t0 = Date.now();
        try {
          const r = await withTimeout(probes[name]!(), timeoutMs, name);
          return [name, { ...r, latencyMs: r.latencyMs ?? Date.now() - t0 }] as const;
        } catch (e) {
          return [name, { ok: false, latencyMs: Date.now() - t0, msg: (e as Error).message }] as const;
        }
      }),
    );
    const checks = Object.fromEntries(results);
    const allOk = results.every(([, r]) => r.ok);
    if (!allOk) {
      void reply.code(503);
      return { status: "not_ready", checks };
    }
    return { status: "ready", checks };
  });
}
