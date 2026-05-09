"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  sellerId: string;
  initial: { phone: string; whatsapp: string; website: string };
}

export function ContactForm({ sellerId, initial }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const phone = String(f.get("phone") ?? "").trim();
        const whatsapp = String(f.get("whatsapp") ?? "").trim();
        const website = String(f.get("website") ?? "").trim();
        // null => clear, string => set, omit (undefined) => leave unchanged.
        // We always send all three so users can clear fields by emptying them.
        const patch = {
          phone: phone === "" ? null : phone,
          whatsapp: whatsapp === "" ? null : whatsapp,
          website: website === "" ? null : website,
        };
        setError(null);
        setSuccess(null);
        start(async () => {
          const r = await fetch(`/api/seller/sellers/${encodeURIComponent(sellerId)}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(patch),
          });
          if (!r.ok) {
            const j = (await r.json().catch(() => ({}))) as {
              error?: string;
              detail?: string;
            };
            setError(j.detail || j.error || `Failed (HTTP ${r.status})`);
            return;
          }
          setSuccess("Saved.");
          router.refresh();
        });
      }}
      className="grid gap-4"
    >
      <Field label="Phone" name="phone" defaultValue={initial.phone} placeholder="+1 555 123 4567" />
      <Field label="WhatsApp" name="whatsapp" defaultValue={initial.whatsapp} placeholder="+15551234567" />
      <Field label="Website" name="website" defaultValue={initial.website} placeholder="https://example.com" type="url" />
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      {success && <p className="text-sm text-ok">{success}</p>}
      <button
        type="submit"
        disabled={pending}
        className="self-start inline-flex h-10 px-4 items-center rounded-lg bg-accent text-bg font-medium hover:bg-accent-hover transition disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="text-sm">
      <span className="block text-ink-soft mb-1">{label}</span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-ink focus:border-accent/60 outline-none"
      />
    </label>
  );
}
