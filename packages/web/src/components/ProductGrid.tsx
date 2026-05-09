import type { SearchHit } from "@/lib/api";
import { ProductCard } from "./ProductCard";

export function ProductGrid({ hits }: { hits: SearchHit[] }) {
  return (
    <ul
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 list-none p-0 m-0"
      aria-label={`${hits.length} product${hits.length === 1 ? "" : "s"}`}
    >
      {hits.map((h, i) => (
        <li key={h.productId}>
          <ProductCard hit={h} eager={i < 4} />
        </li>
      ))}
    </ul>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-line-soft bg-bg-soft overflow-hidden">
          <div className="skeleton aspect-[4/3] rounded-none" />
          <div className="p-4 space-y-3">
            <div className="skeleton h-3 w-1/3" />
            <div className="skeleton h-4 w-5/6" />
            <div className="skeleton h-4 w-2/3" />
            <div className="skeleton h-5 w-1/3 mt-2" />
          </div>
        </div>
      ))}
    </div>
  );
}
