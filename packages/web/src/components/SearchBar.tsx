"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export function SearchBar() {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");

  useEffect(() => { setValue(params.get("q") ?? ""); }, [params]);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const sp = new URLSearchParams(params.toString());
    if (value.trim()) sp.set("q", value.trim()); else sp.delete("q");
    sp.delete("cursor");
    router.push(`/search?${sp.toString()}`);
  }

  return (
    <form onSubmit={submit} role="search" className="relative" action="/search" method="get">
      <input
        type="search"
        name="q"
        placeholder="Search products, brands, categories…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        enterKeyHint="search"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="w-full h-10 pl-10 pr-12 rounded-xl bg-bg-soft/80 border border-line text-sm placeholder:text-ink-mute focus:border-accent focus:bg-bg-elev transition"
        aria-label="Search marketplace"
      />
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-mute" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
      </svg>
      <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono text-ink-mute border border-line rounded">↵</kbd>
    </form>
  );
}
