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
        const currency = String(f.get("currency") ?? "USD").trim().toUpperCase();

        if (!title) return setError("Title is required.");
        if (!sku) return setError("SKU is required.");
        if (!/^\d+(\.\d{1,2})?$/.test(priceMajor)) {
          return setError("Price must be a positive number with up to 2 decimals.");
        }
        if (!/^[A-Z]{3}$/.test(currency)) {
          return setError("Currency must be a 3-letter ISO code (e.g. USD).");
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
            setError(j.detail || j.error || `Failed (HTTP ${r.status})`);
            return;
          }
          const j = (await r.json()) as { ok: true; product: { productId: string } };
          router.push(`/seller/products/${encodeURIComponent(j.product.productId)}/edit`);
        });
      }}
      className="grid gap-4"
    >
      {sellers.length > 1 ? (
        <label className="text-sm">
          <span className="block text-ink-soft mb-1">Seller</span>
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
      <Field label="Title" name="title" required maxLength={300} />
      <Field label="Brand" name="brand" maxLength={120} />
      <label className="text-sm">
        <span className="block text-ink-soft mb-1">Description</span>
        <textarea
          name="description"
          maxLength={5000}
          rows={4}
          className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-ink focus:border-accent/60 outline-none"
        />
      </label>
      <Field label="Category" name="category" placeholder="e.g. tools" />
      <fieldset className="grid grid-cols-3 gap-3">
        <legend className="text-sm text-ink-soft mb-1 col-span-3">Initial variant</legend>
        <Field label="SKU" name="sku" required maxLength={64} />
        <Field label="Price" name="priceMajor" required placeholder="29.99" />
        <Field label="Currency" name="currency" defaultValue="USD" maxLength={3} />
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
        {pending ? "Creating…" : "Create product"}
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
