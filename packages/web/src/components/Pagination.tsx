import Link from "next/link";

export function Pagination({
  currentParams,
  nextCursor,
  resultsLen,
}: {
  currentParams: URLSearchParams;
  nextCursor: string | null;
  resultsLen: number;
}) {
  const noNext = !nextCursor || resultsLen === 0;
  const noPrev = !currentParams.get("cursor");

  if (noPrev && noNext) return null;

  const back = new URLSearchParams(currentParams.toString());
  back.delete("cursor");

  const fwd = new URLSearchParams(currentParams.toString());
  if (nextCursor) fwd.set("cursor", nextCursor);

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between mt-8 pt-6 border-t border-line-soft"
    >
      <Link
        href={`/search?${back.toString()}`}
        aria-disabled={noPrev}
        tabIndex={noPrev ? -1 : undefined}
        rel={noPrev ? undefined : "prev"}
        className={`text-sm px-3 h-9 inline-flex items-center rounded-md border transition ${
          noPrev ? "pointer-events-none opacity-40 border-line-soft text-ink-mute" : "border-line hover:border-accent/40 text-ink-soft hover:text-ink"
        }`}
      >
        ← Back to start
      </Link>
      <Link
        href={`/search?${fwd.toString()}`}
        aria-disabled={noNext}
        tabIndex={noNext ? -1 : undefined}
        rel={noNext ? undefined : "next"}
        className={`text-sm px-4 h-9 inline-flex items-center rounded-md transition ${
          noNext ? "pointer-events-none opacity-40 bg-bg-soft border border-line-soft text-ink-mute" : "bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25"
        }`}
      >
        Next page →
      </Link>
    </nav>
  );
}
