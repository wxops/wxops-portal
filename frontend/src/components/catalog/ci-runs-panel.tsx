"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { RunRow, type WorkflowRun } from "@/components/catalog/ci-status-card";

const PAGE_SIZE = 20;

type StatusFilter = "all" | "success" | "failure" | "running" | "cancelled";

const STATUS_LABEL: Record<StatusFilter, string> = {
  all: "All",
  success: "Success",
  failure: "Failure",
  running: "Running",
  cancelled: "Cancelled",
};

function matchesStatus(run: WorkflowRun, filter: StatusFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "success": return run.conclusion === "success";
    case "failure": return run.conclusion === "failure";
    case "running": return run.status === "running" || run.status === "waiting";
    case "cancelled": return run.conclusion === "cancelled";
  }
}

interface CIRunsPanelProps {
  entityKind: string;
  entityName: string;
}

export function CIRunsPanel({ entityKind, entityName }: CIRunsPanelProps) {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [branch, setBranch] = useState<string>("");
  const [query, setQuery] = useState("");

  async function fetchPage(pageNum: number): Promise<WorkflowRun[]> {
    const res = await fetch(
      `/api/catalog/entities/${encodeURIComponent(entityKind)}/${encodeURIComponent(entityName)}/ci?page=${pageNum}&limit=${PAGE_SIZE}`,
      { credentials: "include" },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.runs ?? []) as WorkflowRun[];
  }

  // entityKind/entityName are fixed for this panel's lifetime — a fresh
  // instance mounts each time the dialog opens, so a one-shot fetch is enough.
  useEffect(() => {
    let cancelled = false;

    fetchPage(1).then((first) => {
      if (cancelled) return;
      setRuns(first);
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
    setRuns((prev) => [...prev, ...more]);
    setPage(nextPage);
    setHasMore(more.length === PAGE_SIZE);
    setLoadingMore(false);
  }

  const branches = [...new Set(runs.map((r) => r.head_branch).filter(Boolean))].sort();

  const filtered = runs.filter((r) => {
    if (!matchesStatus(r, status)) return false;
    if (branch && r.head_branch !== branch) return false;
    if (query && !r.display_title.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by title…"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>
        <select
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
        >
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {(Object.keys(STATUS_LABEL) as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              status === s
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
            )}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Branch filter covers loaded runs — load more to see older branches.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading runs…
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          {runs.length === 0 ? "No CI runs found." : "No runs match this filter."}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
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
      {!hasMore && runs.length > PAGE_SIZE && (
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground justify-center py-1">
          <ChevronUp className="h-3 w-3" /> All runs loaded
        </p>
      )}
    </div>
  );
}
