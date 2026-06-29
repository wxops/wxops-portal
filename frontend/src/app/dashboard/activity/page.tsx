"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  GitPullRequest,
  CheckCircle2,
  Clock,
  MessageSquare,
  XCircle,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ActivityItem {
  number: number;
  title: string;
  state: string;
  merged: boolean;
  mergedAt: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  closeComment?: string;
  closeCommentBy?: string;
}

function displayState(item: ActivityItem): string {
  if (item.merged) return "merged";
  return item.state;
}

type FilterState = "all" | "open" | "closed";

const STATE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  open: Clock,
  closed: XCircle,
  merged: CheckCircle2,
};

const STATE_STYLE: Record<string, string> = {
  open: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  closed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  merged: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

const INITIAL_SIZE = 5;
const PAGE_SIZE = 20;

export default function ActivityPage() {
  const [recentItems, setRecentItems] = useState<ActivityItem[]>([]);
  const [paginatedItems, setPaginatedItems] = useState<ActivityItem[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const [filter, setFilter] = useState<FilterState>("all");
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const listRef = useRef<HTMLDivElement>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasMore = total > INITIAL_SIZE;

  // Fetch the 5 most recent items (fast initial load).
  const fetchRecent = useCallback((state: FilterState) => {
    fetch(`/api/catalog/activity?state=${state}&page=1&limit=${INITIAL_SIZE}`, {
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        setRecentItems(data.activity ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoadingRecent(false));
  }, []);

  // Fetch a full paginated page (when user expands).
  const fetchPage = useCallback((state: FilterState, p: number) => {
    setLoadingPage(true);
    fetch(`/api/catalog/activity?state=${state}&page=${p}&limit=${PAGE_SIZE}`, {
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        setPaginatedItems(data.activity ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoadingPage(false));
  }, []);

  // Initial load — just the 5 most recent.
  useEffect(() => {
    fetchRecent(filter);
  }, [filter, fetchRecent]);

  const handleFilterChange = (f: FilterState) => {
    setLoadingRecent(true);
    setFilter(f);
    setExpanded(false);
    setPage(1);
    setPaginatedItems([]);
  };

  const handleExpand = () => {
    setExpanded(true);
    setPage(1);
    fetchPage(filter, 1);
  };

  const handlePageChange = (p: number) => {
    setPage(p);
    fetchPage(filter, p);
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const visibleItems = expanded ? paginatedItems : recentItems;
  const isLoading = expanded ? loadingPage : loadingRecent;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Activity</h1>
        <p className="text-muted-foreground mt-1">
          Recent changes to the catalog and scaffolded projects.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-1 rounded-lg bg-muted/50 p-1 w-fit">
          {(["all", "open", "closed"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleFilterChange(s)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors capitalize",
                filter === s
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s}
            </button>
          ))}
        </div>
        {!loadingRecent && total > 0 && (
          <p className="text-xs text-muted-foreground">
            {total} {total === 1 ? "item" : "items"}
          </p>
        )}
      </div>

      {/* Activity list */}
      <div ref={listRef}>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: expanded ? 5 : INITIAL_SIZE }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg border bg-muted/30" />
            ))}
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <GitPullRequest className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {filter === "all"
                ? "No portal activity yet. Scaffold a project or register an entity to get started."
                : `No ${filter} pull requests.`}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleItems.map((item) => (
              <ActivityRow key={item.number} item={item} />
            ))}
          </div>
        )}
      </div>

      {/* "View all" button — shown when in recent mode and there are more items */}
      {!expanded && !loadingRecent && hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={handleExpand}
            className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
          >
            <ChevronDown className="h-4 w-4" />
            View all activity ({total} items)
          </button>
        </div>
      )}

      {/* Pagination — shown when expanded */}
      {expanded && !loadingPage && totalPages > 1 && (
        <div className="flex items-center justify-between border-t pt-4">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => handlePageChange(page - 1)}
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted/50 disabled:opacity-40 disabled:pointer-events-none"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </button>

          <div className="flex items-center gap-1">
            {pageRange(page, totalPages).map((p, i) =>
              p === "..." ? (
                <span key={`ellipsis-${i}`} className="px-1 text-sm text-muted-foreground">
                  ...
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  onClick={() => handlePageChange(p as number)}
                  className={cn(
                    "h-8 w-8 rounded-md text-sm font-medium transition-colors",
                    page === p
                      ? "bg-wxops-purple text-white"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  {p}
                </button>
              ),
            )}
          </div>

          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => handlePageChange(page + 1)}
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted/50 disabled:opacity-40 disabled:pointer-events-none"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const [showComment, setShowComment] = useState(false);
  const state = displayState(item);
  const StateIcon = STATE_ICON[state] ?? Clock;
  const stateStyle = STATE_STYLE[state] ?? STATE_STYLE.open;
  const timeAgo = formatRelativeTime(item.createdAt);
  const hasCloseComment = state === "closed" && !!item.closeComment;

  return (
    <div className="rounded-lg border transition-colors hover:bg-muted/30">
      <div className="flex items-start gap-3 p-4">
        <GitPullRequest
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            state === "open"
              ? "text-amber-500"
              : state === "merged"
                ? "text-green-500"
                : "text-red-500",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">
            {item.title}
          </p>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <span>#{item.number}</span>
            {item.author && <span>by {item.author}</span>}
            <span>{timeAgo}</span>
          </div>
        </div>
        <Badge
          className={cn(
            "shrink-0 text-[10px] font-medium capitalize gap-1",
            stateStyle,
          )}
        >
          <StateIcon className="h-3 w-3" />
          {state}
        </Badge>
      </div>

      {hasCloseComment && (
        <>
          {!showComment ? (
            <button
              type="button"
              onClick={() => setShowComment(true)}
              className="flex items-center gap-1.5 px-4 pb-3 text-xs text-red-600 dark:text-red-400 hover:underline"
            >
              <MessageSquare className="h-3 w-3" />
              Show close reason
            </button>
          ) : (
            <div className="mx-4 mb-3 flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 dark:border-red-800/40 dark:bg-red-950/20 px-2.5 py-1.5">
              <MessageSquare className="h-3 w-3 text-red-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                {item.closeCommentBy && (
                  <span className="text-[10px] font-medium text-red-700 dark:text-red-400">
                    {item.closeCommentBy}:
                  </span>
                )}
                <p className="text-xs text-red-700 dark:text-red-300 line-clamp-3">
                  {item.closeComment}
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function pageRange(current: number, total: number): (number | "...")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | "...")[] = [1];

  if (current > 3) pages.push("...");

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) pages.push("...");

  pages.push(total);
  return pages;
}

function formatRelativeTime(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
