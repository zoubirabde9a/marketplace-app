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

    const scope = `${req.method}:${req.url.split("?")[0]}`;
    const bodyStr = req.body ? JSON.stringify(req.body) : "";
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
    void opts.store.finalize(ctx.key, ctx.scope, reply.statusCode, body);
    return payload;
  });
}
