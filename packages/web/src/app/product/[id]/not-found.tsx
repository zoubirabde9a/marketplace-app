import type { Metadata } from "next";
import Link from "next/link";

// Next 15 streams the response head before notFound() can set a 404 status,
// so this UI is currently served with HTTP 200 — a soft-404 in Google's eyes.
// Until that's resolved upstream, a hard noindex keeps crawlers from indexing
// the placeholder page.
export const metadata: Metadata = {
  title: "Product not found",
  robots: { index: false, follow: true },
};

export default function ProductNotFound() {
  return (
    <div className="py-32 text-center">
      <p className="text-xs uppercase tracking-widest text-ink-mute font-semibold mb-3">404</p>
      <h1 className="text-3xl font-semibold tracking-tight mb-2">Product not found.</h1>
      <p className="text-ink-soft max-w-md mx-auto">It may have been removed by the seller, or never existed.</p>
      <Link href="/search" className="inline-flex mt-6 h-10 px-4 items-center rounded-md bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition">
        Back to catalog
      </Link>
    </div>
  );
}
