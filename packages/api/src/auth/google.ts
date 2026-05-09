// Verify Google ID tokens against Google's JWKS. ID-token flow only — we never
// see the user's password and don't need a Google client secret.

import { createRemoteJWKSet, jwtVerify } from "jose";

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const GOOGLE_JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function jwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!cachedJwks) cachedJwks = createRemoteJWKSet(GOOGLE_JWKS_URL);
  return cachedJwks;
}

export interface VerifyGoogleOptions {
  /** Your Google OAuth 2.0 Client ID — must equal the token's `aud` claim. */
  clientId: string;
  /**
   * Override for tests. When provided, skips network JWKS fetch and the
   * caller is expected to have already validated the token shape.
   */
  testStub?: (idToken: string) => Promise<GoogleProfile>;
}

export async function verifyGoogleIdToken(idToken: string, opts: VerifyGoogleOptions): Promise<GoogleProfile> {
  if (opts.testStub) return opts.testStub(idToken);
  const { payload } = await jwtVerify(idToken, jwks(), {
    issuer: [...GOOGLE_ISSUERS],
    audience: opts.clientId,
  });
  const sub = String(payload["sub"] ?? "");
  const email = String(payload["email"] ?? "");
  if (!sub || !email) throw new Error("google_id_token_missing_claims");
  return {
    sub,
    email,
    emailVerified: payload["email_verified"] === true,
    ...(typeof payload["name"] === "string" ? { name: payload["name"] } : {}),
    ...(typeof payload["picture"] === "string" ? { picture: payload["picture"] } : {}),
  };
}
