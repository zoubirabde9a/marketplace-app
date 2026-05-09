// Seller aggregate — merchant accounts that own products.

import type { StoredSeller } from "../types/store-types.js";

export type SellerRecord = StoredSeller;

export interface SellerRepo {
  create(input: {
    displayName: string;
    ownerAgentId: string;
    phone?: string;
    whatsapp?: string;
    website?: string;
  }): Promise<SellerRecord>;

  /**
   * Patch contact fields. `null` clears a field; `undefined` leaves it alone.
   * Returns undefined if the seller does not exist.
   */
  updateContact(
    sellerId: string,
    patch: {
      phone?: string | null | undefined;
      whatsapp?: string | null | undefined;
      website?: string | null | undefined;
    },
  ): Promise<SellerRecord | undefined>;

  get(sellerId: string): Promise<SellerRecord | undefined>;

  list(): Promise<SellerRecord[]>;

  countProducts(sellerId: string): Promise<number>;
}
