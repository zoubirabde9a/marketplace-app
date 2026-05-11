// End-user (human) authentication endpoints.
//   POST /v1/auth/google         — exchange a Google ID token for a marketplace session.
//   GET  /v1/auth/me             — current user (session required).
//   POST /v1/auth/passports      — mint an Agent Passport on behalf of the logged-in user.
//   POST /v1/auth/login-link     — passport-authenticated; mints a short-lived
//                                  URL the agent sends to its human, who clicks it
//                                  to obtain a real session without re-authenticating.
//   POST /v1/auth/exchange-link  — public; exchanges a link token from the URL
//                                  for a real session JWT.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { identity } from "@marketplace/domain";
import { newId } from "@marketplace/shared/ids";
import { UnauthorizedError } from "@marketplace/shared/errors";
import { requirePrincipal, requireUser } from "../middleware/auth.js";
import type { UserRepo, UserRecord } from "../repos/user.js";
import { verifyGoogleIdToken, type VerifyGoogleOptions } from "../auth/google.js";
import {
  signSession,
  signLinkToken,
  verifyLinkToken,
  defaultLinkTokenTtlSecs,
  type SessionIssuerKey,
} from "../auth/session.js";

const GoogleLoginSchema = z.object({
  idToken: z.string().min(1).max(8192),
});

const IssuePassportSchema = z.object({
  agentId: z.string().min(1).max(120),
  scopes: z.array(z.string()).min(1).max(20),
  spendCaps: z
    .object({
      currency: z.string().regex(/^[A-Z]{3}$/),
      perTxMinor: z.string().optional(),
      perDayMinor: z.string().optional(),
      perMerchantMinor: z.string().optional(),
    })
    .optional(),
  ttlSeconds: z.number().int().min(60).max(60 * 60 * 24 * 30).default(60 * 60 * 24),
  cnfJwk: z.record(z.string(), z.unknown()),
});

export interface AuthRouteDeps {
  users: UserRepo;
  googleClientId: string;
  googleVerifyStub?: VerifyGoogleOptions["testStub"];
  sessionIssuer: SessionIssuerKey;
  /** Public side of `sessionIssuer` (and any retired kids). Used by exchange-link. */
  resolveSessionKey: (kid: string) => Promise<import("node:crypto").KeyObject | undefined>;
  passportIssuer: identity.IssuerKey;
  audience: string;
  /** Session TTL in seconds. */
  sessionTtl?: number;
  /** Login-link TTL in seconds. Defaults to 10 minutes. */
  linkTokenTtl?: number;
  /** Web origin used in the URL returned by /v1/auth/login-link. */
  webOrigin: string;
  now: () => number;
}

