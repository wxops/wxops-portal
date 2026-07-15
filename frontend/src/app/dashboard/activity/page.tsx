"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  GitPullRequest, CheckCircle2, Clock, MessageSquare, XCircle,
  ChevronLeft, ChevronRight, ChevronDown, Copy, Check, Search,
  Boxes, ArrowUpCircle, Settings2, Terminal, BookOpen, Archive,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActivityItem {
  number: number;
  title: string;
  state: string;
  merged: boolean;
  mergedAt: string;
  author: string;
  authorAvatar: string;
  createdAt: string;
  updatedAt: string;
  closeComment?: string;
  closeCommentBy?: string;
}

type FilterTab = "all" | "open" | "merged" | "rejected";

// ── PR title parser ────────────────────────────────────────────────────────────

type PRType = "scaffold" | "promote" | "overlay" | "darlane" | "catalog" | "deprecate" | "config" | "unknown";

interface ParsedPR {
  type: PRType;
  appSlug: string;       // "team/appName" — used for display chip
  entityKind: string;    // for /dashboard/catalog/{kind}/{name} link
  entityName: string;
  env: string;
}

function parsePRTitle(title: string): ParsedPR {
  // [Scaffold] New project: team/app
  let m = title.match(/^\[Scaffold\].*?:\s*(\S+\/\S+)/);
  if (m) {
    const [team, app] = m[1].split("/");
    return { type: "scaffold", appSlug: m[1], entityKind: "component", entityName: app ?? team, env: "" };
  }
  // [Promote] team/app → lifecycle
  m = title.match(/^\[Promote\]\s+(\S+\/\S+)\s*[→>]\s*(\S+)/);
  if (m) {
    const app = m[1].split("/")[1] ?? m[1];
    return { type: "promote", appSlug: m[1], entityKind: "component", entityName: app, env: m[2] };
  }
  // [Overlay Update] team/app lifecycle
  m = title.match(/^\[Overlay Update\]\s+(\S+\/\S+)\s+(\S+)/);
  if (m) {
    const app = m[1].split("/")[1] ?? m[1];
    return { type: "overlay", appSlug: m[1], entityKind: "component", entityName: app, env: m[2] };
  }
  // [Darlane] [disable] team/app → env
  m = title.match(/^\[Darlane\]\s+(?:disable\s+)?(\S+\/\S+)\s*[→>]\s*(\S+)/);
  if (m) {
    const app = m[1].split("/")[1] ?? m[1];
    return { type: "darlane", appSlug: m[1], entityKind: "component", entityName: app, env: m[2] };
  }
  // [Catalog] Register|Edit|Delete Kind/name
  m = title.match(/^\[Catalog\]\s+\w+\s+(\w+)\/(\S+)/);
  if (m) {
    return { type: "catalog", appSlug: "", entityKind: m[1].toLowerCase(), entityName: m[2], env: "" };
  }
  // [Deprecate] team/app: reason
  m = title.match(/^\[Deprecate\]\s+(\S+\/\S+)/);
  if (m) {
    const app = m[1].split("/")[1] ?? m[1];
    return { type: "deprecate", appSlug: m[1], entityKind: "component", entityName: app, env: "" };
  }
  // [Config] (legacy)
  m = title.match(/^\[Config\].*?(\w+\/\w+)/);
  if (m) {
    const app = m[1].split("/")[1] ?? m[1];
    return { type: "config", appSlug: m[1], entityKind: "component", entityName: app, env: "" };
  }
  return { type: "unknown", appSlug: "", entityKind: "", entityName: "", env: "" };
}

