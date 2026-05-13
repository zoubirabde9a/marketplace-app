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
            }),
          });
          if (!r.ok) {
            const j = (await r.json().catch(() => ({}))) as { error?: string; detail?: string };
            setError(j.detail || j.error || `Échec (HTTP ${r.status})`);
            return;
          }
          // Land back on the dashboard so the seller sees their freshly-created
          // product in the list. Previously redirected to the edit page, but
          // that page is currently read-only and felt like a dead-end.
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
        disabled={pending}
        className="self-start inline-flex h-10 px-4 items-center rounded-lg bg-accent text-bg font-medium hover:bg-accent-hover transition disabled:opacity-60"
      >
        {pending ? "Création…" : "Créer le produit"}
      </button>
    </form>
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
