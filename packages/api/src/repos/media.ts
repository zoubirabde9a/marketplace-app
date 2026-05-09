// Media blob storage — bytes for product images uploaded via the API.

import type { StoredMediaBlob } from "../types/store-types.js";

export type MediaBlob = StoredMediaBlob;

export interface MediaRepo {
  get(mediaId: string): Promise<MediaBlob | undefined>;
}
