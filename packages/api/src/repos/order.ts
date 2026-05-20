// Order aggregate — created from a cart at checkout.

import type { OrderCustomer, StoredCart, StoredOrder } from "../types/store-types.js";
import type { order as orderDomain } from "@marketplace/domain";

export type OrderRecord = StoredOrder;

export type SellerEventResult =
  | { kind: "ok"; status: orderDomain.OrderStatus }
  | { kind: "not_found" }
  | { kind: "not_owned" }
  | { kind: "invalid_transition"; current: orderDomain.OrderStatus };

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

  /**
   * Most recent order created for `cartId` within the last `withinMs` window,
   * or undefined if none. Used by /v1/checkout/confirm and the MCP
   * checkout.confirm tool to make confirms idempotent: a retry of a confirm
   * that already succeeded (cart is now empty) returns the original order
   * instead of throwing cart:empty.
   *
   * Implementations should accept a non-uuid cartId and just return undefined
   * (do not throw) so the caller's existing validation path remains in charge
   * of cartId shape errors.
   */
  findRecentByCartId(cartId: string, withinMs: number): Promise<OrderRecord | undefined>;

  /**
   * Apply a seller-driven domain event to an order (begin_fulfillment / ship
   * / deliver / cancel). Verifies the seller owns at least one line item in
   * the order, then runs the order-domain `applyEvent` state machine and
   * persists the new status + a row in `order_status_history` so we can
   * audit who transitioned what when.
   */
  applySellerEvent(input: {
    orderId: string;
    sellerId: string;
    event: orderDomain.OrderEvent;
    actorAgentId: string;
  }): Promise<SellerEventResult>;
}
