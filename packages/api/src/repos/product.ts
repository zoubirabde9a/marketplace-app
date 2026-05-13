// Product aggregate — catalog entries with variants, media, and a seller.

import type { catalog } from "@marketplace/domain";
import type {
  StoredMedia,
  StoredProduct,
  StoredSeller,
  StoredVariant,
} from "../types/store-types.js";

export type ProductRecord = StoredProduct;
export type VariantRecord = StoredVariant;
export type MediaRecord = StoredMedia;

export interface ProductView {
  productId: string;
  titleSanitized: string;
  descriptionSanitized?: string;
  brand?: string;
  attributes: Record<string, string>;
  variants: VariantRecord[];
  sellerId: string;
  sellerDisplayName?: string;
  sellerPhone?: string;
  sellerWhatsapp?: string;
  sellerWebsite?: string;
  categoryIds?: string[];
  shipsTo?: string[];
  counterfeitRisk: catalog.CounterfeitRiskT;
  images: MediaRecord[];
  heroMediaId?: string;
}

/**
 * The repo focuses on writes + raw lookups. Search/getProduct/getProductsByIds
 * are exposed through the `ProductReader` adapter built in routes/products.ts,
 * which composes loadAll/loadOne with the in-memory search pipeline.
 */
export interface ProductRepo {
  loadAll(): Promise<{ products: StoredProduct[]; sellers: Map<string, StoredSeller> }>;
  loadOne(productId: string): Promise<StoredProduct | undefined>;
  getProductsByIds(ids: string[]): Promise<Array<StoredProduct | null>>;

  /** Resolve owning agent for a product (via the seller record). */
  getOwnerAgentId(productId: string): Promise<string | undefined>;

  create(input: {
    sellerId: string;
    title: string;
    description?: string;
    brand?: string;
    attributes?: Record<string, string>;
    categoryIds?: string[];
    shipsTo?: string[];
    variants: Array<{ sku: string; priceMinor: bigint; currency: string; inStock?: boolean }>;
    media?: Array<{
      url: string;
      contentType: string;
      byteSize?: number;
      width?: number;
      height?: number;
      altText?: string;
    }>;
    heroMediaIndex?: number;
  }): Promise<ProductRecord>;

  update(
    productId: string,
    patch: {
      title?: string;
      description?: string | null;
      brand?: string | null;
      categoryIds?: string[];
      shipsTo?: string[];
      attributes?: Record<string, string>;
      variants?: Array<{ sku: string; priceMinor: bigint; currency: string; inStock?: boolean }>;
    },
  ): Promise<ProductRecord | undefined>;

  /**
   * Attach an already-uploaded media URL to a product. Bytes are stored
   * separately by POST /v1/media (which writes to the media volume and
   * returns a content-addressed URL); this just records the metadata and
   * promotes the new row to hero if the product has no hero yet.
   */
  addMedia(
    productId: string,
    input: {
      url: string;
      contentType: string;
      byteSize?: number;
      width?: number;
      height?: number;
      altText?: string;
    },
  ): Promise<MediaRecord | undefined>;

  removeMedia(productId: string, mediaId: string): Promise<boolean>;
}
