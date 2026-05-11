// Seller aggregate — merchant accounts that own products.

import type { StoredSeller, StoredSellerPhone } from "../types/store-types.js";

export type SellerRecord = StoredSeller;
export type SellerPhone = StoredSellerPhone;

export interface SellerPhoneInput {
  phone: string;
  isWhatsapp?: boolean;
  isViber?: boolean;
  isPrimary?: boolean;
  position?: number;
  source?: string;
}

export interface SellerRepo {
  create(input: {
    displayName: string;
    ownerAgentId: string;
    phones?: SellerPhoneInput[];
    /** @deprecated pass via `phones` */
    phone?: string;
    /** @deprecated pass a phone with `isWhatsapp: true` via `phones` */
    whatsapp?: string;
    website?: string;
    description?: string;
    supportEmail?: string;
    city?: string;
    countryCode?: string;
  }): Promise<SellerRecord>;

  /** Replace all phones for a seller (e.g. on scraper sync). Returns the stored list. */
  replacePhones(sellerId: string, phones: SellerPhoneInput[]): Promise<SellerPhone[]>;

  /** Lookup the current list of phones for a seller. */
  listPhones(sellerId: string): Promise<SellerPhone[]>;

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
