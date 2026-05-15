// Audit middleware: record every passport-authenticated request as a row in
// audit.agent_actions. Powers the home-page activity feed.
//
// Why a separate hook instead of folding into registerAuth:
//   - Auth runs onRequest. We need onResponse to know status + latency.
//   - Keeping audit isolated lets us turn it off cleanly per-deployment if it
//     ever becomes a hot-path concern.
//
// What is NOT recorded:
//   - Session-only humans (seller dashboard, /v1/me/*). Their principal has
//     a synthetic agentId of "user:<uuid>" which fails the UUID test.
//   - Truly anonymous catalog browsing (no principal set).
//   - Health and well-known endpoints (filtered explicitly).

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { UserRepo } from "../repos/user.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Wall-clock millis when the request entered the audit hook. */
    auditStartMs?: number;
  }
}

export interface AuditDeps {
  users: UserRepo;
  /** Override for tests. Defaults to console.error. */
  onAuditError?: (err: unknown, ctx: { url: string; method: string }) => void;
}

// Paths that get filtered out of agent-action auditing. Health, well-known
// discovery, and auth bootstrap endpoints are deliberately excluded — they
// happen on EVERY agent connect and would flood the audit table with
// uninteresting rows. Adding crawler-probe paths (`/favicon.ico`,
// `/robots.txt`, `/healthz`) and the OAuth / DCR stubs (`/register`,
// `/oauth/*`) avoids noise from probes that don't carry an authenticated
// principal anyway — when one of them DOES carry a principal (e.g. an
// agent client hitting `/.well-known` with their passport attached), we
// still don't want a per-connect audit row.
const SKIP_PATH_PREFIXES = [
  "/livez",
  "/readyz",
  "/healthz",
  "/.well-known/",
  "/v1/auth/",
  "/favicon.ico",
  "/robots.txt",
  "/register",
  "/oauth/",
];

function pathOnly(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

function deriveScope(path: string): string {
  // /v1/products/abc → "catalog"; /v1/cart/foo → "cart"; etc.
  const m = /^\/v1\/([^/]+)/.exec(path);
  if (!m) return "system";
  const seg = m[1] ?? "system";
  switch (seg) {
    case "products":
    case "search":
      return "catalog";
    case "sellers":
      return "sellers";
    case "cart":
    case "checkout":
      return "commerce";
    case "orders":
      return "orders";
    case "media":
      return "media";
    default:
      return seg;
  }
}

function deriveStatus(httpStatus: number): "ok" | "denied" | "error" {
  if (httpStatus >= 200 && httpStatus < 400) return "ok";
  if (httpStatus === 401 || httpStatus === 403) return "denied";
  return "error";
}

function deriveErrorCode(httpStatus: number): string | null {
  if (httpStatus >= 200 && httpStatus < 400) return null;
  return `http_${httpStatus}`;
}

export async function registerAudit(app: FastifyInstance, deps: AuditDeps): Promise<void> {
  app.addHook("onRequest", async (req: FastifyRequest) => {
    req.auditStartMs = Date.now();
  });

  app.addHook("onResponse", async (req: FastifyRequest, reply: FastifyReply) => {
    const principal = req.principal;
    if (!principal) return; // anonymous — nothing to record

    // Synthetic user principals (browser session auth) carry agentId
    // "user:<uuid>". They have no agent/passport row in the DB, so the
    // record would fail FK checks and get swallowed — short-circuit to
    // avoid the futile roundtrip and the error-log noise.
    if (principal.agentId.startsWith("user:")) return;

    const path = pathOnly(req.url);
    if (SKIP_PATH_PREFIXES.some((p) => path.startsWith(p))) return;

    const startedAt = req.auditStartMs ?? Date.now();
    const latency = Date.now() - startedAt;
    const httpStatus = reply.statusCode;

    const toolName = `${req.method.toUpperCase()} ${path}`.slice(0, 96);
    const scope = deriveScope(path);
    const status = deriveStatus(httpStatus);
    const errorCode = deriveErrorCode(httpStatus);

    // Fire-and-forget — never block the response on audit. FK violations
    // (unknown agent_id / passport_id) are swallowed; they just mean the
    // agent/passport rows aren't yet provisioned for this principal.
    void deps.users
      .recordAgentAction({
        agentId: principal.agentId,
        passportId: principal.passportId,
        toolName,
        scope,
        status,
        latencyMs: latency,
        occurredAt: Date.now(),
        ...(errorCode ? { errorCode } : {}),
      })
      .catch((err) => {
        const onErr =
          deps.onAuditError ??
          ((e, ctx) => {
            // eslint-disable-next-line no-console
            console.error("audit_record_failed", ctx, (e as Error)?.message);
          });
        onErr(err, { url: req.url, method: req.method });
      });
  });
}
