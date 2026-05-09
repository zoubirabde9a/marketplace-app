import { ProductGridSkeleton } from "@/components/ProductGrid";

export default function Loading() {
  return (
    <div className="pt-8">
      <div className="skeleton h-8 w-1/3 mb-6" />
      <ProductGridSkeleton />
    </div>
  );
}
