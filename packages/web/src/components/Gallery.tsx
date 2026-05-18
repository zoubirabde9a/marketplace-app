"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import clsx from "clsx";

interface Img { id: string; url: string; altText?: string; width?: number; height?: number }

export function Gallery({ images, alt, brand }: { images: Img[]; alt: string; brand?: string }) {
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const active = images[idx];
  const touchStartX = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null || images.length < 2) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
    touchStartX.current = null;
    // 40px threshold avoids treating tiny taps/drags as swipes.
    if (Math.abs(dx) < 40) return;
    if (dx < 0) setIdx((i) => (i + 1) % images.length);
    else setIdx((i) => (i - 1 + images.length) % images.length);
  };

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowRight") setIdx((i) => (i + 1) % images.length);
      if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + images.length) % images.length);
    }
    window.addEventListener("keydown", onKey);
    // Lock background scroll while the lightbox is open so the underlying
    // page can't drift behind the overlay (especially on mobile).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, images.length]);

  if (!images.length) {
    const initial = (brand ?? alt).trim().charAt(0).toUpperCase() || "·";
    return (
      <div className="aspect-square rounded-2xl border border-line-soft bg-gradient-to-br from-bg-elev via-bg-soft to-bg flex flex-col items-center justify-center gap-3 text-ink-mute">
        <span aria-hidden className="text-7xl font-semibold tracking-tight text-ink-mute select-none opacity-50">
          {initial}
        </span>
        <span className="text-xs">Aucune photo fournie par le vendeur</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => setOpen(true)}
        className="block w-full aspect-square rounded-2xl border border-line-soft bg-bg-soft overflow-hidden group relative"
        aria-label="Ouvrir l'image en plein écran"
      >
        {/* Product-detail hero. priority emits <link rel="preload"> in <head>
            so the browser starts the AVIF/WebP fetch before parsing past
            the HTML. sizes hints the optimizer: full viewport on mobile,
            half on tablet, then a fixed max (the gallery is capped by the
            product page's two-column grid at lg breakpoints). */}
        <Image
          src={active!.url}
          alt={active!.altText ?? alt}
          width={active!.width ?? 800}
          height={active!.height ?? 800}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 60vw, 600px"
          priority
          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
        />
        <span className="absolute bottom-3 right-3 px-2 py-1 rounded-md text-[11px] font-mono bg-bg/80 text-ink-soft border border-line-soft opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition">
          Agrandir
        </span>
      </button>
      {images.length > 1 && (
        <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
          {images.map((img, i) => (
            <button
              key={img.id}
              onClick={() => setIdx(i)}
              aria-label={`Image ${i + 1} sur ${images.length}`}
              aria-current={i === idx ? "true" : undefined}
              className={clsx(
                "aspect-square rounded-lg overflow-hidden border transition",
                i === idx ? "border-accent shadow-glow" : "border-line-soft hover:border-line",
              )}
            >
              {/* Thumbnail strip — small images so the optimizer emits a
                  tight AVIF/WebP. sizes is fixed at the thumbnail's
                  rendered width (5 or 6 cols of the gallery width). */}
              <Image src={img.url} alt={img.altText ?? `${alt} — vignette ${i + 1}`} width={img.width ?? 200} height={img.height ?? 200} sizes="120px" loading="lazy" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-up touch-pan-y"
          onClick={() => setOpen(false)}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          role="dialog"
          aria-modal="true"
        >
          <button
            className="absolute top-4 right-4 w-11 h-11 rounded-full bg-bg-elev/80 border border-line text-ink hover:bg-bg-elev"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            aria-label="Fermer"
          >
            ✕
          </button>
          {images.length > 1 && (
            <>
              <button
                className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-bg-elev/80 border border-line text-xl"
                onClick={(e) => { e.stopPropagation(); setIdx((i) => (i - 1 + images.length) % images.length); }}
                aria-label="Image précédente"
              >‹</button>
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-bg-elev/80 border border-line text-xl"
                onClick={(e) => { e.stopPropagation(); setIdx((i) => (i + 1) % images.length); }}
                aria-label="Image suivante"
              >›</button>
            </>
          )}
          {/* Lightbox full-resolution view. Don't constrain via fixed
              width/height — let the optimizer pick a size that fits the
              viewport. unoptimized={false} (default) still routes through
              the Next image proxy for AVIF/WebP transcoding. */}
          <Image
            src={active!.url}
            alt={active!.altText ?? alt}
            width={active!.width ?? 1600}
            height={active!.height ?? 1600}
            sizes="100vw"
            className="max-w-full max-h-full object-contain rounded-lg w-auto h-auto"
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
