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
  // /livez is the canonical name (matches the auth middleware's public list);
  // /healthz is the Kubernetes/Google convention and is what external uptime
  // services often default to. Aliasing prevents the surprise where an
  // operator points their probe at /healthz, gets 401, and concludes the API
  // is down — the auth middleware catches unknown paths and returns 401.
  const liveness = async () => ({ status: "ok" as const });
  app.get("/livez", liveness);
  app.get("/healthz", liveness);

  // Readiness: process is up AND its dependencies are reachable. Used by an
  // orchestrator that wants to drain traffic when a dep is down. Previously
  // a TODO that returned "ready" unconditionally — meaning the iter-22 Redis
  // OOM cycle never tripped readyz, and any LB pointing at this endpoint
  // would happily route traffic into a half-broken instance.
  app.get("/readyz", async (req, reply) => {
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
          // Don't leak the raw probe error to the public /readyz response —
          // a probe failure typically returns a message like
          // `"connection to server at \"db\" (172.18.0.3), port 5432 failed:
          // Connection refused"` or `"ECONNREFUSED 172.18.0.4:6379"` which
          // discloses internal IPs / ports / service names useful to an
          // attacker mapping the deployment. /readyz is public (no auth
          // gate per PUBLIC_MATCHERS in middleware/auth.ts), so any caller
          // can probe and read this. Keep the detail in server logs so
          // operators investigating an outage still see it.
          req.log.warn({ probe: name, err: (e as Error).message }, "readiness_probe_failed");
          return [name, { ok: false, latencyMs: Date.now() - t0, msg: "probe_failed" }] as const;
        }
      }),
    );
    const checks = Object.fromEntries(results);
    const allOk = results.every(([, r]) => r.ok);
    if (!allOk) {
      // Sanitise probe-returned msg the same way as caught-exception msgs.
      // A probe that returns `ok: false` directly (e.g. a custom probe that
      // surfaces "redis.ping returned ECONNREFUSED 10.0.0.5:6379") would
      // otherwise bypass the catch sanitisation above.
      for (const k of Object.keys(checks)) {
        const c = checks[k];
        if (c && !c.ok && typeof c.msg === "string") {
          req.log.warn({ probe: k, msg: c.msg }, "readiness_probe_not_ok");
          c.msg = "probe_failed";
        }
      }
      void reply.code(503);
      return { status: "not_ready", checks };
    }
    return { status: "ready", checks };
  });
}