export async function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): Promise<void> {
  app.post("/v1/auth/google", async (req, reply) => {
    const body = GoogleLoginSchema.parse(req.body);
    let profile;
    try {
      profile = await verifyGoogleIdToken(body.idToken, {
        clientId: deps.googleClientId,
        ...(deps.googleVerifyStub ? { testStub: deps.googleVerifyStub } : {}),
      });
    } catch (e) {
      throw new UnauthorizedError(`google_verify:${(e as Error).message}`);
    }
    if (!profile.emailVerified) {
      throw new UnauthorizedError("google_email_unverified");
    }
    const user = await deps.users.upsertByGoogleSub({
      googleSub: profile.sub,
      email: profile.email,
      emailVerified: profile.emailVerified,
      ...(profile.name !== undefined ? { displayName: profile.name } : {}),
      ...(profile.picture !== undefined ? { picture: profile.picture } : {}),
    });
    const ttl = deps.sessionTtl ?? 60 * 60 * 24;
    const nowSec = Math.floor(deps.now() / 1000);
    const sessionJwt = signSession(
      {
        iss: "marketplace",
        sub: user.id,
        email: user.email,
        aud: deps.audience,
        iat: nowSec,
        exp: nowSec + ttl,
      },
      deps.sessionIssuer,
    );
    void reply.code(200);
    return {
      sessionJwt,
      expiresIn: ttl,
      user: shapeUser(user),
    };
  });

  app.get("/v1/auth/me", async (req, reply) => {
    // Identity endpoint — user-specific by definition. Must never be
    // cached by any intermediary; user A's identity reaching user B
    // would be a full session-takeover-level leak.
    reply.header("cache-control", "private, no-store");
    const sess = requireUser(req);
    const user = await deps.users.get(sess.userId);
    if (!user) throw new UnauthorizedError("user_not_found");
    return { user: shapeUser(user) };
  });

  // POST /v1/auth/login-link
  //   Passport-authenticated. The acting agent mints a short-lived URL it can
  //   pass to its human ("here, click this to see what I've been doing on
  //   your behalf"). The bound user is taken from the passport's owner field —
  //   the agent cannot mint a link for a user it isn't acting on behalf of.
  app.post("/v1/auth/login-link", async (req, reply) => {
    const principal = requirePrincipal(req);
    if (principal.ownerKind !== "user") {
      throw new UnauthorizedError("link_only_user_owned_passports");
    }
    const ttl = deps.linkTokenTtl ?? defaultLinkTokenTtlSecs();
    const nowSec = Math.floor(deps.now() / 1000);
    const linkToken = signLinkToken(
      {
        iss: "marketplace",
        sub: principal.ownerId,
        agent_id: principal.agentId,
        passport_id: principal.passportId,
        aud: deps.audience,
        iat: nowSec,
        exp: nowSec + ttl,
      },
      deps.sessionIssuer,
    );
    const url = new URL("/login", deps.webOrigin);
    url.searchParams.set("code", linkToken);
    void reply.code(201);
    return {
      url: url.toString(),
      code: linkToken,
      expiresAt: new Date((nowSec + ttl) * 1000).toISOString(),
      expiresIn: ttl,
    };
  });

  // POST /v1/auth/exchange-link
  //   Public. Exchanges a link token (minted by /login-link) for a real
  //   marketplace session JWT bound to the user the agent was acting on
  //   behalf of. Idempotent at the JWT level — the same token can be
  //   exchanged multiple times before its 10-min TTL expires; we rely on the
  //   short window for replay safety.
  const ExchangeLinkSchema = z.object({ code: z.string().min(1).max(4096) });
  app.post("/v1/auth/exchange-link", async (req, reply) => {
    const body = ExchangeLinkSchema.parse(req.body);
    let claims;
    try {
      claims = await verifyLinkToken(body.code, {
        audience: deps.audience,
        now: deps.now(),
        resolveKey: deps.resolveSessionKey,
      });
    } catch (e) {
      throw new UnauthorizedError(`link_invalid:${(e as Error).message}`);
    }
    const user = await deps.users.get(claims.sub);
    if (!user) throw new UnauthorizedError("link_user_not_found");

    const sessionTtl = deps.sessionTtl ?? 60 * 60 * 24;
    const nowSec = Math.floor(deps.now() / 1000);
    const sessionJwt = signSession(
      {
        iss: "marketplace",
        sub: user.id,
        email: user.email,
        aud: deps.audience,
        iat: nowSec,
        exp: nowSec + sessionTtl,
      },
      deps.sessionIssuer,
    );
    void reply.code(200);
    return {
      sessionJwt,
      expiresIn: sessionTtl,
      user: shapeUser(user),
      via: "agent-link",
      agentId: claims.agent_id,
    };
  });

  app.post("/v1/auth/passports", async (req, reply) => {
    const sess = requireUser(req);
    const body = IssuePassportSchema.parse(req.body);
    const nowSec = Math.floor(deps.now() / 1000);
    const claims: identity.PassportClaims = {
      iss: "marketplace",
      sub: body.agentId,
      aud: deps.audience,
      jti: newId("psp"),
      iat: nowSec,
      exp: nowSec + body.ttlSeconds,
      cnf: { jwk: body.cnfJwk },
      scopes: body.scopes,
      spend_caps: body.spendCaps ?? { currency: "USD" },
      owner: { kind: "user", id: sess.userId },
    };
    const signed = identity.signPassport(claims, deps.passportIssuer);
    void reply.code(201);
    return {
      passportJwt: signed.jwt,
      passportId: signed.passportId,
      expiresAt: new Date(signed.expiresAt * 1000).toISOString(),
    };
  });
}

function shapeUser(u: UserRecord): Record<string, unknown> {
  return {
    id: u.id,
    email: u.email,
    emailVerified: u.emailVerified,
    displayName: u.displayName ?? null,
    picture: u.picture ?? null,
    status: u.status,
    createdAt: new Date(u.createdAt).toISOString(),
  };
}
