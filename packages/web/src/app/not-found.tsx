import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className="py-32 text-center">
      <p className="text-xs uppercase tracking-widest text-ink-mute font-semibold mb-3">404</p>
      <h1 className="text-3xl font-semibold tracking-tight mb-2">That page is empty.</h1>
      <p className="text-ink-soft max-w-md mx-auto">The product or page you were looking for is no longer listed, or it never was.</p>
      <Link href="/search" className="inline-flex mt-6 h-10 px-4 items-center rounded-md bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition">
        Back to catalog
      </Link>
    </div>
  );
}
