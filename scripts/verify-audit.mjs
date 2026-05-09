// End-to-end verification of the audit.agent_actions inserter wired in
// packages/api/src/middleware/audit.ts.
//
// What it does:
//   1. Reads the marketplace issuer key from /app/minimal-issuer/keys/issuer.json
//      (mounted into the api container at runtime).
//   2. Generates a fresh Ed25519 keypair to act as the test agent.
//   3. Inserts the minimal DB rows the API's FK constraints require:
//        identity.users → identity.agents → identity.agent_passports
//      (Tagged with `audit-verify@test.local` so they are easy to grep/clean.)
//   4. Mints a passport JWT signed by the issuer key, with cnf.jwk bound to
//      the agent's public key.
//   5. Mints a DPoP proof JWT bound to the same agent key, htm/htu matching
//      the request we are about to make.
//   6. POSTs to https://api.teno-store.com/v1/sellers with Authorization +
//      DPoP + x-mp-passport headers.
//   7. Sleeps briefly (audit insert is fire-and-forget).
//   8. Queries audit.agent_actions WHERE agent_id = <our test agent>
//      and prints every row.
//
// Run inside the api container:
//   docker compose -f /opt/marketplace/docker-compose.prod.yml exec api \
//     node /tmp/verify-audit.mjs
//
// The script uses only Node built-ins + the `postgres` package already in
// /app/node_modules.

import { readFileSync } from "node:fs";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  randomUUID,
  createHash,
} from "node:crypto";
import postgres from "postgres";

// ── config ────────────────────────────────────────────────────────────────
const ISSUER_KEY_PATH = process.env.ISSUER_KEYS_PATH ?? "/app/minimal-issuer/keys/issuer.json";
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const AUDIENCE = process.env.AUDIENCE ?? "marketplace.teno-store.com";
const API_BASE = process.env.VERIFY_API_BASE ?? "https://api.teno-store.com";
// One unique email per run so a crashed earlier run doesn't poison the next
// (the email column has a unique index).
const TEST_TAG = `audit-verify-${randomUUID().slice(0, 8)}@test.local`;

// ── helpers ───────────────────────────────────────────────────────────────
function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function uuidV7() {
  // We can use randomUUID for v4 — the schema column accepts uuid; the
  // `uuidv7` helper in the codebase is for ID ordering, not validity. v4 is
  // perfectly valid for the FK targets.
  return randomUUID();
}

async function jwkThumbprint(jwk) {
  const canonical = jwk.kty === "OKP"
    ? { crv: jwk.crv, kty: jwk.kty, x: jwk.x }
    : jwk.kty === "EC"
    ? { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }
    : null;
  if (!canonical) throw new Error("unsupported_jwk_kty");
  const json = JSON.stringify(canonical, Object.keys(canonical).sort());
  const hash = createHash("sha256").update(json).digest();
  return b64url(hash);
}

function signEd25519Jwt(header, payload, privateKey) {
  const headerB64 = b64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = sign(null, Buffer.from(signingInput), privateKey);
  return `${signingInput}.${b64url(sig)}`;
}

// ── load issuer key ───────────────────────────────────────────────────────
const issuerFile = JSON.parse(readFileSync(ISSUER_KEY_PATH, "utf8"));
const issuerPriv = createPrivateKey({ key: issuerFile.privateJwk, format: "jwk" });
const issuerKid = issuerFile.kid;

// ── generate the agent's keypair (Ed25519) ────────────────────────────────
const { publicKey: agentPub, privateKey: agentPriv } = generateKeyPairSync("ed25519");
const agentJwk = agentPub.export({ format: "jwk" });
const agentJkt = await jwkThumbprint(agentJwk);

// ── set up DB ─────────────────────────────────────────────────────────────
const sql = postgres(DATABASE_URL, { onnotice: () => {} });

const userId = uuidV7();
const agentId = uuidV7();
const passportId = uuidV7();
console.log("test-user", userId);
console.log("test-agent", agentId);
console.log("test-passport", passportId);

