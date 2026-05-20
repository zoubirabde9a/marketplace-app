"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FR_CATEGORY } from "@/lib/categories";
import { formatPrice } from "@/lib/format";

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
  const [descriptionLen, setDescriptionLen] = useState(0);

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

  // Retry a previously-failed upload — flip its state back to uploading
  // (clearing the error) and dispatch a fresh uploadOne with the same
  // file the seller already picked. Beats forcing them to remove + re-pick.
  function retryUpload(localId: string): void {
    const target = images.find((x) => x.localId === localId);
    if (!target || target.uploaded || target.uploading) return;
    setImages((prev) =>
      prev.map((x) =>
        x.localId === localId
          ? { ...x, uploading: true, error: undefined }
          : x,
      ),
    );
    void uploadOne({ ...target, uploading: true, error: undefined });
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
          let r: Response;
          try {
            r = await fetch("/api/seller/products", {
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
          } catch {
            // Network-layer failure (offline, DNS, CORS) — fetch throws
            // before any response. Without this catch the rejection was
            // unhandled and the form snapped back to idle silently.
            setError("Connexion impossible. Vérifiez votre réseau et réessayez.");
            return;
          }
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
            className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-base sm:text-sm text-ink focus:border-accent/60 outline-none"
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
        onRetry={retryUpload}
      />

      {/* Concrete placeholder examples — sellers leaving the listing
          quality untouched ("phone", "iphone for sale") get poor search
          visibility. A worked example nudges them toward model + storage
          + condition without forcing a structured form. */}
      <Field
        label="Titre"
        name="title"
        required
        maxLength={300}
        placeholder="iPhone 13 Pro 256 Go — Comme neuf, garantie 6 mois"
      />
      <Field label="Marque" name="brand" maxLength={120} placeholder="Apple, Samsung, Xiaomi…" />
      <label className="text-sm">
        <span className="flex items-baseline justify-between mb-1">
          <span className="text-ink-soft">Description</span>
          <span
            className={
              "text-xs tabular-nums " +
              (descriptionLen > 4500 ? "text-warn" : "text-ink-mute")
            }
          >
            {descriptionLen}/5000
          </span>
        </span>
        <textarea
          name="description"
          maxLength={5000}
          rows={4}
          dir="auto"
          onChange={(e) => setDescriptionLen(e.target.value.length)}
          placeholder="État, accessoires inclus, garantie, défauts éventuels, ville de livraison — plus c’est précis, moins l’acheteur pose de questions."
          className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-base sm:text-sm text-ink focus:border-accent/60 outline-none placeholder:text-ink-mute"
        />
      </label>
      <label className="text-sm">
        <span className="block text-ink-soft mb-1">Catégorie</span>
        <select
          name="category"
          defaultValue=""
          className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-base sm:text-sm text-ink focus:border-accent/60 outline-none"
        >
          <option value="">— Aucune —</option>
          {SELLER_CATEGORIES.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <legend className="sr-only">Prix et SKU</legend>
        <PriceField />
        <Field label="SKU (optionnel)" name="sku" maxLength={64} placeholder="généré automatiquement" />
      </fieldset>
      {error && (
        <p className="text-sm text-bad" role="alert">
          {error}
        </p>
      )}
      {(() => {
        const uploading = images.some((x) => x.uploading);
        const hasReadyImage = images.some((x) => x.uploaded);
        const failedCount = images.filter((x) => x.error).length;
        // Disable + relabel for each state the seller can be in. Previously
        // a zero-image submit was caught only after click via setError —
        // making the button reflect the requirement up front avoids the
        // "click, see error, scroll up" round trip.
        const disabled = pending || uploading || !hasReadyImage;
        const label = pending
          ? "Création…"
          : uploading
          ? "Téléversement des images…"
          : !hasReadyImage
          ? "Ajoutez d’abord une image"
          : "Créer le produit";
        return (
          <div className="flex flex-col gap-2 self-stretch sm:self-start">
            <button
              type="submit"
              disabled={disabled}
              aria-busy={pending}
              className="self-stretch sm:self-start inline-flex h-11 sm:h-10 px-4 items-center justify-center rounded-lg bg-accent text-bg font-medium hover:bg-accent-hover active:brightness-90 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {label}
            </button>
            {/* Surface failed-upload count near submit so sellers don't
                publish thinking N images went through when N-k did.
                The per-tile "Échec / Réessayer" is still the action; this
                is just a heads-up summary co-located with the submit. */}
            {failedCount > 0 && !uploading && (
              <p className="text-xs text-warn">
                {failedCount === 1
                  ? "1 image n’a pas pu être téléversée — elle ne sera pas incluse."
                  : `${failedCount} images n’ont pas pu être téléversées — elles ne seront pas incluses.`}
              </p>
            )}
          </div>
        );
      })()}
    </form>
  );
}

function ImageUploader({
  images,
  onAdd,
  onRemove,
  onRetry,
}: {
  images: StagedImage[];
  onAdd: (files: FileList | null) => void;
  onRemove: (localId: string) => void;
  onRetry: (localId: string) => void;
}): React.ReactElement {
  const canAddMore = images.length < MAX_IMAGES;
  const [isDragging, setIsDragging] = useState(false);
  return (
    <div
      className="text-sm"
      // Drag-and-drop wrapper. Mobile sellers see no difference (no drag
      // events fire); desktop sellers can drop straight from their file
      // explorer instead of going through the file picker.
      onDragOver={(e) => {
        e.preventDefault();
        if (!canAddMore) return;
        if (!isDragging) setIsDragging(true);
      }}
      onDragLeave={(e) => {
        // currentTarget contains check avoids flicker as drag passes over
        // children — only un-highlight when leaving the wrapper itself.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setIsDragging(false);
      }}
      onDrop={(e) => {
        // Always preventDefault so the browser doesn't navigate to the
        // dropped file. Pass through to addFiles even when at the cap;
        // addFiles surfaces the "Maximum N images" error via setError
        // instead of dropping the gesture silently like the previous
        // early-return did.
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer?.files?.length) onAdd(e.dataTransfer.files);
      }}
    >
      <span className="block text-ink-soft mb-1">
        Images<span className="ml-1 text-ink-mute" aria-hidden>*</span>{" "}
        <span className="text-ink-mute">({images.length}/{MAX_IMAGES}, JPG/PNG/WEBP/AVIF/GIF)</span>
      </span>
      <div
        className={
          "grid grid-cols-3 sm:grid-cols-4 gap-3 rounded-lg transition " +
          (isDragging ? "ring-2 ring-accent/60 ring-offset-2 ring-offset-bg" : "")
        }
      >
        {images.map((img, idx) => (
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
            {/* "Couverture" badge marks the first image — the one that
                renders as the hero on /search, /store, /product. Without
                this, sellers can't tell which image they're actually
                promoting and end up with random first uploads as cover. */}
            {idx === 0 && (
              <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider bg-accent text-bg font-medium">
                Couverture
              </span>
            )}
            {img.uploading && (
              <div className="absolute inset-0 bg-bg/60 flex items-center justify-center text-xs text-ink-soft">
                Téléversement…
              </div>
            )}
            {img.error && (
              // Click-to-retry overlay — sellers previously had to remove
              // and re-add a failed upload; now a tap reuses the same file.
              <button
                type="button"
                onClick={() => onRetry(img.localId)}
                title={img.error}
                aria-label={`Réessayer le téléversement : ${img.error}`}
                className="absolute inset-0 bg-bad/20 hover:bg-bad/30 active:bg-bad/30 flex flex-col items-center justify-center gap-0.5 text-xs text-bad px-1 text-center transition cursor-pointer"
              >
                <span className="font-medium">Échec</span>
                <span className="text-[10px] underline-offset-2 underline">Réessayer</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onRemove(img.localId)}
              aria-label="Retirer l'image"
              className="absolute top-1 right-1 w-8 h-8 sm:w-6 sm:h-6 rounded-full bg-bg/80 border border-line text-ink hover:text-bad hover:border-bad/40 active:text-bad active:border-bad/40 transition flex items-center justify-center text-base leading-none"
            >
              ×
            </button>
          </div>
        ))}
        {canAddMore && (
          <label className="aspect-square rounded-lg border border-dashed border-line hover:border-accent/40 hover:text-accent active:border-accent/40 active:text-accent cursor-pointer flex items-center justify-center text-xs text-ink-soft transition">
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
      {images.length === 0 ? (
        <p className="mt-2 text-xs text-ink-mute">
          Au moins une image est requise — sans image, le produit n’apparaîtra pas dans le catalogue.
        </p>
      ) : images.length < 3 && images.length < MAX_IMAGES ? (
        // Nudge sellers toward multiple angles once they've cleared the
        // 1-image minimum but are still under-stocked. Listings with 3+
        // photos convert better; sellers commonly stop at 1.
        <p className="mt-2 text-xs text-ink-mute">
          Ajoutez plusieurs angles (face, dos, accessoires) pour rassurer l’acheteur — jusqu’à {MAX_IMAGES} photos.
        </p>
      ) : null}
    </div>
  );
}

// Price field with mobile numeric keypad (inputMode="decimal") and a live
// formatted preview below ("29 999,00 DA"). Catches missing-digit typos that
// are easy to make when typing five- to six-figure DZD prices on a phone.
function PriceField({ defaultValue }: { defaultValue?: string } = {}) {
  const [raw, setRaw] = useState(defaultValue ?? "");
  const trimmed = raw.trim();
  const valid = /^\d+(\.\d{1,2})?$/.test(trimmed);
  let preview: string | null = null;
  if (valid) {
    const [whole, frac = ""] = trimmed.split(".");
    const minor = `${whole}${frac.padEnd(2, "0").slice(0, 2)}`.replace(/^0+(?=\d)/, "");
    preview = formatPrice(minor, "DZD", "fr-DZ");
  }
  return (
    <label className="text-sm">
      <span className="block text-ink-soft mb-1">
        Prix (DZD)<span className="ml-1 text-ink-mute" aria-hidden>*</span>
      </span>
      <input
        name="priceMajor"
        required
        aria-required="true"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        inputMode="decimal"
        autoComplete="off"
        placeholder="29999"
        className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-base sm:text-sm text-ink focus:border-accent/60 outline-none tabular-nums"
      />
      <span
        aria-live="polite"
        className={"mt-1 block text-xs tabular-nums " + (preview ? "text-ink-soft" : "text-ink-mute")}
      >
        {preview ?? (trimmed === "" ? " " : "Format invalide")}
      </span>
    </label>
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
      <span className="block text-ink-soft mb-1">
        {label}
        {required && (
          <span className="ml-1 text-ink-mute" aria-hidden>
            *
          </span>
        )}
      </span>
      <input
        name={name}
        required={required}
        maxLength={maxLength}
        defaultValue={defaultValue}
        placeholder={placeholder}
        dir="auto"
        aria-required={required || undefined}
        className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-base sm:text-sm text-ink focus:border-accent/60 outline-none"
      />
    </label>
  );
}
