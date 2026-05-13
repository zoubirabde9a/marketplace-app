"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FR_CATEGORY } from "@/lib/categories";

// A short curated list of seller-facing categories. The full FR_CATEGORY map
// has nested/duplicate slugs (smartphones vs telephones, voitures vs
// vehicules) that confuse non-technical sellers; this list keeps the choices
// few and obvious. Slugs match what /search and the catalog facets emit.
const SELLER_CATEGORIES: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: "telephones", label: FR_CATEGORY.telephones },
  { slug: "informatique", label: FR_CATEGORY.informatique },
  { slug: "electromenager", label: FR_CATEGORY.electromenager },
  { slug: "mode", label: FR_CATEGORY.mode },
  { slug: "maison", label: FR_CATEGORY.maison },
  { slug: "vehicules", label: FR_CATEGORY.vehicules },
  { slug: "bebe", label: FR_CATEGORY.bebe },
  { slug: "sport", label: FR_CATEGORY.sport },
  { slug: "accessoires", label: FR_CATEGORY.accessoires },
  { slug: "jeux", label: FR_CATEGORY.jeux },
];

interface SellerOption {
  sellerId: string;
  displayName: string;
}

// Mirror of the API's accepted set (packages/api/src/routes/products.ts).
// Kept short on purpose — heic/tiff need transcoding the API doesn't do yet.
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];
const MAX_IMAGES = 8;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

interface StagedImage {
  /** Local id used for React keys before/after upload completes. */
  localId: string;
  file: File;
  /** object-URL preview, revoked on unmount or remove. */
  previewUrl: string;
  /** Set once the upload to /api/seller/media has returned. */
  uploaded?: { url: string; contentType: string; byteSize: number };
  error?: string;
  uploading: boolean;
}

