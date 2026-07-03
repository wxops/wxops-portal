// Shown by Next.js App Router while the catalog server component re-renders
// (e.g. when clicking a lifecycle tab or kind filter pill).

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3 animate-pulse">
      <div className="flex items-start justify-between gap-2">
        <div className="h-4 w-4 rounded bg-muted shrink-0" />
        <div className="h-4 w-32 rounded bg-muted flex-1" />
        <div className="h-5 w-16 rounded-full bg-muted" />
      </div>
      <div className="h-3 w-24 rounded bg-muted/70" />
      <div className="space-y-1.5">
        <div className="h-3 w-full rounded bg-muted/60" />
        <div className="h-3 w-4/5 rounded bg-muted/60" />
      </div>
      <div className="flex gap-2 pt-1">
        <div className="h-4 w-14 rounded-full bg-muted/50" />
        <div className="h-4 w-20 rounded-full bg-muted/50" />
      </div>
    </div>
  );
}

export default function CatalogLoading() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-44 rounded bg-muted animate-pulse" />
          <div className="h-4 w-64 rounded bg-muted/60 animate-pulse" />
        </div>
        <div className="h-9 w-24 rounded-lg bg-muted animate-pulse" />
      </div>

      {/* Search bar */}
      <div className="h-10 w-full rounded-lg border border-border bg-muted/30 animate-pulse" />

      {/* Kind pills */}
      <div className="flex gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-7 w-20 rounded-full border border-border bg-muted/40 animate-pulse" />
        ))}
      </div>

      {/* Lifecycle tab bar */}
      <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-7 w-28 rounded-md bg-muted/60 animate-pulse" />
        ))}
      </div>

      {/* Card grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
