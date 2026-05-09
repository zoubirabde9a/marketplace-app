// Dev/demo entry point. Connects to Postgres via @marketplace/db and starts
// an HTTP server. End-user (human) endpoints are gated by Google OAuth ID-token
// verification + a marketplace-signed session JWT. Agent endpoints continue to
// use Passport+DPoP.

import { config as loadDotenv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, createRepos } from "@marketplace/db";
import { Redis as IORedis } from "ioredis";
import { catalog } from "@marketplace/domain";
import { buildServer } from "./server.js";
import { makeProductReader } from "./routes/products.js";
import { RedisSnapshotStore } from "./repos/snapshots.js";

const envBaseDir: string = (function loadDotenvFromAncestor(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
})();

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3100);

function defaultIssuerKeysPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "..", "minimal-issuer", "keys", "issuer.json");
}

interface IssuerKeyFile {
  kid: string;
  alg: "EdDSA";
  privateJwk: Record<string, unknown>;
  publicJwk: Record<string, unknown>;
}

interface LoadedKeys {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

function loadKeys(): LoadedKeys {
  const fromEnv = process.env.ISSUER_KEYS_PATH;
  const p = fromEnv
    ? path.isAbsolute(fromEnv)
      ? fromEnv
      : path.resolve(envBaseDir, fromEnv)
    : defaultIssuerKeysPath();
  const raw = JSON.parse(readFileSync(p, "utf8")) as IssuerKeyFile;
  const publicKey = createPublicKey({ key: raw.publicJwk as object as never, format: "jwk" });
  const privateKey = createPrivateKey({ key: raw.privateJwk as object as never, format: "jwk" });
  return { kid: raw.kid, privateKey, publicKey };
}

async function main(): Promise<void> {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  if (!googleClientId) {
    // eslint-disable-next-line no-console
    console.error(
      "GOOGLE_CLIENT_ID is required. Set it in .env (see .env.example) or as an environment variable.",
    );
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    // eslint-disable-next-line no-console
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }

  const { db, close } = createDb({ url: databaseUrl });
  const repos = createRepos(db);
  const keys = loadKeys();
  const audience = process.env.AUDIENCE ?? "marketplace.dev";

  const productReader = makeProductReader(repos.products);

  const redisUrl = process.env.REDIS_URL;
  const redis = redisUrl ? new IORedis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 }) : null;
  if (redis) await redis.connect();
  const snapshotStore: catalog.SnapshotStore = redis
    ? new RedisSnapshotStore(redis)
    : new catalog.MemorySnapshotStore();

  const app = await buildServer({
    authDeps: {
      resolveIssuerKey: async (kid) => (kid === keys.kid ? keys.publicKey : undefined),
      resolveSessionKey: async (kid) => (kid === keys.kid ? keys.publicKey : undefined),
      isPassportRevoked: async () => false,
      jtiSeen: (jti, expiresAtMs) => repos.jti.seen(jti, expiresAtMs),
      audience,
      now: () => Date.now(),
      devBypass: process.env.DEV_BYPASS === "1",
    },
    productReader,
    repos,
    idempotencyStore: repos.idempotency,
    snapshotStore,
    authRouteDeps: {
      googleClientId,
      sessionIssuer: { kid: keys.kid, privateKey: keys.privateKey },
      resolveSessionKey: async (kid) => (kid === keys.kid ? keys.publicKey : undefined),
      passportIssuer: {
        kid: keys.kid,
        privateKey: keys.privateKey,
        publicKey: keys.publicKey,
        alg: "EdDSA",
      },
      audience,
      webOrigin: process.env.WEB_ORIGIN ?? "https://teno-store.com",
      now: () => Date.now(),
    },
  });

  app.addHook("onClose", async () => {
    await close();
    if (redis) await redis.quit();
  });

  await app.listen({ host: HOST, port: PORT });
  app.log.info(`Marketplace API ready at http://${HOST}:${PORT}`);
  app.log.info(`Issuer kid: ${keys.kid}. Google client: ${googleClientId.slice(0, 16)}…`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("fatal", err);
  process.exit(1);
});
