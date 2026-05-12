"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

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
        const sku = String(f.get("sku") ?? "").trim();
        const priceMajor = String(f.get("priceMajor") ?? "").trim();
        // DZD is the catalog default — virtually all live listings are in
        // Algerian dinars. Sellers were defaulting to USD and shipping
        // mis-priced listings before noticing. Operator can still type any
        // other ISO code.
        const currency = String(f.get("currency") ?? "DZD").trim().toUpperCase();

        if (!title) return setError("Le titre est obligatoire.");
        if (!sku) return setError("Le SKU est obligatoire.");
        if (!/^\d+(\.\d{1,2})?$/.test(priceMajor)) {
          return setError("Le prix doit être un nombre positif avec au plus 2 décimales.");
        }
        if (!/^[A-Z]{3}$/.test(currency)) {
          return setError("La devise doit être un code ISO de 3 lettres (ex. DZD).");
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
          const j = (await r.json()) as { ok: true; product: { productId: string } };
          router.push(`/seller/products/${encodeURIComponent(j.product.productId)}/edit`);
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
      <Field label="Catégorie" name="category" placeholder="ex. telephones" />
      <fieldset className="grid grid-cols-3 gap-3">
        <legend className="text-sm text-ink-soft mb-1 col-span-3">Variante initiale</legend>
        <Field label="SKU" name="sku" required maxLength={64} />
        <Field label="Prix" name="priceMajor" required placeholder="29999.00" />
        <Field label="Devise" name="currency" defaultValue="DZD" maxLength={3} />
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
