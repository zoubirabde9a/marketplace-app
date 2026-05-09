"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";

interface Img { id: string; url: string; altText?: string }

export function Gallery({ images, alt }: { images: Img[]; alt: string }) {
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const active = images[idx];

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowRight") setIdx((i) => (i + 1) % images.length);
      if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + images.length) % images.length);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, images.length]);

  if (!images.length) {
    return (
      <div className="aspect-square rounded-2xl border border-line-soft bg-gradient-to-br from-bg-elev via-bg-soft to-bg flex flex-col items-center justify-center gap-3 text-ink-mute">
        <svg className="w-16 h-16 opacity-40" fill="none" stroke="currentColor" strokeWidth={1.2} viewBox="0 0 24 24" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
        <span className="text-xs">No photos provided by the seller</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => setOpen(true)}
        className="block w-full aspect-square rounded-2xl border border-line-soft bg-bg-soft overflow-hidden group relative"
        aria-label="Open image fullscreen"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={active!.url}
          alt={active!.altText ?? alt}
          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
        />
        <span className="absolute bottom-3 right-3 px-2 py-1 rounded-md text-[11px] font-mono bg-bg/80 text-ink-soft border border-line-soft opacity-0 group-hover:opacity-100 transition">
          Click to expand
        </span>
      </button>
      {images.length > 1 && (
        <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
          {images.map((img, i) => (
            <button
              key={img.id}
              onClick={() => setIdx(i)}
              aria-label={`Image ${i + 1} of ${images.length}`}
              className={clsx(
                "aspect-square rounded-lg overflow-hidden border transition",
                i === idx ? "border-accent shadow-glow" : "border-line-soft hover:border-line",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.altText ?? `${alt} thumbnail ${i + 1}`} className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-up"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <button
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-bg-elev/80 border border-line text-ink hover:bg-bg-elev"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            aria-label="Close"
          >
            ✕
          </button>
          {images.length > 1 && (
            <>
              <button
                className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-bg-elev/80 border border-line text-xl"
                onClick={(e) => { e.stopPropagation(); setIdx((i) => (i - 1 + images.length) % images.length); }}
                aria-label="Previous image"
              >‹</button>
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-bg-elev/80 border border-line text-xl"
                onClick={(e) => { e.stopPropagation(); setIdx((i) => (i + 1) % images.length); }}
                aria-label="Next image"
              >›</button>
            </>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={active!.url}
            alt={active!.altText ?? alt}
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-ink-soft font-mono">
            {idx + 1} / {images.length}
          </span>
        </div>
      )}
    </div>
  );
}
