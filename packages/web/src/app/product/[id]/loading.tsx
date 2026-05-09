export default function ProductLoading() {
  return (
    <div className="pt-8">
      <div className="skeleton h-3 w-48 mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mt-6">
        <div className="skeleton aspect-square rounded-2xl" />
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="skeleton h-3 w-20" />
            <div className="skeleton h-8 w-3/4" />
            <div className="skeleton h-3 w-32" />
          </div>
          <div className="skeleton h-9 w-32" />
          <div className="skeleton h-32 w-full rounded-2xl" />
          <div className="skeleton h-24 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
