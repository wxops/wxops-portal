import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown by the Next.js App Router while the dashboard server component renders.
 *
 * This is the first screen after the OIDC callback redirects back, and the page
 * blocks on a catalog walk that hits Gitea whenever the 5-minute cache is cold.
 * Without this file that wait is a blank page, which reads as "login is slow"
 * even though authentication already finished.
 *
 * The sidebar and topbar come from dashboard/layout.tsx and are already painted,
 * so this only mirrors the page body.
 */
export default function DashboardLoading() {
  return (
    <div className="hero-glow grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-10 items-start">
      {/* ── Left column ─────────────────────────────────────────────── */}
      <div className="space-y-10 min-w-0">
        {/* Hero */}
        <div className="space-y-4 pt-2">
          <Skeleton className="h-6 w-32 rounded-full" />
          <Skeleton className="h-14 w-[26rem] max-w-full" />
          <Skeleton className="h-6 w-full max-w-2xl" />
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[8.5rem] rounded-xl" />
          ))}
        </div>

        {/* Quick start */}
        <div className="space-y-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-[4.5rem] rounded-xl" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[10.5rem] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-[5.5rem] rounded-xl" />
        </div>
      </div>

      {/* ── Right column — identity panel ───────────────────────────── */}
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-[26rem] rounded-xl" />
        <Skeleton className="h-[13rem] rounded-xl" />
      </div>
    </div>
  );
}
