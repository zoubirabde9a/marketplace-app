// Edge auth: routes fall into three categories.
//
//   1. Public — no auth required (catalog browse, cart, checkout, login).
//   2. Session — `Authorization: Bearer mp_<jwt>`, populates `req.userPrincipal`.
//   3. Agent passport — DPoP-bound access token + signed passport (spec §3.2),
//      populates `req.principal`. Used for agent-to-agent flows.
//
// A request can carry a session bearer *and* a passport; we resolve both when
// present so a route can require whichever it needs.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { KeyObject } from "node:crypto";
import { UnauthorizedError } from "@marketplace/shared/errors";
import { identity } from "@marketplace/domain";
import { isSessionToken, verifySession } from "../auth/session.js";

export interface RequestPrincipal {
  agentId: string;
  passportId: string;
  scopes: ReadonlySet<string>;
  dpopJkt: string;
  mandateId?: string;
  ownerKind: "user" | "org";
  ownerId: string;
  spendCaps: identity.SpendCaps;
}

export interface UserPrincipal {
  userId: string;
  email: string;
}

declare module "fastify" {
  interface FastifyRequest {
    principal?: RequestPrincipal;
    userPrincipal?: UserPrincipal;
  }
}

export interface AuthDeps {
  resolveIssuerKey: (kid: string) => Promise<KeyObject | undefined>;
  resolveSessionKey: (kid: string) => Promise<KeyObject | undefined>;
  isPassportRevoked: (passportId: string) => Promise<boolean>;
  jtiSeen: (jti: string, expiresAtMs: number) => Promise<boolean>;
  audience: string;
  introspect?: (token: string) => Promise<{ active: boolean; jkt?: string; mandateId?: string } | null>;
  now: () => number;
  /**
   * Dev-mode bypass for the agent-passport path. When true, an absent passport
   * is replaced by a synthetic agent principal taken from headers. Never enable
   * in production. Has no effect on session bearer parsing.
   */
  devBypass?: boolean;
}

const PUBLIC_MATCHERS: ReadonlyArray<(method: string, path: string) => boolean> = [
  (m, p) => p.startsWith("/livez") || p.startsWith("/readyz") || p.startsWith("/.well-known/"),
  (m, p) => p.startsWith("/oauth/"),
  (m, p) => m === "GET" && /^\/v1\/products(\/[^/]+)?$/.test(p),
  (m, p) => m === "GET" && /^\/v1\/media\/[^/]+$/.test(p),
  (m, p) => m === "GET" && /^\/v1\/sellers(\/[^/]+)?$/.test(p),
  (m, p) => /^\/v1\/cart(\/.*)?$/.test(p),
  (m, p) => m === "POST" && /^\/v1\/checkout\/.+$/.test(p),
  (m, p) => m === "GET" && /^\/v1\/orders\/[^/]+$/.test(p),
  (m, p) => m === "POST" && p === "/v1/auth/google",
  (m, p) => m === "POST" && p === "/v1/auth/exchange-link",
];

const SESSION_ONLY_MATCHERS: ReadonlyArray<(method: string, path: string) => boolean> = [
  (m, p) => m === "GET" && p === "/v1/auth/me",
  (m, p) => m === "POST" && p === "/v1/auth/passports",
  (m, p) => m === "GET" && p === "/v1/orders",
  (m, p) => m === "GET" && p.startsWith("/v1/me/"),
];

// Routes that may be authorized by either an Agent Passport (the spec path) OR
// by a marketplace user session. The session path exists so the browser-based
// seller dashboard (which can't easily mint DPoP-bound passports from a
// browser) can manage its own seller profile and products. When auth happens
// via session, we synthesize a synthetic principal whose agentId is
// "user:<userId>" — so a seller created through the dashboard is owned by
// that synthetic agent and only that user can later edit it.
const SESSION_OR_PASSPORT_MATCHERS: ReadonlyArray<(method: string, path: string) => boolean> = [
  (m, p) => m === "POST" && p === "/v1/sellers",
  (m, p) => m === "PATCH" && /^\/v1\/sellers\/[^/]+$/.test(p),
  (m, p) => m === "POST" && p === "/v1/products",
  (m, p) => m === "PATCH" && /^\/v1\/products\/[^/]+$/.test(p),
  (m, p) => m === "POST" && /^\/v1\/products\/[^/]+\/media$/.test(p),
  (m, p) => m === "DELETE" && /^\/v1\/products\/[^/]+\/media\/[^/]+$/.test(p),
];

