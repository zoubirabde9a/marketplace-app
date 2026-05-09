"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="py-32 text-center">
      <p className="text-xs uppercase tracking-widest text-bad font-semibold mb-3">Something broke</p>
      <h1 className="text-3xl font-semibold tracking-tight mb-2">We couldn’t load that.</h1>
      <p className="text-ink-soft max-w-md mx-auto">{error.message}</p>
      {error.digest && <p className="text-xs text-ink-mute mt-2 font-mono">ref {error.digest}</p>}
      <button onClick={reset} className="inline-flex mt-6 h-10 px-4 items-center rounded-md bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition">
        Try again
      </button>
    </div>
  );
}