// ── Type badge config ──────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<PRType, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge: string;
}> = {
  scaffold:  { label: "Scaffold",  icon: Boxes,          badge: "text-wxops-purple bg-wxops-purple/10 border-wxops-purple/30" },
  promote:   { label: "Promote",   icon: ArrowUpCircle,  badge: "text-wxops-green  bg-wxops-green/10  border-wxops-green/30"  },
  overlay:   { label: "Config",    icon: Settings2,      badge: "text-wxops-cyan   bg-wxops-cyan/10   border-wxops-cyan/30"   },
  darlane:   { label: "Darlane",   icon: Terminal,       badge: "text-amber-500    bg-amber-500/10    border-amber-500/30"    },
  catalog:   { label: "Catalog",   icon: BookOpen,       badge: "text-blue-500     bg-blue-500/10     border-blue-500/30"     },
  deprecate: { label: "Deprecate", icon: Archive,        badge: "text-rose-500     bg-rose-500/10     border-rose-500/30"     },
  config:    { label: "Config",    icon: Settings2,      badge: "text-wxops-cyan   bg-wxops-cyan/10   border-wxops-cyan/30"   },
  unknown:   { label: "PR",        icon: GitPullRequest, badge: "text-muted-foreground bg-muted border-border"               },
};

// ── PR state config ────────────────────────────────────────────────────────────

function prState(item: ActivityItem): "open" | "merged" | "rejected" {
  if (item.merged) return "merged";
  if (item.state === "closed") return "rejected";
  return "open";
}

const STATE_CONFIG = {
  open:     { icon: Clock,        color: "text-amber-500",              badge: "text-amber-700 bg-amber-100 border-amber-200 dark:text-amber-400 dark:bg-amber-900/30 dark:border-amber-800/40" },
  merged:   { icon: CheckCircle2, color: "text-wxops-green",            badge: "text-green-700 bg-green-100 border-green-200 dark:text-green-400 dark:bg-green-900/30 dark:border-green-800/40" },
  rejected: { icon: XCircle,      color: "text-rose-500",               badge: "text-rose-700 bg-rose-100 border-rose-200 dark:text-rose-400 dark:bg-rose-900/30 dark:border-rose-800/40" },
};

// ── Day grouping ───────────────────────────────────────────────────────────────

