// Renders when /s/<id>/page.tsx calls notFound() — i.e. the snapshot id is
// unknown or its 24h window has elapsed. Owns the HTTP 404 status so link
// checkers and upstream caches see an accurate signal, while the recipient
// still gets the friendly explanation that lived inline on the page before.

import Link from "next/link";

export default function SnapshotNotFound() {
  return (
    <article className="max-w-3xl mx-auto p-6" lang="en">
      <h1 className="text-2xl font-semibold mb-2">Snapshot unavailable</h1>
      <p className="text-ink-soft mb-4">
        This snapshot is no longer stored. Snapshots are kept for 24 hours after
        they’re captured, then deleted. If you arrived here from an agent reply
        older than a day, ask the agent to re-run the request to get a fresh
        snapshot. If the link was never valid (e.g. an entity id mistyped into
        this URL), check the original source.
      </p>
      <p className="text-ink-soft mb-4 text-sm">
        Snapshot tokens are 22 characters long, made of letters, digits,
        underscores, and dashes.
      </p>
      <Link href="/" className="text-accent hover:underline">Back to marketplace</Link>
    </article>
  );
}
