"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FR_CATEGORY } from "@/lib/categories";

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

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];
const MAX_IMAGES = 8;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface EditableProduct {
  productId: string;
  title: string;
  description: string;
  brand: string;
  categoryIds: string[];
  variants: Array<{ id: string; sku: string; priceMinor: string; currency: string; inStock: boolean }>;
  images: Array<{ id: string; url: string; contentType: string }>;
}

interface ImageRow {
  /** Existing DB rows have `id`; freshly uploaded rows do too (returned by attach). */
  id: string;
  url: string;
  removing?: boolean;
}

interface UploadingRow {
  localId: string;
  previewUrl: string;
  error?: string;
}

export function EditProductForm({ initial }: { initial: EditableProduct }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [savingFields, startFieldSave] = useTransition();
  const [images, setImages] = useState<ImageRow[]>(initial.images.map((m) => ({ id: m.id, url: m.url })));
  const [uploading, setUploading] = useState<UploadingRow[]>([]);

  const v0 = initial.variants[0];
  const priceMajor = v0 ? minorToMajor(v0.priceMinor) : "";

  function addFiles(files: FileList | null): void {
    if (!files) return;
    setError(null);
    const slotsLeft = MAX_IMAGES - images.length - uploading.length;
    const accepted: UploadingRow[] = [];
    for (const f of Array.from(files)) {
      if (accepted.length >= slotsLeft) {
        setError(`Maximum ${MAX_IMAGES} images.`);
        break;
      }
      if (!ACCEPTED_IMAGE_TYPES.includes(f.type)) {
        setError(`Format non supporté : ${f.name}.`);
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        setError(`Trop volumineux (max 10 Mo) : ${f.name}.`);
        continue;
      }
      const localId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      accepted.push({ localId, previewUrl: URL.createObjectURL(f) });
      void uploadAndAttach(f, localId);
    }
    if (accepted.length > 0) setUploading((prev) => [...prev, ...accepted]);
  }

  async function uploadAndAttach(file: File, localId: string): Promise<void> {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const upRes = await fetch("/api/seller/media", { method: "POST", body: fd });
      if (!upRes.ok) {
        const j = (await upRes.json().catch(() => ({}))) as { detail?: string; error?: string };
        throw new Error(j.detail || j.error || `HTTP ${upRes.status}`);
      }
      const uploaded = (await upRes.json()) as { url: string; contentType: string; byteSize: number };
      const attachRes = await fetch(`/api/seller/products/${encodeURIComponent(initial.productId)}/media`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(uploaded),
      });
      if (!attachRes.ok) {
        const j = (await attachRes.json().catch(() => ({}))) as { detail?: string; error?: string };
        throw new Error(j.detail || j.error || `HTTP ${attachRes.status}`);
      }
      const wrap = (await attachRes.json()) as { ok: boolean; media: { id: string; url: string } };
      setImages((prev) => [...prev, { id: wrap.media.id, url: wrap.media.url }]);
      setUploading((prev) => {
        const row = prev.find((r) => r.localId === localId);
        if (row) URL.revokeObjectURL(row.previewUrl);
        return prev.filter((r) => r.localId !== localId);
      });
    } catch (e) {
      setUploading((prev) =>
        prev.map((r) => (r.localId === localId ? { ...r, error: (e as Error).message } : r)),
      );
    }
  }

  async function removeImage(mediaId: string): Promise<void> {
    setError(null);
    if (images.length <= 1) {
      setError("Impossible de retirer la dernière image. Ajoutez-en une nouvelle d’abord.");
      return;
    }
    setImages((prev) => prev.map((r) => (r.id === mediaId ? { ...r, removing: true } : r)));
    const res = await fetch(
      `/api/seller/products/${encodeURIComponent(initial.productId)}/media/${encodeURIComponent(mediaId)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
      setError(j.detail || j.error || `Échec (HTTP ${res.status})`);
      setImages((prev) => prev.map((r) => (r.id === mediaId ? { ...r, removing: false } : r)));
      return;
    }
    setImages((prev) => prev.filter((r) => r.id !== mediaId));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const title = String(f.get("title") ?? "").trim();
        const brand = String(f.get("brand") ?? "").trim();
        const description = String(f.get("description") ?? "").trim();
        const category = String(f.get("category") ?? "").trim();
        const priceMajor = String(f.get("priceMajor") ?? "").trim();
        if (!title) return setError("Le titre est obligatoire.");
        if (!/^\d+(\.\d{1,2})?$/.test(priceMajor)) {
          return setError("Le prix doit être un nombre positif avec au plus 2 décimales.");
        }
        const [whole, frac = ""] = priceMajor.split(".");
        const priceMinor = `${whole}${frac.padEnd(2, "0").slice(0, 2)}`.replace(/^0+(?=\d)/, "");
        setError(null);
        startFieldSave(async () => {
          // The PATCH body uses null to clear optional fields; "" → omit
          // makes it impossible to set a description back to empty once
          // it's been set. Send null when the field has been cleared.
          const payload: Record<string, unknown> = {
            title,
            description: description === "" ? null : description,
            brand: brand === "" ? null : brand,
          };
          if (category) payload.categoryIds = [category];
          else payload.categoryIds = [];
          // Update the price of the first variant in place. Multi-variant
          // editing isn't surfaced yet — when it is, this will become a list.
          if (v0) {
            payload.variants = [
              {
                sku: v0.sku,
                priceMinor,
                currency: v0.currency,
                inStock: v0.inStock,
              },
            ];
          }
          const r = await fetch(`/api/seller/products/${encodeURIComponent(initial.productId)}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!r.ok) {
            const j = (await r.json().catch(() => ({}))) as { error?: string; detail?: string };
            setError(j.detail || j.error || `Échec (HTTP ${r.status})`);
            return;
          }
          router.refresh();
        });
      }}
      className="grid gap-4"
      lang="fr"
    >
      <div className="text-sm">
        <span className="block text-ink-soft mb-1">
          Images <span className="text-ink-mute">({images.length + uploading.length}/{MAX_IMAGES})</span>
        </span>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {images.map((img) => (
            <div key={img.id} className="relative aspect-square rounded-lg border border-line bg-bg overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="" className="w-full h-full object-cover" />
              {img.removing && (
                <div className="absolute inset-0 bg-bg/60 flex items-center justify-center text-xs text-ink-soft">
                  Suppression…
                </div>
              )}
              <button
                type="button"
                onClick={() => void removeImage(img.id)}
                disabled={img.removing}
                aria-label="Retirer l'image"
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-bg/80 border border-line text-ink hover:text-bad hover:border-bad/40 transition flex items-center justify-center text-base leading-none disabled:opacity-50"
              >
                ×
              </button>
            </div>
          ))}
          {uploading.map((r) => (
            <div key={r.localId} className="relative aspect-square rounded-lg border border-line bg-bg overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.previewUrl} alt="" className="w-full h-full object-cover opacity-60" />
              <div className="absolute inset-0 flex items-center justify-center text-xs text-ink-soft">
                {r.error ? (
                  <span className="text-bad text-center px-1" title={r.error}>Échec</span>
                ) : (
                  <span>Téléversement…</span>
                )}
              </div>
            </div>
          ))}
          {images.length + uploading.length < MAX_IMAGES && (
            <label className="aspect-square rounded-lg border border-dashed border-line hover:border-accent/40 hover:text-accent cursor-pointer flex items-center justify-center text-xs text-ink-soft transition">
              + Ajouter
              <input
                type="file"
                accept={ACCEPTED_IMAGE_TYPES.join(",")}
                multiple
                className="sr-only"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
      </div>

      <Field label="Titre" name="title" required maxLength={300} defaultValue={initial.title} />
      <Field label="Marque" name="brand" maxLength={120} defaultValue={initial.brand} />
      <label className="text-sm">
        <span className="block text-ink-soft mb-1">Description</span>
        <textarea
          name="description"
          maxLength={5000}
          rows={4}
          defaultValue={initial.description}
          className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-ink focus:border-accent/60 outline-none"
        />
      </label>
      <label className="text-sm">
        <span className="block text-ink-soft mb-1">Catégorie</span>
        <select
          name="category"
          defaultValue={initial.categoryIds[0] ?? ""}
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
        <Field label="Prix (DZD)" name="priceMajor" required defaultValue={priceMajor} />
        <Field label="SKU" name="sku" defaultValue={v0?.sku} disabled />
      </fieldset>

      {error && (
        <p className="text-sm text-bad" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={savingFields}
          className="inline-flex h-10 px-4 items-center rounded-lg bg-accent text-bg font-medium hover:bg-accent-hover transition disabled:opacity-60"
        >
          {savingFields ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}

function minorToMajor(minor: string): string {
  // Display 2dp prices as their major form. Currencies with other dp counts
  // aren't surfaced here; matches the corresponding logic in NewProductForm.
  const s = minor.replace(/^0+(?=\d)/, "");
  if (s.length <= 2) return `0.${s.padStart(2, "0")}`;
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

function Field({
  label,
  name,
  required,
  maxLength,
  defaultValue,
  placeholder,
  disabled,
}: {
  label: string;
  name: string;
  required?: boolean;
  maxLength?: number;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
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
        disabled={disabled}
        className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-ink focus:border-accent/60 outline-none disabled:opacity-60"
      />
    </label>
  );
}