function dayGroup(iso: string): string {
  if (!iso) return "Older";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "Last 7 days";
  if (diffDays <= 30) return "This month";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

const GROUP_ORDER = ["Today", "Yesterday", "Last 7 days", "This month"];

function groupItems(items: ActivityItem[]): { label: string; items: ActivityItem[] }[] {
  const map = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const g = dayGroup(item.createdAt);
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(item);
  }
  const result: { label: string; items: ActivityItem[] }[] = [];
  for (const label of GROUP_ORDER) {
    if (map.has(label)) {
      result.push({ label, items: map.get(label)! });
      map.delete(label);
    }
  }
  // Remaining keys are month strings — sort descending by date
  const remaining = [...map.entries()].sort((a, b) => {
    const aDate = new Date(a[1][0].createdAt).getTime();
    const bDate = new Date(b[1][0].createdAt).getTime();
    return bDate - aDate;
  });
  for (const [label, its] of remaining) {
    result.push({ label, items: its });
  }
  return result;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const INITIAL_LIMIT = 5;
const PAGE_SIZE = 20;
const SEARCH_LIMIT = 100;

// Maps a filter tab to the `state` query param the backend understands.
function backendState(tab: FilterTab): string {
  if (tab === "open") return "open";
  if (tab === "merged" || tab === "rejected") return "closed";
  return "all";
}

// Client-side filter applied on top of the backend result.
function clientFilter(tab: FilterTab, items: ActivityItem[]): ActivityItem[] {
  if (tab === "merged") return items.filter((i) => i.merged);
  if (tab === "rejected") return items.filter((i) => !i.merged && i.state === "closed");
  return items;
}

// ── Stat chips (fetched once on mount) ────────────────────────────────────────

interface StatCounts { open: number; closed: number }

async function fetchCounts(): Promise<StatCounts> {
  const [openRes, closedRes] = await Promise.all([
    fetch("/api/catalog/activity?state=open&limit=1&page=1", { credentials: "include" }),
    fetch("/api/catalog/activity?state=closed&limit=1&page=1", { credentials: "include" }),
  ]);
  const [openData, closedData] = await Promise.all([openRes.json(), closedRes.json()]);
  return { open: openData.total ?? 0, closed: closedData.total ?? 0 };
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ActivityPage() {
  const [recentItems, setRecentItems] = useState<ActivityItem[]>([]);
  const [paginatedItems, setPaginatedItems] = useState<ActivityItem[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<StatCounts | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasMore = total > INITIAL_LIMIT;

  useEffect(() => {
    fetchCounts().then(setCounts).catch(() => {});
  }, []);

  const fetchRecent = useCallback((tab: FilterTab) => {
    const state = backendState(tab);
    const limit = search ? SEARCH_LIMIT : INITIAL_LIMIT;
    fetch(`/api/catalog/activity?state=${state}&page=1&limit=${limit}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        setRecentItems(data.activity ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoadingRecent(false));
  }, [search]);

  const fetchPage = useCallback((tab: FilterTab, p: number) => {
    setLoadingPage(true);
    const state = backendState(tab);
    fetch(`/api/catalog/activity?state=${state}&page=${p}&limit=${PAGE_SIZE}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        setPaginatedItems(data.activity ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoadingPage(false));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingRecent(true);
    fetchRecent(filter);
  }, [filter, search, fetchRecent]);

  const handleFilterChange = (f: FilterTab) => {
    setFilter(f);
    setExpanded(false);
    setPage(1);
    setPaginatedItems([]);
    setLoadingRecent(true);
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

  const rawItems = expanded ? paginatedItems : recentItems;
  const filteredItems = clientFilter(filter, rawItems).filter((item) => {
    if (!search) return true;
    return item.title.toLowerCase().includes(search.toLowerCase());
  });
  const grouped = groupItems(filteredItems);
  const isLoading = expanded ? loadingPage : loadingRecent;

  const TABS: { key: FilterTab; label: string }[] = [
    { key: "all",      label: "All"      },
    { key: "open",     label: "Open"     },
    { key: "merged",   label: "Merged"   },
    { key: "rejected", label: "Rejected" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Activity</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Recent changes to the catalog and scaffolded projects.
        </p>
      </div>

      {/* Stat chips */}
      {counts && (
        <div className="flex items-center gap-3 flex-wrap">
          <StatChip
            label="open"
            count={counts.open}
            color="text-amber-600 dark:text-amber-400"
            bg="bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800/40"
            dot="bg-amber-500"
          />
          <StatChip
            label="closed"
            count={counts.closed}
            color="text-muted-foreground"
            bg="bg-muted/50 border-border"
            dot="bg-muted-foreground"
          />
        </div>
      )}

      {/* Filter + search bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 rounded-lg bg-muted/50 p-1 w-fit">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => handleFilterChange(key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                filter === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search by service…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-wxops-purple/50"
          />
        </div>

        {!loadingRecent && total > 0 && (
          <p className="text-xs text-muted-foreground ml-auto tabular-nums">
            {search ? `${filteredItems.length} result${filteredItems.length !== 1 ? "s" : ""}` : `${total} item${total !== 1 ? "s" : ""}`}
          </p>
        )}
      </div>

      {/* Activity list */}
      <div ref={listRef}>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: expanded ? 5 : INITIAL_LIMIT }).map((_, i) => (
              <div key={i} className="h-[68px] animate-pulse rounded-xl border bg-muted/30" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <GitPullRequest className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {search
                ? `No results for "${search}"`
                : filter === "all"
                  ? "No portal activity yet."
                  : `No ${filter} pull requests.`}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(({ label, items }) => (
              <div key={label}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((item) => (
                    <ActivityRow key={item.number} item={item} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* View all button */}
      {!expanded && !loadingRecent && hasMore && !search && (
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

      {/* Pagination */}
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
                <span key={`e-${i}`} className="px-1 text-sm text-muted-foreground">…</span>
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
                >{p}</button>
              )
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

// ── StatChip ───────────────────────────────────────────────────────────────────

function StatChip({ label, count, color, bg, dot }: {
  label: string; count: number; color: string; bg: string; dot: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-1.5", bg)}>
      <span className={cn("h-2 w-2 rounded-full shrink-0", dot)} />
      <span className={cn("text-sm font-semibold tabular-nums", color)}>{count}</span>
      <span className={cn("text-xs", color)}>{label}</span>
    </div>
  );
}

// ── ActivityRow ────────────────────────────────────────────────────────────────

function ActivityRow({ item }: { item: ActivityItem }) {
  const [showComment, setShowComment] = useState(false);
  const [copiedNum, setCopiedNum] = useState(false);
  const parsed = parsePRTitle(item.title);
  const typeConf = TYPE_CONFIG[parsed.type];
  const TypeIcon = typeConf.icon;
  const state = prState(item);
  const stateConf = STATE_CONFIG[state];
  const StateIcon = stateConf.icon;
  const hasCloseComment = state === "rejected" && !!item.closeComment;
  const entityUrl = parsed.entityName
    ? `/dashboard/catalog/${parsed.entityKind}/${parsed.entityName}`
    : null;

  function copyNum() {
    navigator.clipboard.writeText(`#${item.number}`).then(() => {
      setCopiedNum(true);
      setTimeout(() => setCopiedNum(false), 1500);
    });
  }

  return (
    <div className="rounded-xl border bg-card transition-colors hover:bg-muted/20">
      <div className="flex items-start gap-3 px-4 py-3">

        {/* Avatar */}
        <AuthorAvatar login={item.author} avatarUrl={item.authorAvatar} />

        {/* Main content */}
        <div className="min-w-0 flex-1">
          {/* Top row: type badge + title */}
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className={cn(
              "shrink-0 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              typeConf.badge
            )}>
              <TypeIcon className="h-3 w-3" />
              {typeConf.label}
            </span>
            {parsed.env && (
              <span className="shrink-0 text-[10px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">
                {parsed.env}
              </span>
            )}
            <p className="text-sm font-medium text-foreground/90 truncate">{item.title}</p>
          </div>

          {/* Bottom row: meta */}
          <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground flex-wrap">
            {/* PR number + copy */}
            <button
              onClick={copyNum}
              className="group flex items-center gap-0.5 hover:text-foreground transition-colors"
              title="Copy PR number"
            >
              <span>#{item.number}</span>
              {copiedNum
                ? <Check className="h-3 w-3 text-wxops-green ml-0.5" />
                : <Copy className="h-3 w-3 ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />}
            </button>

            {item.author && <span>by <span className="text-foreground/70">{item.author}</span></span>}
            <span>{formatRelativeTime(item.createdAt)}</span>

            {/* Catalog entity chip */}
            {entityUrl && parsed.appSlug && (
              <Link
                href={entityUrl}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-mono text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
              >
                {parsed.appSlug}
              </Link>
            )}
            {entityUrl && !parsed.appSlug && parsed.entityName && (
              <Link
                href={entityUrl}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-mono text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
              >
                {parsed.entityKind}/{parsed.entityName}
              </Link>
            )}
          </div>
        </div>

        {/* State badge */}
        <Badge className={cn("shrink-0 text-[10px] font-medium capitalize gap-1 border", stateConf.badge)}>
          <StateIcon className="h-3 w-3" />
          {state}
        </Badge>
      </div>

      {/* Close reason */}
      {hasCloseComment && (
        <>
          {!showComment ? (
            <button
              type="button"
              onClick={() => setShowComment(true)}
              className="flex items-center gap-1.5 px-4 pb-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <MessageSquare className="h-3 w-3" />
              Show close reason
            </button>
          ) : (
            <div className="mx-4 mb-3 flex items-start gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
              <div className="min-w-0">
                {item.closeCommentBy && (
                  <span className="text-[10px] font-medium text-foreground/70">{item.closeCommentBy}: </span>
                )}
                <p className="text-xs text-muted-foreground line-clamp-3">{item.closeComment}</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── AuthorAvatar ───────────────────────────────────────────────────────────────

function AuthorAvatar({ login, avatarUrl }: { login: string; avatarUrl: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const initials = login ? login.slice(0, 2).toUpperCase() : "?";

  if (avatarUrl && !imgFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={login}
        onError={() => setImgFailed(true)}
        className="h-7 w-7 shrink-0 rounded-full border border-border object-cover mt-0.5"
      />
    );
  }
  return (
    <div className="h-7 w-7 shrink-0 rounded-full border border-border bg-muted flex items-center justify-center mt-0.5">
      <span className="text-[10px] font-semibold text-muted-foreground">{initials}</span>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function pageRange(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "...")[] = [1];
  if (current > 3) pages.push("...");
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);
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
