"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function IncludeOutOfStockToggle() {
  const router = useRouter();
  const params = useSearchParams();
  const checked = params.get("includeOutOfStock") === "true";

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const sp = new URLSearchParams(params.toString());
    if (e.target.checked) sp.set("includeOutOfStock", "true");
    else sp.delete("includeOutOfStock");
    sp.delete("cursor");
    const qs = sp.toString();
    router.push(qs ? `/search?${qs}` : "/search");
  }

  return (
    <label className="inline-flex items-center gap-2 text-xs text-ink-mute cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-3.5 w-3.5 accent-accent"
      />
      <span>Include out of stock</span>
    </label>
  );
}
