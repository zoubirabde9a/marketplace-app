// Repository interfaces — one per aggregate. HTTP routes depend on these
// interfaces, not on a concrete store. Implementations live in @marketplace/db
// (Drizzle-backed, production).

export type { UserRepo, UserRecord } from "./user.js";
export type { SellerRepo, SellerRecord } from "./seller.js";
export type { ProductRepo, ProductRecord, ProductView, VariantRecord, MediaRecord } from "./product.js";
export type { CartRepo, CartRecord } from "./cart.js";
export type { OrderRepo, OrderRecord } from "./order.js";

import type { UserRepo } from "./user.js";
import type { SellerRepo } from "./seller.js";
import type { ProductRepo } from "./product.js";
import type { CartRepo } from "./cart.js";
import type { OrderRepo } from "./order.js";

/** Bundle of all aggregate repositories, passed through the server graph. */
export interface Repos {
  users: UserRepo;
  sellers: SellerRepo;
  products: ProductRepo;
  carts: CartRepo;
  orders: OrderRepo;
}
