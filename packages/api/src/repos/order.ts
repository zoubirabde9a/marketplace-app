// Order aggregate — created from a cart at checkout.

import type { OrderCustomer, StoredCart, StoredOrder } from "../types/store-types.js";

export type OrderRecord = StoredOrder;

export interface OrderRepo {
  create(input: {
    cart: StoredCart;
    subtotalMinor: bigint;
    shippingMinor: bigint;
    taxMinor: bigint;
    totalMinor: bigint;
    accessToken: string;
    customer?: OrderCustomer;
  }): Promise<OrderRecord>;

  get(orderId: string): Promise<OrderRecord | undefined>;

  listForUser(userId: string): Promise<OrderRecord[]>;

  /** Orders that include at least one line item sold by the given seller. */
  listForSeller(sellerId: string): Promise<OrderRecord[]>;
}
