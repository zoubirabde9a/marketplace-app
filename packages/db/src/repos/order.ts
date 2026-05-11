import { and, desc, eq, inArray } from "drizzle-orm";
import { uuidv7 } from "@marketplace/shared/ids";
import { order as orderDomain, type cart as cartDomain } from "@marketplace/domain";
import { orders, orderItems } from "../schema/order.js";
import type { DbClient } from "../client.js";
import type { StoredCart } from "./cart.js";
import { isUuid } from "./_uuid.js";

export interface OrderCustomer {
  name: string;
  phone: string;
  region: string;
}

export interface StoredOrder {
  orderId: string;
  publicNumber: string;
  ownerKind: "user" | "anonymous";
  ownerId: string;
  cartId: string;
  status: orderDomain.OrderStatus;
  currency: string;
  totalMinor: bigint;
  shippingMinor: bigint;
  taxMinor: bigint;
  subtotalMinor: bigint;
  lines: cartDomain.CartLine[];
  customer: OrderCustomer | null;
  accessToken: string;
  createdAt: number;
}

function parseCustomer(meta: unknown): OrderCustomer | null {
  if (!meta || typeof meta !== "object") return null;
  const c = (meta as { customer?: unknown }).customer;
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  if (typeof o.name !== "string" || typeof o.phone !== "string" || typeof o.region !== "string") return null;
  return { name: o.name, phone: o.phone, region: o.region };
}

async function loadLines(db: DbClient, orderId: string): Promise<cartDomain.CartLine[]> {
  const rows = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  return rows.map((r) => ({
    variantId: r.variantId,
    sellerId: r.sellerId,
    qty: r.qty,
    unitPriceMinor: r.unitPriceMinor,
  }));
}

async function shape(db: DbClient, row: typeof orders.$inferSelect): Promise<StoredOrder> {
  return {
    orderId: row.id,
    publicNumber: row.publicNumber,
    ownerKind: (row.ownerKind === "user" ? "user" : "anonymous") as StoredOrder["ownerKind"],
    ownerId: row.buyerUserId ?? "anonymous",
    cartId: row.cartId ?? "",
    status: row.status as orderDomain.OrderStatus,
    currency: row.currency,
    subtotalMinor: row.subtotalMinor,
    shippingMinor: row.shippingMinor,
    taxMinor: row.taxMinor,
    totalMinor: row.totalMinor,
    lines: await loadLines(db, row.id),
    customer: parseCustomer(row.metadata),
    accessToken: row.accessToken ?? "",
    createdAt: row.createdAt.getTime(),
  };
}

export function makeOrderRepo(db: DbClient) {
  return {
    async create(input: {
      cart: StoredCart;
      subtotalMinor: bigint;
      shippingMinor: bigint;
      taxMinor: bigint;
      totalMinor: bigint;
      accessToken: string;
      customer?: OrderCustomer;
    }): Promise<StoredOrder> {
      return db.transaction(async (tx) => {
        const id = uuidv7();
        const buyerUserId = input.cart.ownerKind === "user" ? input.cart.ownerId : null;
        const [row] = await tx
          .insert(orders)
          .values({
            id,
            publicNumber: orderDomain.generatePublicNumber(),
            buyerUserId,
            cartId: input.cart.cartId,
            currency: input.cart.currency,
            subtotalMinor: input.subtotalMinor,
            discountMinor: 0n,
            shippingMinor: input.shippingMinor,
            taxMinor: input.taxMinor,
            tipMinor: 0n,
            totalMinor: input.totalMinor,
            status: "paid",
            placedAt: new Date(),
            accessToken: input.accessToken,
            ownerKind: input.cart.ownerKind,
            ...(input.customer ? { metadata: { customer: input.customer } } : {}),
          })
          .returning();
        if (input.cart.lines.length > 0) {
          await tx.insert(orderItems).values(
            input.cart.lines.map((l) => ({
              id: uuidv7(),
              orderId: id,
              variantId: l.variantId,
              sellerId: l.sellerId,
              qty: l.qty,
              unitPriceMinor: l.unitPriceMinor,
              taxMinor: 0n,
              shippingMinor: 0n,
              discountMinor: 0n,
              productSnapshot: {},
              fulfillmentStatus: "unfulfilled",
            })),
          );
        }
        return shape(tx as unknown as DbClient, row!);
      });
    },

    async get(orderId: string): Promise<StoredOrder | undefined> {
      if (!isUuid(orderId)) return undefined;
      const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      return rows[0] ? shape(db, rows[0]) : undefined;
    },

    async listForUser(userId: string): Promise<StoredOrder[]> {
      if (!isUuid(userId)) return [];
      const rows = await db
        .select()
        .from(orders)
        .where(and(eq(orders.ownerKind, "user"), eq(orders.buyerUserId, userId)))
        .orderBy(desc(orders.createdAt));
      return Promise.all(rows.map((r) => shape(db, r)));
    },

    async listForSeller(sellerId: string): Promise<StoredOrder[]> {
      if (!isUuid(sellerId)) return [];
      // Find order ids that contain at least one item sold by this seller.
      const idRows = await db
        .selectDistinct({ orderId: orderItems.orderId })
        .from(orderItems)
        .where(eq(orderItems.sellerId, sellerId));
      if (idRows.length === 0) return [];
      const orderIds = idRows.map((r) => r.orderId);
      const rows = await db
        .select()
        .from(orders)
        .where(inArray(orders.id, orderIds))
        .orderBy(desc(orders.createdAt));
      return Promise.all(rows.map((r) => shape(db, r)));
    },
  };
}
