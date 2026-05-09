// UUID format guard. Postgres' uuid type rejects non-UUID strings with a
// 22P02 error; in our repos we want a non-UUID id to behave like "no such
// row" rather than crash the request handler.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}