function pathOnly(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

function isPublic(method: string, path: string): boolean {
  return PUBLIC_MATCHERS.some((m) => m(method, path));
}

function isSessionOnly(method: string, path: string): boolean {
  return SESSION_ONLY_MATCHERS.some((m) => m(method, path));
}

function isSessionOrPassport(method: string, path: string): boolean {
  return SESSION_OR_PASSPORT_MATCHERS.some((m) => m(method, path));
}

function syntheticAgentIdForUser(userId: string): string {
  return `user:${userId}`;
}

export async function registerAuth(app: FastifyInstance, deps: AuthDeps): Promise<void> {
  app.addHook("onRequest", async (req) => {
    const path = pathOnly(req.url);
    const method = req.method.toUpperCase();
    const authHeader = typeof req.headers["authorization"] === "string" ? req.headers["authorization"] : "";

    // 1) Best-effort session resolution. If a Bearer mp_ token is present, decode it
    //    so any route can read req.userPrincipal — including public routes (e.g. cart
    //    can pick the user's cart instead of the anonymous one).
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice("Bearer ".length).trim();
      if (isSessionToken(token)) {
        try {
          const claims = await verifySession(token, {
            audience: deps.audience,
            now: deps.now(),
            resolveKey: deps.resolveSessionKey,
          });
          req.userPrincipal = { userId: claims.sub, email: claims.email };
        } catch (e) {
          throw new UnauthorizedError(`session_invalid:${(e as Error).message}`);
        }
      }
    }

    if (isPublic(method, path)) return;

    if (isSessionOnly(method, path)) {
      if (!req.userPrincipal) throw new UnauthorizedError("session_required");
      return;
    }

    // 2a) Session-or-passport routes: if a session is present, synthesize a
    //     principal bound to the user so downstream handlers (which only know
    //     about req.principal) just work.
    if (isSessionOrPassport(method, path) && req.userPrincipal) {
      const agentId = syntheticAgentIdForUser(req.userPrincipal.userId);
      req.principal = {
        agentId,
        passportId: `psp_session_${req.userPrincipal.userId}`,
        scopes: new Set(["seller:product:write", "seller:write"]),
        dpopJkt: "session",
        ownerKind: "user",
        ownerId: req.userPrincipal.userId,
        spendCaps: { currency: "USD" } as identity.SpendCaps,
      };
      return;
    }

    // 2b) Agent-passport path (everything else).
    if (deps.devBypass) {
      const agentId = (req.headers["x-mp-agent-id"] as string) || "agt_dev";
      const scopesHeader = (req.headers["x-mp-scopes"] as string) || "";
      const scopes = new Set(
        scopesHeader
          ? scopesHeader.split(",").map((s) => s.trim()).filter(Boolean)
          : ["catalog:read", "seller:product:write"],
      );
      req.principal = {
        agentId,
        passportId: `psp_${agentId}`,
        scopes,
        dpopJkt: "dev",
        ownerKind: "user",
        ownerId: agentId,
        spendCaps: { currency: "USD" } as identity.SpendCaps,
      };
      return;
    }

    if (!authHeader.startsWith("DPoP ")) {
      throw new UnauthorizedError("dpop_token_required");
    }
    const accessToken = authHeader.slice("DPoP ".length).trim();

    const dpopHeader = req.headers["dpop"];
    if (!dpopHeader || typeof dpopHeader !== "string") {
      throw new UnauthorizedError("dpop_proof_required");
    }

    const proto = (req.headers["x-forwarded-proto"] as string) || (req.protocol as string) || "https";
    const host = (req.headers["x-forwarded-host"] as string) || req.headers.host;
    const url = new URL(req.url, `${proto}://${host}`);
    url.search = "";
    url.hash = "";

    const dpopResult = await identity.verifyDpop(dpopHeader, {
      htm: method,
      htu: url.toString().replace(/\/+$/, ""),
      accessToken,
      jtiSeen: deps.jtiSeen,
      now: deps.now,
    });

    if (deps.introspect) {
      const intro = await deps.introspect(accessToken);
      if (!intro?.active) throw new UnauthorizedError("token_inactive");
      if (intro.jkt && intro.jkt !== dpopResult.jkt) throw new UnauthorizedError("token_jkt_mismatch");
    }

    const passportHeader = req.headers["x-mp-passport"];
    if (typeof passportHeader !== "string" || passportHeader.length === 0) {
      throw new UnauthorizedError("passport_required");
    }
    let claims: identity.PassportClaims;
    try {
      claims = await identity.verifyPassport(passportHeader, {
        audience: deps.audience,
        now: deps.now(),
        resolveIssuerKey: deps.resolveIssuerKey,
        isRevoked: deps.isPassportRevoked,
      });
    } catch (e) {
      throw new UnauthorizedError(`passport_invalid:${(e as Error).message}`);
    }

    const passportJkt = await identity.jwkThumbprint(claims.cnf.jwk as Record<string, unknown>);
    if (passportJkt !== dpopResult.jkt) {
      throw new UnauthorizedError("passport_dpop_binding");
    }

    const spendCaps: identity.SpendCaps = {
      currency: claims.spend_caps.currency,
      ...(claims.spend_caps.per_tx_minor !== undefined ? { perTxMinor: BigInt(claims.spend_caps.per_tx_minor) } : {}),
      ...(claims.spend_caps.per_day_minor !== undefined ? { perDayMinor: BigInt(claims.spend_caps.per_day_minor) } : {}),
      ...(claims.spend_caps.per_merchant_minor !== undefined
        ? { perMerchantMinor: BigInt(claims.spend_caps.per_merchant_minor) }
        : {}),
    };

    req.principal = {
      agentId: claims.sub,
      passportId: claims.jti,
      scopes: new Set(claims.scopes),
      dpopJkt: dpopResult.jkt,
      ownerKind: claims.owner.kind,
      ownerId: claims.owner.id,
      spendCaps,
    };
  });
}

export function requirePrincipal(req: FastifyRequest): RequestPrincipal {
  if (!req.principal) throw new UnauthorizedError("principal_required");
  return req.principal;
}

export function requireUser(req: FastifyRequest): UserPrincipal {
  if (!req.userPrincipal) throw new UnauthorizedError("session_required");
  return req.userPrincipal;
}
