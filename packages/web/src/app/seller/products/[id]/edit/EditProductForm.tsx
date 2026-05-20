"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FR_CATEGORY } from "@/lib/categories";
import { formatPrice } from "@/lib/format";

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
  // Kept on the row so a failed upload can be retried with the same file
  // instead of asking the seller to re-pick it.
  file: File;
  previewUrl: string;
  error?: string;
}

export function EditProductForm({ initial }: { initial: EditableProduct }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [savingFields, startFieldSave] = useTransition();
  const [images, setImages] = useState<ImageRow[]>(initial.images.map((m) => ({ id: m.id, url: m.url })));
  const [uploading, setUploading] = useState<UploadingRow[]>([]);
  const [descriptionLen, setDescriptionLen] = useState(initial.description.length);
  const [inStock, setInStock] = useState<boolean>(initial.variants[0]?.inStock ?? true);
  const [isDragging, setIsDragging] = useState(false);

  // Auto-dismiss the success indicator with useEffect cleanup — if the
  // seller navigates away mid-wait, the timer cancels instead of firing
  // setState on an unmounted component (harmless but noisy in dev).
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(false), 2500);
    return () => clearTimeout(t);
  }, [success]);

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
      accepted.push({ localId, file: f, previewUrl: URL.createObjectURL(f) });
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

  // Retry a previously-failed in-flight upload — clear the error, kick
  // off a fresh attach with the same File the seller already picked.
  function retryUploading(localId: string): void {
    const target = uploading.find((r) => r.localId === localId);
    if (!target || !target.error) return;
    setUploading((prev) =>
      prev.map((r) => (r.localId === localId ? { ...r, error: undefined } : r)),
    );
    void uploadAndAttach(target.file, localId);
  }

  async function removeImage(mediaId: string): Promise<void> {
    setError(null);
    if (images.length <= 1) {
      setError("Impossible de retirer la dernière image. Ajoutez-en une nouvelle d’abord.");
      return;
    }
    setImages((prev) => prev.map((r) => (r.id === mediaId ? { ...r, removing: true } : r)));
    let res: Response;
    try {
      res = await fetch(
        `/api/seller/products/${encodeURIComponent(initial.productId)}/media/${encodeURIComponent(mediaId)}`,
        { method: "DELETE" },
      );
    } catch {
      // Network-layer failure — without this catch the image stayed
      // stuck on "Suppression…" forever and the seller had no signal.
      setError("Connexion impossible. Vérifiez votre réseau et réessayez.");
      setImages((prev) => prev.map((r) => (r.id === mediaId ? { ...r, removing: false } : r)));
      return;
    }
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
          // Preserve any extra categories beyond the first — the form's
          // single-select UI only exposes the primary, so a bare
          // `[category]` payload silently strips the trailing entries on
          // multi-category products. When the seller clears the primary
          // (selects "— Aucune —") we treat that as "no category at all"
          // since the UI has no way to express partial clearing.
          if (category) {
            payload.categoryIds = [category, ...initial.categoryIds.slice(1)];
          } else {
            payload.categoryIds = [];
          }
          // Update the price of the first variant in place. Multi-variant
          // editing isn't surfaced yet — when it is, this will become a list.
          if (v0) {
            payload.variants = [
              {
                sku: v0.sku,
                priceMinor,
                currency: v0.currency,
                inStock,
              },
            ];
          }
          let r: Response;
          try {
            r = await fetch(`/api/seller/products/${encodeURIComponent(initial.productId)}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            });
          } catch {
            // Network-layer failure (offline, DNS, CORS) — fetch throws
            // before any response. Surface a clear message instead of
            // leaving the seller staring at a snapped-back idle button.
            setError("Connexion impossible. Vérifiez votre réseau et réessayez.");
            return;
          }
          if (!r.ok) {
            const j = (await r.json().catch(() => ({}))) as { error?: string; detail?: string };
            setError(j.detail || j.error || `Échec (HTTP ${r.status})`);
            return;
          }
          router.refresh();
          // Transient success indicator — auto-dismiss handled by the
          // success useEffect above so the timer is cleaned up if the
          // component unmounts mid-wait.
          setSuccess(true);
        });
      }}
      className="grid gap-4"
      lang="fr"
    >
      <div
        className="text-sm"
        // Drag-and-drop: desktop sellers can drop images straight from
        // their file explorer. Mobile sellers see no difference.
        onDragOver={(e) => {
          e.preventDefault();
          if (images.length + uploading.length >= MAX_IMAGES) return;
          if (!isDragging) setIsDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setIsDragging(false);
        }}
        onDrop={(e) => {
          // Always preventDefault + let addFiles surface the cap error
          // rather than silently dropping the gesture (mirrors the new-
          // product form path).
          e.preventDefault();
          setIsDragging(false);
          if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
        }}
      >
        <span className="block text-ink-soft mb-1">
          Images <span className="text-ink-mute">({images.length + uploading.length}/{MAX_IMAGES}, JPG/PNG/WEBP/AVIF/GIF)</span>
        </span>
        <div
          className={
            "grid grid-cols-3 sm:grid-cols-4 gap-3 rounded-lg transition " +
            (isDragging ? "ring-2 ring-accent/60 ring-offset-2 ring-offset-bg" : "")
          }
        >
          {images.map((img, idx) => (
            <div key={img.id} className="relative aspect-square rounded-lg border border-line bg-bg overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="" className="w-full h-full object-cover" />
              {/* "Couverture" badge marks the hero image — same rendering
                  as NewProductForm so sellers recognise it across the
                  create/edit boundary. */}
              {idx === 0 && (
                <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider bg-accent text-bg font-medium">
                  Couverture
                </span>
              )}
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
                className="absolute top-1 right-1 w-8 h-8 sm:w-6 sm:h-6 rounded-full bg-bg/80 border border-line text-ink hover:text-bad hover:border-bad/40 active:text-bad active:border-bad/40 transition flex items-center justify-center text-base leading-none disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ×
              </button>
            </div>
          ))}
          {uploading.map((r) => (
            <div key={r.localId} className="relative aspect-square rounded-lg border border-line bg-bg overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.previewUrl} alt="" className="w-full h-full object-cover opacity-60" />
              {r.error ? (
                <>
                  <button
                    type="button"
                    onClick={() => retryUploading(r.localId)}
                    title={r.error}
                    aria-label={`Réessayer le téléversement : ${r.error}`}
                    className="absolute inset-0 bg-bad/20 hover:bg-bad/30 active:bg-bad/30 flex flex-col items-center justify-center gap-0.5 text-xs text-bad px-1 text-center transition cursor-pointer"
                  >
                    <span className="font-medium">Échec</span>
                    <span className="text-[10px] underline-offset-2 underline">Réessayer</span>
                  </button>
                  {/* Dismiss/abandon button — gives the seller an exit
                      when a file simply won't upload (corrupt, blocked). */}
                  <button
                    type="button"
                    onClick={() => {
                      URL.revokeObjectURL(r.previewUrl);
                      setUploading((prev) => prev.filter((x) => x.localId !== r.localId));
                    }}
                    aria-label="Retirer l’image en échec"
                    className="absolute top-1 right-1 w-8 h-8 sm:w-6 sm:h-6 rounded-full bg-bg/80 border border-line text-ink hover:text-bad hover:border-bad/40 active:text-bad active:border-bad/40 transition flex items-center justify-center text-base leading-none"
                  >
                    ×
                  </button>
                </>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-ink-soft">
                  Téléversement…
                </div>
              )}
            </div>
          ))}
          {images.length + uploading.length < MAX_IMAGES && (
            <label className="aspect-square rounded-lg border border-dashed border-line hover:border-accent/40 hover:text-accent active:border-accent/40 active:text-accent cursor-pointer flex items-center justify-center text-xs text-ink-soft transition">
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

      {/* Multi-variant heads-up — the form only exposes v0's price + SKU,
          so editing a multi-variant listing silently only touches the
          primary variant. Surface this upfront so sellers expecting to
          re-price "the product" know they need the API for the rest. */}
      {initial.variants.length > 1 && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          Ce produit a {initial.variants.length} variantes — seule la première
          (prix + disponibilité) est modifiable ici.{" "}
          <a
            href={`mailto:mahlledz@gmail.com?subject=${encodeURIComponent(
              `Modification multi-variantes : ${initial.title}`,
            )}&body=${encodeURIComponent(
              `Bonjour,\n\nJe souhaite modifier les variantes du produit ci-dessus (${initial.variants.length} variantes au total). Voici les modifications souhaitées :\n\n`,
            )}`}
            className="underline hover:no-underline active:no-underline"
          >
            Contactez-nous
          </a>{" "}
          pour modifier les autres variantes.
        </div>
      )}
      {/* Title placeholder mirrors the new-product form's example. Only
          visible if the seller has cleared the existing title — but the
          example then guides them back to a search-friendly shape. */}
      <Field label="Titre" name="title" required maxLength={300} defaultValue={initial.title} placeholder="iPhone 13 Pro 256 Go — Comme neuf, garantie 6 mois" />
      {/* Placeholder shows when the seller clears the brand — matches the
          new-product form so the guidance is consistent across surfaces. */}
      <Field label="Marque" name="brand" maxLength={120} defaultValue={initial.brand} placeholder="Apple, Samsung, Xiaomi…" />
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
          defaultValue={initial.description}
          onChange={(e) => setDescriptionLen(e.target.value.length)}
          placeholder="État, accessoires inclus, garantie, défauts éventuels, ville de livraison — plus c’est précis, moins l’acheteur pose de questions."
          className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-base sm:text-sm text-ink focus:border-accent/60 outline-none placeholder:text-ink-mute"
        />
      </label>
      <label className="text-sm">
        <span className="block text-ink-soft mb-1">Catégorie</span>
        {/* If the product's current category isn't in the curated list,
            inject it as an extra option so saving doesn't silently strip
            it. Without this guard, products tagged with niche categories
            (santé, services, immobilier, etc.) lost their category on
            first save through this form. */}
        {(() => {
          const current = initial.categoryIds[0] ?? "";
          const inCurated = SELLER_CATEGORIES.some((c) => c.slug === current);
          return (
            <select
              name="category"
              defaultValue={current}
              className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-base sm:text-sm text-ink focus:border-accent/60 outline-none"
            >
              <option value="">— Aucune —</option>
              {SELLER_CATEGORIES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.label}
                </option>
              ))}
              {current && !inCurated && (
                <option value={current}>
                  {FR_CATEGORY[current] ?? current}
                </option>
              )}
            </select>
          );
        })()}
      </label>
      <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <legend className="sr-only">Prix et SKU</legend>
        <PriceField defaultValue={priceMajor} currency={v0?.currency ?? "DZD"} />
        <div>
          <Field label="SKU" name="sku" defaultValue={v0?.sku} disabled />
          <p className="mt-1 text-xs text-ink-mute">Non modifiable — identifiant interne du produit.</p>
        </div>
      </fieldset>

      {/* Stock toggle — most common seller-edit op after price changes.
          Renders as a clearly tappable row, not a bare checkbox, so it
          works as a touch target on mobile. */}
      <label className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg/40 px-3 py-2.5 cursor-pointer hover:border-accent/40 transition">
        <span className="flex flex-col">
          <span className="text-sm text-ink">Disponible à la vente</span>
          <span id="instock-hint" className="text-xs text-ink-mute">
            {inStock
              ? "Visible et achetable par les acheteurs."
              : "Marqué en rupture — l’annonce reste visible mais ne peut pas être commandée."}
          </span>
        </span>
        <input
          type="checkbox"
          checked={inStock}
          onChange={(e) => setInStock(e.target.checked)}
          className="w-5 h-5 accent-accent shrink-0"
          aria-label="Disponible à la vente"
          aria-describedby="instock-hint"
        />
      </label>

      {error && (
        <p className="text-sm text-bad" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2 self-stretch sm:self-start">
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={savingFields}
            aria-busy={savingFields}
            className="inline-flex h-11 sm:h-10 px-4 items-center justify-center rounded-lg bg-accent text-bg font-medium hover:bg-accent-hover active:brightness-90 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {savingFields ? "Enregistrement…" : "Enregistrer"}
          </button>
          {success && (
            <span className="text-sm text-ok inline-flex items-center gap-1.5" role="status">
              <span aria-hidden>✓</span> Enregistré
            </span>
          )}
        </div>
        {/* Surface failed-upload count near save so sellers don't think
            all queued images attached. The per-tile "Réessayer" overlay
            is still the action; this is just a heads-up summary. */}
        {(() => {
          const failedCount = uploading.filter((r) => r.error).length;
          if (failedCount === 0) return null;
          return (
            <p className="text-xs text-warn">
              {failedCount === 1
                ? "1 image n’a pas pu être téléversée — elle n’a pas été ajoutée au produit."
                : `${failedCount} images n’ont pas pu être téléversées — elles n’ont pas été ajoutées au produit.`}
            </p>
          );
        })()}
      </div>
    </form>
  );
}

// Price field with mobile numeric keypad and live formatted preview. Mirrors
// the NewProductForm version; sellers re-pricing a listing get the same
// "29 999,00 DA" confirmation they see on creation.
function PriceField({ defaultValue, currency = "DZD" }: { defaultValue?: string; currency?: string }) {
  const [raw, setRaw] = useState(defaultValue ?? "");
  const trimmed = raw.trim();
  const valid = /^\d+(\.\d{1,2})?$/.test(trimmed);
  let preview: string | null = null;
  if (valid) {
    const [whole, frac = ""] = trimmed.split(".");
    const minor = `${whole}${frac.padEnd(2, "0").slice(0, 2)}`.replace(/^0+(?=\d)/, "");
    preview = formatPrice(minor, currency, "fr-DZ");
  }
  return (
    <label className="text-sm">
      <span className="block text-ink-soft mb-1">Prix ({currency})</span>
      <input
        name="priceMajor"
        required
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        inputMode="decimal"
        autoComplete="off"
        className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-base sm:text-sm text-ink focus:border-accent/60 outline-none tabular-nums"
      />
      <span
        aria-live="polite"
        className={"mt-1 block text-xs tabular-nums " + (preview ? "text-ink-soft" : "text-ink-mute")}
      >
        {preview ?? (trimmed === "" ? " " : "Format invalide")}
      </span>
    </label>
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
        aria-required={required || undefined}
        maxLength={maxLength}
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        dir="auto"
        className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-base sm:text-sm text-ink focus:border-accent/60 outline-none disabled:opacity-60"
      />
    </label>
  );
}
