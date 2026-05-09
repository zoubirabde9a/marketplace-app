// Order aggregate — created from a cart at checkout.

import type { StoredCart, StoredOrder } from "../types/store-types.js";

export type OrderRecord = StoredOrder;

export interface OrderRepo {
  create(input: {
    cart: StoredCart;
    subtotalMinor: bigint;
    shippingMinor: bigint;
    taxMinor: bigint;
    totalMinor: bigint;
    accessToken: string;
  }): Promise<OrderRecord>;

  get(orderId: string): Promise<OrderRecord | undefined>;

  listForUser(userId: string): Promise<OrderRecord[]>;
}
