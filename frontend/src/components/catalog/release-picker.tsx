"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface Release {
  tag_name: string;
  name: string;
  created_at: string;
  html_url: string;
  prerelease: boolean;
}

const PAGE_SIZE = 20;

type StabilityFilter = "all" | "stable" | "prerelease";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

interface ReleasePickerProps {
  entityKind: string;
  entityName: string;
  /** browse: read-only list (Releases panel). select: emits onSelect (compare-tag picker). */
  mode: "browse" | "select";
  onSelect?: (tag: string) => void;
  selectedTag?: string;
}

// No debounce on the filter input — a plain substring match over a page or
// two of releases (tens of items, not hundreds) is sub-millisecond, the same
// reasoning command-palette.tsx uses for its own instant, undebounced search
// applied to an even smaller dataset here.
export function ReleasePicker({ entityKind, entityName, mode, onSelect, selectedTag }: ReleasePickerProps) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [stability, setStability] = useState<StabilityFilter>("all");

  async function fetchPage(pageNum: number): Promise<Release[]> {
    const res = await fetch(
      `/api/catalog/entities/${encodeURIComponent(entityKind)}/${encodeURIComponent(entityName)}/releases?page=${pageNum}&limit=${PAGE_SIZE}`,
      { credentials: "include" },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.releases ?? []) as Release[];
  }

  // entityKind/entityName are fixed for this component's lifetime (a fresh
  // instance is mounted per dialog open) — no reset-on-change logic needed,
  // just a one-shot fetch on mount.
  useEffect(() => {
    let cancelled = false;

    fetchPage(1).then((first) => {
      if (cancelled) return;
      setReleases(first);
      setPage(1);
      setHasMore(first.length === PAGE_SIZE);
      setLoading(false);
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityKind, entityName]);

  async function handleLoadMore() {
    setLoadingMore(true);
    const nextPage = page + 1;
    const more = await fetchPage(nextPage);
    setReleases((prev) => [...prev, ...more]);
    setPage(nextPage);
    setHasMore(more.length === PAGE_SIZE);
    setLoadingMore(false);
  }

  const filtered = releases.filter((r) => {
    if (stability === "stable" && r.prerelease) return false;
    if (stability === "prerelease" && !r.prerelease) return false;
    if (query && !r.tag_name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by tag…"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>
        <div className="flex items-center gap-1 ml-auto">
          {(["all", "stable", "prerelease"] as StabilityFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStability(s)}
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                stability === s
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              {s === "all" ? "All" : s === "stable" ? "Stable" : "Pre-release"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading releases…
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          {releases.length === 0 ? "No releases found." : "No releases match this filter."}
        </p>
      ) : (
        <div className="rounded-md border border-border divide-y divide-border overflow-hidden">
          {filtered.map((r) => {
            const isSelected = mode === "select" && r.tag_name === selectedTag;
            const rowContent = (
              <>
                <span className="font-mono text-xs font-medium truncate">{r.tag_name}</span>
                {r.prerelease && (
                  <span className="shrink-0 text-[9px] rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5">
                    pre
                  </span>
                )}
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{formatDate(r.created_at)}</span>
                {mode === "browse" && <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />}
              </>
            );

            return mode === "select" ? (
              <button
                key={r.tag_name}
                onClick={() => onSelect?.(r.tag_name)}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/40",
                  isSelected && "bg-primary/10",
                )}
              >
                {rowContent}
              </button>
            ) : (
              <a
                key={r.tag_name}
                href={r.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-2.5 py-1.5 transition-colors hover:bg-muted/40"
              >
                {rowContent}
              </a>
            );
          })}
        </div>
      )}

      {hasMore && !loading && (
        <button
          onClick={handleLoadMore}
          disabled={loadingMore}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full justify-center py-1 disabled:opacity-50"
        >
          {loadingMore ? (
            <><Loader2 className="h-3 w-3 animate-spin" /> Loading…</>
          ) : (
            <><ChevronDown className="h-3 w-3" /> Load more</>
          )}
        </button>
      )}
      {!hasMore && releases.length > PAGE_SIZE && (
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground justify-center py-1">
          <ChevronUp className="h-3 w-3" /> All releases loaded
        </p>
      )}
    </div>
  );
}
