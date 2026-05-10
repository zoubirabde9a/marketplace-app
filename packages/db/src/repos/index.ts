// Drizzle-backed repository factory. Exposes `createRepos(db)` returning a
// bundle of aggregate repositories that the API layer consumes via interfaces
// declared in `@marketplace/api/src/repos`.

import type { DbClient } from "../client.js";
import { makeUserRepo } from "./user.js";
import { makeSellerRepo } from "./seller.js";
import { makeProductRepo } from "./product.js";
import { makeCartRepo } from "./cart.js";
import { makeOrderRepo } from "./order.js";
import { makeIdempotencyStore } from "./idempotency.js";
import { makeJtiStore } from "./jti.js";
import { makeSearchLogRepo } from "./search-log.js";

export {
  makeUserRepo,
  makeSellerRepo,
  makeProductRepo,
  makeCartRepo,
  makeOrderRepo,
  makeIdempotencyStore,
  makeJtiStore,
  makeSearchLogRepo,
};

export function createRepos(db: DbClient) {
  return {
    users: makeUserRepo(db),
    sellers: makeSellerRepo(db),
    products: makeProductRepo(db),
    carts: makeCartRepo(db),
    orders: makeOrderRepo(db),
    idempotency: makeIdempotencyStore(db),
    jti: makeJtiStore(db),
    searchLog: makeSearchLogRepo(db),
  };
}

export type Repos = ReturnType<typeof createRepos>;
