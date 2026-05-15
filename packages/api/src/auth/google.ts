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
    // 5-second clock tolerance for the `iat`/`exp` checks. jose's default is
    // 0, which means an ID token whose `iat` is even a millisecond ahead of
    // our wall clock (normal NTP drift between Google's issuer and our box)
    // fails with "iat must not be in the future" — observed intermittently
    // as transient login failures. 5s is the conventional tolerance for
    // cross-host clock drift and well below the 1-hour token lifetime.
    clockTolerance: 5,
  });
  // Type-strict claim extraction. Pre-fix `String(payload["sub"] ?? "")`
  // coerced any value into a string — a non-string `sub` (e.g. `{a:1}`)
  // became `"[object Object]"` and passed the `!sub` check, then landed
  // in `users.googleSub` as malformed data. jose's `jwtVerify` doesn't
  // assert that `sub` / `email` are strings (they're "any" in the
  // payload type), so this is the right boundary to enforce.
  const subClaim = payload["sub"];
  const emailClaim = payload["email"];
  if (typeof subClaim !== "string" || subClaim.length === 0
    || typeof emailClaim !== "string" || emailClaim.length === 0) {
    throw new Error("google_id_token_missing_claims");
  }
  // Cap both at sensible upper bounds. Google `sub` is a 21-digit numeric
  // id (255 chars in spec but ~21 in practice); email is bounded by RFC
  // 5321 at 254 chars. Same caps as the seller supportEmail field
  // (sellers.ts pass #161). A future IdP federation surface returning an
  // oversize value would bloat the user row + every /v1/auth/me payload.
  if (subClaim.length > 255 || emailClaim.length > 254) {
    throw new Error("google_id_token_claim_too_long");
  }
  const sub = subClaim;
  const email = emailClaim;
  // Defense-in-depth: also enforce email_verified inside this function. The
  // /v1/auth/google route already checks `profile.emailVerified` (auth.ts),
  // but a future caller of verifyGoogleIdToken that forgets the post-check
  // would silently accept tokens for unverified Google addresses — and an
  // attacker can create a Google account with someone else's email without
  // proving they own it. Treating an unverified token the same as a bad
  // signature here removes the foot-gun from every future call site.
  if (payload["email_verified"] !== true) {
    throw new Error("google_email_unverified");
  }
  // Bound and scheme-allow-list claim values from the ID token. In normal
  // operation Google's signed tokens carry sane values, but a future bug or
  // partner-IdP federation could surface a `picture` URL with a
  // `javascript:` scheme that the seller dashboard renders into an
  // `<img src>` — same defense as catalog/media URLs (passes #88/#102).
  // Name is capped so an absurdly long display name can't bloat the user
  // row + every subsequent /v1/auth/me payload.
  const rawName = payload["name"];
  const name = typeof rawName === "string" && rawName.length > 0 && rawName.length <= 200
    ? rawName
    : undefined;
  const rawPic = payload["picture"];
  const picture = typeof rawPic === "string"
    && rawPic.length > 0
    && rawPic.length <= 2048
    && /^https?:\/\//i.test(rawPic)
    ? rawPic
    : undefined;
  return {
    sub,
    email,
    emailVerified: true,
    ...(name !== undefined ? { name } : {}),
    ...(picture !== undefined ? { picture } : {}),
  };
}