export function NewProductForm({
  sellers,
  defaultSellerId,
}: {
  sellers: SellerOption[];
  defaultSellerId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [images, setImages] = useState<StagedImage[]>([]);

  function addFiles(files: FileList | null): void {
    if (!files) return;
    setError(null);
    const next: StagedImage[] = [];
    for (const f of Array.from(files)) {
      if (images.length + next.length >= MAX_IMAGES) {
        setError(`Maximum ${MAX_IMAGES} images.`);
        break;
      }
      if (!ACCEPTED_IMAGE_TYPES.includes(f.type)) {
        setError(`Format non supporté : ${f.name}. Utilisez JPG, PNG, WEBP, AVIF ou GIF.`);
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        setError(`Trop volumineux (max 10 Mo) : ${f.name}.`);
        continue;
      }
      next.push({
        localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file: f,
        previewUrl: URL.createObjectURL(f),
        uploading: true,
      });
    }
    if (next.length === 0) return;
    setImages((prev) => [...prev, ...next]);
    // Kick off uploads in parallel. Each completes independently and updates
    // its own row. We let the user keep filling in other fields meanwhile.
    for (const img of next) {
      void uploadOne(img);
    }
  }

  async function uploadOne(img: StagedImage): Promise<void> {
    try {
      const fd = new FormData();
      fd.append("file", img.file);
      const r = await fetch("/api/seller/media", { method: "POST", body: fd });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { detail?: string; error?: string };
        throw new Error(j.detail || j.error || `HTTP ${r.status}`);
      }
      const data = (await r.json()) as { url: string; contentType: string; byteSize: number };
      setImages((prev) =>
        prev.map((x) =>
          x.localId === img.localId
            ? { ...x, uploaded: data, uploading: false }
            : x,
        ),
      );
    } catch (e) {
      setImages((prev) =>
        prev.map((x) =>
          x.localId === img.localId
            ? { ...x, uploading: false, error: (e as Error).message }
            : x,
        ),
      );
    }
  }

  function removeImage(localId: string): void {
    setImages((prev) => {
      const target = prev.find((x) => x.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((x) => x.localId !== localId);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const sellerId = String(f.get("sellerId") ?? "").trim();
        const title = String(f.get("title") ?? "").trim();
        const brand = String(f.get("brand") ?? "").trim();
        const description = String(f.get("description") ?? "").trim();
        const category = String(f.get("category") ?? "").trim();
        const skuInput = String(f.get("sku") ?? "").trim();
        const priceMajor = String(f.get("priceMajor") ?? "").trim();
        // DZD is the catalog default — virtually all live listings are in
        // Algerian dinars. The field is hidden in the form to keep it simple;
        // we just pass DZD through.
        const currency = "DZD";

        if (!title) return setError("Le titre est obligatoire.");
        // SKU is auto-generated when blank so sellers don't have to think
        // about an inventory code on day one. Built from a slug of the title
        // plus a short random suffix for uniqueness.
        const sku = skuInput || autoSku(title);
        if (!/^\d+(\.\d{1,2})?$/.test(priceMajor)) {
          return setError("Le prix doit être un nombre positif avec au plus 2 décimales.");
        }
        // Convert price to minor units (e.g. cents) — assumes 2dp currencies.
        // Good enough for the dashboard; JPY-style 0dp currencies aren't yet
        // surfaced separately.
        const [whole, frac = ""] = priceMajor.split(".");
        const priceMinor = `${whole}${frac.padEnd(2, "0").slice(0, 2)}`.replace(/^0+(?=\d)/, "");

        // Media gate: ≥1 successful upload. Mirrors the API's media.min(1)
        // requirement so we fail fast in the browser with a clear message
        // instead of letting the server reject the request.
        const successful = images.filter((x) => x.uploaded);
        if (successful.length === 0) {
          return setError("Ajoutez au moins une image du produit.");
        }
        if (images.some((x) => x.uploading)) {
          return setError("Patientez : un téléversement est en cours.");
        }

        setError(null);
        start(async () => {
          const r = await fetch("/api/seller/products", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              sellerId,
              title,
              ...(brand ? { brand } : {}),
              ...(description ? { description } : {}),
              ...(category ? { categoryIds: [category] } : {}),
              variants: [{ sku, priceMinor, currency, inStock: true }],
              media: successful.map((x) => ({
                url: x.uploaded!.url,
                contentType: x.uploaded!.contentType,
                byteSize: x.uploaded!.byteSize,
              })),
            }),
          });
          if (!r.ok) {
            const j = (await r.json().catch(() => ({}))) as { error?: string; detail?: string };
            setError(j.detail || j.error || `Échec (HTTP ${r.status})`);
            return;
          }
          // Free the preview blob URLs before we navigate.
          for (const x of images) URL.revokeObjectURL(x.previewUrl);
          // Land back on the dashboard so the seller sees their freshly-created
          // product in the list. With media required at creation, the new
          // product passes the catalog filter and is visible immediately.
          router.push("/seller/dashboard");
          router.refresh();
        });
      }}
      className="grid gap-4"
      lang="fr"
    >
      {sellers.length > 1 ? (
        <label className="text-sm">
          <span className="block text-ink-soft mb-1">Boutique</span>
          <select
            name="sellerId"
            defaultValue={defaultSellerId}
            className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-ink focus:border-accent/60 outline-none"
          >
            {sellers.map((s) => (
              <option key={s.sellerId} value={s.sellerId}>
                {s.displayName}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="sellerId" value={defaultSellerId} />
      )}

      <ImageUploader
        images={images}
        onAdd={addFiles}
        onRemove={removeImage}
      />

      <Field label="Titre" name="title" required maxLength={300} />
      <Field label="Marque" name="brand" maxLength={120} />
      <label className="text-sm">
        <span className="block text-ink-soft mb-1">Description</span>
        <textarea
          name="description"
          maxLength={5000}
          rows={4}
          className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-ink focus:border-accent/60 outline-none"
        />
      </label>
      <label className="text-sm">
        <span className="block text-ink-soft mb-1">Catégorie</span>
        <select
          name="category"
          defaultValue=""
          className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-ink focus:border-accent/60 outline-none"
        >
          <option value="">— Aucune —</option>
          {SELLER_CATEGORIES.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="grid grid-cols-2 gap-3">
        <Field label="Prix (DZD)" name="priceMajor" required placeholder="29999" />
        <Field label="SKU (optionnel)" name="sku" maxLength={64} placeholder="généré automatiquement" />
      </fieldset>
      {error && (
        <p className="text-sm text-bad" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || images.some((x) => x.uploading)}
        className="self-start inline-flex h-10 px-4 items-center rounded-lg bg-accent text-bg font-medium hover:bg-accent-hover transition disabled:opacity-60"
      >
        {pending ? "Création…" : "Créer le produit"}
      </button>
    </form>
  );
}

function ImageUploader({
  images,
  onAdd,
  onRemove,
}: {
  images: StagedImage[];
  onAdd: (files: FileList | null) => void;
  onRemove: (localId: string) => void;
}): React.ReactElement {
  const canAddMore = images.length < MAX_IMAGES;
  return (
    <div className="text-sm">
      <span className="block text-ink-soft mb-1">
        Images <span className="text-ink-mute">({images.length}/{MAX_IMAGES}, JPG/PNG/WEBP)</span>
      </span>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {images.map((img) => (
          <div
            key={img.localId}
            className="relative aspect-square rounded-lg border border-line bg-bg overflow-hidden"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.previewUrl}
              alt=""
              className="w-full h-full object-cover"
            />
            {img.uploading && (
              <div className="absolute inset-0 bg-bg/60 flex items-center justify-center text-xs text-ink-soft">
                Téléversement…
              </div>
            )}
            {img.error && (
              <div
                className="absolute inset-0 bg-bad/20 flex items-center justify-center text-xs text-bad px-1 text-center"
                title={img.error}
              >
                Échec
              </div>
            )}
            <button
              type="button"
              onClick={() => onRemove(img.localId)}
              aria-label="Retirer l'image"
              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-bg/80 border border-line text-ink hover:text-bad hover:border-bad/40 transition flex items-center justify-center text-base leading-none"
            >
              ×
            </button>
          </div>
        ))}
        {canAddMore && (
          <label className="aspect-square rounded-lg border border-dashed border-line hover:border-accent/40 hover:text-accent cursor-pointer flex items-center justify-center text-xs text-ink-soft transition">
            + Ajouter
            <input
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(",")}
              multiple
              className="sr-only"
              onChange={(e) => {
                onAdd(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
      {images.length === 0 && (
        <p className="mt-2 text-xs text-ink-mute">
          Au moins une image est requise — sans image, le produit n’apparaîtra pas dans le catalogue.
        </p>
      )}
    </div>
  );
}

function autoSku(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "item";
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${slug}-${suffix}`;
}

function Field({
  label,
  name,
  required,
  maxLength,
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  required?: boolean;
  maxLength?: number;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <label className="text-sm">
      <span className="block text-ink-soft mb-1">{label}</span>
      <input
        name={name}
        required={required}
        maxLength={maxLength}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-ink focus:border-accent/60 outline-none"
      />
    </label>
  );
}
