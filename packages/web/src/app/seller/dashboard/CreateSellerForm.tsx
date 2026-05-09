"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function CreateSellerForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const displayName = String(data.get("displayName") ?? "").trim();
        if (!displayName) {
          setError("Display name is required.");
          return;
        }
        setError(null);
        startTransition(async () => {
          const r = await fetch("/api/seller/sellers", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ displayName }),
          });
          if (!r.ok) {
            const j = (await r.json().catch(() => ({}))) as { error?: string };
            setError(j.error ?? `Failed (HTTP ${r.status})`);
            return;
          }
          router.refresh();
        });
      }}
      className="flex flex-col gap-3 max-w-md"
    >
      <label className="text-sm">
        <span className="block text-ink-soft mb-1">Display name</span>
        <input
          name="displayName"
          required
          maxLength={120}
          className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-ink focus:border-accent/60 outline-none"
          placeholder="e.g. Acme Hardware"
        />
      </label>
      {error && <p className="text-sm text-bad">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="self-start inline-flex h-10 px-4 items-center rounded-lg bg-accent text-bg font-medium hover:bg-accent-hover transition disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create seller profile"}
      </button>
    </form>
  );
}
