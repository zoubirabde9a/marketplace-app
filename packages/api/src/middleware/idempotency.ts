// Idempotency-Key handling for mutating endpoints.
// Per spec §5.1: required on all mutating calls. Replays return cached response.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ConflictError, ValidationError } from "@marketplace/shared/errors";
import { createHash } from "node:crypto";

export interface IdempotencyStore {
  /** Find an existing record for this key + method + path scope. */
  get(key: string, scope: string): Promise<{ requestHash: string; status: number; body: unknown } | null>;
  /** Reserve a key (returns true if reservation succeeded; false on race). */
  reserve(key: string, scope: string, requestHash: string, ttlSeconds: number): Promise<boolean>;
  /** Persist final response associated with this key. */
  finalize(key: string, scope: string, status: number, body: unknown): Promise<void>;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly map = new Map<string, { requestHash: string; status: number; body: unknown; expiresAt: number }>();

  async get(key: string, scope: string) {
    this.gc();
    const e = this.map.get(`${scope}:${key}`);
    if (!e) return null;
    return { requestHash: e.requestHash, status: e.status, body: e.body };
  }

  async reserve(key: string, scope: string, requestHash: string, ttlSeconds: number) {
    this.gc();
    const k = `${scope}:${key}`;
    const existing = this.map.get(k);
    if (existing) {
      // Existing reservation — fail unless same payload
      return existing.requestHash === requestHash;
    }
    this.map.set(k, { requestHash, status: 0, body: null, expiresAt: Date.now() + ttlSeconds * 1000 });
    return true;
  }

  async finalize(key: string, scope: string, status: number, body: unknown) {
    const k = `${scope}:${key}`;
    const e = this.map.get(k);
    if (!e) return;
    e.status = status;
    e.body = body;
  }

  private gc(): void {
    const now = Date.now();
    for (const [k, v] of this.map.entries()) if (v.expiresAt < now) this.map.delete(k);
  }
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface IdempotencyOptions {
  store: IdempotencyStore;
  ttlSeconds?: number;
  /** Routes/methods exempt from the requirement (auth endpoints, etc.). */
  exempt?: (req: FastifyRequest) => boolean;
}

type IdemCtx = { key: string; scope: string };

declare module "fastify" {
  interface FastifyRequest {
    _idemCtx?: IdemCtx;
  }
}

export async function registerIdempotency(app: FastifyInstance, opts: IdempotencyOptions): Promise<void> {
  const ttl = opts.ttlSeconds ?? 86_400;

  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!MUTATING.has(req.method)) return;
    if (opts.exempt?.(req)) return;
    if (req.url.startsWith("/oauth/")) return;

    const key = req.headers["idempotency-key"];
    if (!key || typeof key !== "string") {
      throw new ValidationError([{ path: "headers.idempotency-key", message: "required" }]);
    }
    if (key.length < 8 || key.length > 128) {
      throw new ValidationError([{ path: "headers.idempotency-key", message: "must be 8-128 chars" }]);
    }
    // Restrict to printable-ASCII (no whitespace, no controls, no
    // non-ASCII). Without this, a key containing a NUL byte or unicode
    // homoglyph (e.g. Cyrillic "а" U+0430 vs Latin "a") would key the
    // store-side Map/Redis entry differently from a similar-looking key
    // a client logs and re-sends — a retry would re-execute the handler
    // because the two never match. Also closes line-injection vectors
    // into the audit log line that includes the key.
    if (!/^[A-Za-z0-9_\-:.]+$/.test(key)) {
      throw new ValidationError([
        { path: "headers.idempotency-key", message: "must contain only [A-Za-z0-9_-:.] chars" },
      ]);
    }

    const scope = `${req.method}:${req.url.split("?")[0]}`;
    // Use `!= null` rather than truthy — a request body that legitimately
    // serialises to a falsy value (`0`, `false`, empty string) would
    // otherwise collide with a no-body request because both took the
    // `""` branch. JSON.stringify(0) → "0", JSON.stringify(undefined) → undefined.
    const bodyStr = req.body != null ? JSON.stringify(req.body) : "";
    const requestHash = createHash("sha256").update(`${scope}:${bodyStr}`).digest("hex");

    const cached = await opts.store.get(key, scope);
    if (cached) {
      if (cached.requestHash !== requestHash) {
        throw new ConflictError("idempotency_key_conflict_different_payload");
      }
      if (cached.status > 0) {
        void reply.code(cached.status).send(cached.body);
        return;
      }
      // status === 0 means a previous request reserved the key but hasn't
      // finalized yet — i.e. a concurrent in-flight retry. Letting it fall
      // through ran the route handler a second time with the same key,
      // violating the idempotency contract (side effects happen twice).
      // Reject the retry; the client should backoff and re-poll.
      throw new ConflictError("idempotency_key_concurrent_request");
    } else {
      const ok = await opts.store.reserve(key, scope, requestHash, ttl);
      if (!ok) throw new ConflictError("idempotency_key_concurrent_request");
    }

    req._idemCtx = { key, scope };
  });

  // onSend fires after the route handler and gives us the serialized payload
  // before it's flushed. Parse it back so cached replays return a real JSON
  // body — `reply._payload` doesn't exist on Fastify replies, so the previous
  // approach silently cached `null`.
  app.addHook("onSend", async (req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    const ctx = req._idemCtx;
    if (!ctx) return payload;
    let body: unknown = payload;
    if (typeof payload === "string") {
      try {
        body = JSON.parse(payload);
      } catch {
        body = payload;
      }
    } else if (Buffer.isBuffer(payload)) {
      body = payload.toString("utf8");
    }
    // Await the finalize: if the response leaves the wire before the store
    // commits, a fast retry can race in, see the reservation still at
    // status=0, and (now correctly) get bounced as a concurrent request —
    // but with the await, the retry instead reads the finalized cached
    // response, which is the actual idempotent-replay behaviour we promise.
    // Wrap in try/catch so a store outage doesn't fail the in-flight call;
    // worst case the next retry re-runs the handler, which is no worse
    // than not having idempotency at all.
    try {
      await opts.store.finalize(ctx.key, ctx.scope, reply.statusCode, body);
    } catch (err) {
      req.log.warn(
        { err: err instanceof Error ? err.message : String(err), key: ctx.key, scope: ctx.scope },
        "idempotency_finalize_failed",
      );
    }
    return payload;
  });
}
