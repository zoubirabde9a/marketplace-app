// Redis-backed response cache for read endpoints. The expensive work behind
// search (Postgres + embeddings + facet aggregation) is identical for every
// caller of the same query string, so we cache the rendered JSON body keyed
// by URL with a short TTL. Writes don't invalidate; staleness is bounded by
// the TTL, which is fine for a low-write catalog.
//
// Only anonymous traffic is cached. If an Authorization header is present we
// bypass — agent/user-scoped responses must never leak across principals.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Redis as IORedis } from "ioredis";

export interface ResponseCacheOptions {
  redis: IORedis;
  ttlSeconds: number;
  /** Return true to cache this request. Should be cheap and side-effect free. */
  shouldCache: (req: FastifyRequest) => boolean;
  /** Cache key. Must capture every input that affects the response body. */
  keyOf: (req: FastifyRequest) => string;
  /** Optional log tag. */
  tag?: string;
}

type CachedRequest = FastifyRequest & { _responseCacheKey?: string };

export async function registerResponseCache(
  app: FastifyInstance,
  opts: ResponseCacheOptions,
): Promise<void> {
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!opts.shouldCache(req)) return;
    const key = opts.keyOf(req);
    let hit: string | null = null;
    try {
      hit = await opts.redis.get(key);
    } catch (err) {
      req.log.warn({ err, tag: opts.tag }, "response_cache_get_failed");
      return;
    }
    if (hit) {
      reply.header("content-type", "application/json; charset=utf-8");
      reply.header("x-cache", "HIT");
      void reply.send(hit);
      return;
    }
    (req as CachedRequest)._responseCacheKey = key;
    reply.header("x-cache", "MISS");
  });

  app.addHook("onSend", async (req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    const key = (req as CachedRequest)._responseCacheKey;
    if (!key) return payload;
    if (reply.statusCode !== 200) return payload;
    const data =
      typeof payload === "string"
        ? payload
        : payload instanceof Buffer
          ? payload.toString("utf8")
          : null;
    if (data) {
      opts.redis
        .set(key, data, "EX", opts.ttlSeconds)
        .catch((err) => req.log.warn({ err, tag: opts.tag }, "response_cache_set_failed"));
    }
    return payload;
  });
}
