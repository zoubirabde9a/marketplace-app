// Restored after a brief experiment to remove it for source-order
// reasons. The API endpoint /v1/products/{id} runs ~2.5s under steady
// load (captureRestSnapshot + projectDetail are doing more work than
// expected); without this loading.tsx the user sees a 2.5s white screen
// before any content. The skeleton-then-stream pattern keeps perceived
// load fast even though it pushes H1 byte position downstream of the
// CategoryFooter chips. Crawlers that execute JS (Google, Bing) still
// see correct DOM order via React Suspense replay.
//
// If the API latency drops below ~500ms (probably needs a snapshot/
// projectDetail refactor), this file can be deleted to recover source
// order on the byte stream too.
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