try {
  await sql.begin(async (s) => {
    await s`
      INSERT INTO identity.users
        (id, email, email_verified, display_name, status, created_at, updated_at)
      VALUES
        (${userId}, ${TEST_TAG}, TRUE, 'Audit Verify User', 'active', NOW(), NOW())
    `;
    await s`
      INSERT INTO identity.agents
        (id, owner_user_id, name, agent_kind, public_key, public_key_kid, status, created_at, updated_at)
      VALUES
        (${agentId}, ${userId}, 'audit-verify-agent', 'buyer',
         ${JSON.stringify(agentJwk)}, 'verify-1', 'active', NOW(), NOW())
    `;
    await s`
      INSERT INTO identity.agent_passports
        (id, agent_id, issuer, scopes, spend_caps,
         issued_at, expires_at, status, signature, created_at)
      VALUES
        (${passportId}, ${agentId}, 'marketplace',
         ${sql.json(["catalog:read", "seller:write", "seller:product:write"])},
         ${sql.json({ currency: "USD" })},
         NOW(), NOW() + INTERVAL '1 hour', 'active', '', NOW())
    `;
  });

  // ── mint passport JWT ──────────────────────────────────────────────────
  const nowSec = Math.floor(Date.now() / 1000);
  const passportClaims = {
    iss: "marketplace",
    sub: agentId,
    aud: AUDIENCE,
    jti: passportId,
    iat: nowSec,
    exp: nowSec + 3600,
    cnf: { jwk: agentJwk },
    scopes: ["catalog:read", "seller:write", "seller:product:write"],
    spend_caps: { currency: "USD" },
    owner: { kind: "user", id: userId },
  };
  const passportJwt = signEd25519Jwt(
    { alg: "EdDSA", typ: "passport+jwt", kid: issuerKid },
    passportClaims,
    issuerPriv,
  );

  // ── mint DPoP proof + access token ─────────────────────────────────────
  const accessToken = "verify-token-" + randomUUID();
  const ath = b64url(createHash("sha256").update(accessToken).digest());

  const targetUrl = `${API_BASE}/v1/sellers`;
  const dpopProof = signEd25519Jwt(
    { alg: "EdDSA", typ: "dpop+jwt", jwk: agentJwk },
    {
      htm: "POST",
      htu: targetUrl,
      iat: nowSec,
      jti: randomUUID(),
      ath,
    },
    agentPriv,
  );

  // ── make the request ───────────────────────────────────────────────────
  console.log("\nPOSTing to", targetUrl);
  const res = await fetch(targetUrl, {
    method: "POST",
    headers: {
      authorization: `DPoP ${accessToken}`,
      dpop: dpopProof,
      "x-mp-passport": passportJwt,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({ displayName: "Audit Verify Seller " + Date.now() }),
  });
  const text = await res.text();
  console.log("API response", res.status);
  console.log(text.slice(0, 400));

  // ── wait for fire-and-forget audit insert ──────────────────────────────
  await new Promise((r) => setTimeout(r, 400));

  // ── query audit.agent_actions for our test agent ───────────────────────
  const rows = await sql`
    SELECT id, agent_id, passport_id, tool_name, scope, status,
           latency_ms, occurred_at, error_code
    FROM audit.agent_actions
    WHERE agent_id = ${agentId}
    ORDER BY occurred_at DESC
    LIMIT 5
  `;
  console.log(`\naudit.agent_actions rows for agent ${agentId}:`);
  for (const r of rows) console.log(JSON.stringify(r));

  if (rows.length === 0) {
    console.log("\n❌ NO AUDIT ROW INSERTED — hook did not fire or insert silently failed");
    process.exitCode = 2;
  } else {
    console.log("\n✅ audit row written end-to-end");
  }

  // ── also query whatever recentActivity would return for this user ──────
  const feed = await sql`
    SELECT a.tool_name, a.status, a.latency_ms, a.occurred_at, ag.name AS agent_name
    FROM audit.agent_actions a
    JOIN identity.agents ag ON ag.id = a.agent_id
    WHERE ag.owner_user_id = ${userId}
    ORDER BY a.occurred_at DESC
    LIMIT 5
  `;
  console.log(`\nFeed view (what /v1/me/activity returns for this user):`);
  for (const r of feed) console.log(JSON.stringify(r));

  // ── clean up the test rows ─────────────────────────────────────────────
  await sql.begin(async (s) => {
    await s`DELETE FROM audit.agent_actions WHERE agent_id = ${agentId}`;
    await s`DELETE FROM identity.agent_passports WHERE id = ${passportId}`;
    await s`DELETE FROM identity.agents WHERE id = ${agentId}`;
    await s`DELETE FROM identity.users WHERE id = ${userId}`;
  });
  console.log("\ncleaned up test rows");
} finally {
  await sql.end({ timeout: 5 });
}
