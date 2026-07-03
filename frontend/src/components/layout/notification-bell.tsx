"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Bell, GitPullRequest, GitMerge, Rocket, Package, X, CheckCheck, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getAll,
  getUnreadCount,
  markAllRead,
  clearAll,
  NOTIFICATION_EVENT,
  type PortalNotification,
  type NotificationType,
} from "@/lib/notifications";

// ── Pollers ──────────────────────────────────────────────────────────────────
// Both pollers run every 3 minutes:
//   1. Catalog count poller — fires pr_merged when new entities appear.
//   2. Activity state poller — watches open portal PRs and fires pr_merged or
//      pr_closed when a PR transitions out of the "open" state during the session.

const POLL_MS = 3 * 60 * 1000;
const BASELINE_KEY = "wxops_catalog_baseline";
const TRACKED_PRS_KEY = "wxops_tracked_prs"; // Record<string, { state, merged, title }>

interface TrackedPR { number: number; state: string; merged: boolean; title: string; }

async function fetchActivitySnapshot(): Promise<TrackedPR[] | null> {
  try {
    const res = await fetch("/api/catalog/activity?state=all&limit=50", { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.activity)) return null;
    return data.activity as TrackedPR[];
  } catch { return null; }
}

async function fetchEntityCount(): Promise<number> {
  try {
    const res = await fetch("/api/catalog/entities?limit=1", { credentials: "include" });
    if (!res.ok) return -1;
    const data = await res.json();
    return typeof data.total === "number" ? data.total : -1;
  } catch {
    return -1;
  }
}

// ── Type metadata ────────────────────────────────────────────────────────────

const TYPE_META: Record<
  NotificationType,
  { icon: React.ElementType; color: string; label: string }
> = {
  pr_opened:        { icon: GitPullRequest, color: "text-blue-500",   label: "PR opened"  },
  pr_merged:        { icon: GitMerge,       color: "text-green-500",  label: "Merged"     },
  pr_closed:        { icon: XCircle,        color: "text-red-500",    label: "PR closed"  },
  scaffold_created: { icon: Rocket,         color: "text-purple-500", label: "Scaffolded" },
  project_imported: { icon: Package,        color: "text-orange-500", label: "Imported"   },
};

// ── Time formatting ──────────────────────────────────────────────────────────

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ── Component ────────────────────────────────────────────────────────────────

export function NotificationBell() {
  // Start with empty/zero so SSR and client initial render agree.
  // useEffect hydrates from sessionStorage after mount to avoid hydration mismatch
  // (sessionStorage doesn't exist on the server, so lazy initializers diverge).
  const [items, setItems]   = useState<PortalNotification[]>([]);
  const [unread, setUnread] = useState<number>(0);
  const [open, setOpen]     = useState(false);
  const panelRef            = useRef<HTMLDivElement>(null);
  const buttonRef           = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(() => {
    setItems(getAll());
    setUnread(getUnreadCount());
  }, []);

  // Hydrate from sessionStorage once after mount.
  // Must be in useEffect — sessionStorage is undefined during SSR, so reading it
  // in useState initializers causes a hydration mismatch between server and client.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh(); }, [refresh]);

  // Subscribe to store changes dispatched by notifications.ts
  useEffect(() => {
    window.addEventListener(NOTIFICATION_EVENT, refresh);
    return () => window.removeEventListener(NOTIFICATION_EVENT, refresh);
  }, [refresh]);

  // Poll catalog count every 3 min. Detect increases vs session baseline →
  // notification ("Catalog updated: N new entries").
  useEffect(() => {
    // Establish baseline silently on mount
    fetchEntityCount().then((count) => {
      if (count > 0 && sessionStorage.getItem(BASELINE_KEY) === null) {
        sessionStorage.setItem(BASELINE_KEY, String(count));
      }
    });

    const timerId = setInterval(async () => {
      const count = await fetchEntityCount();
      if (count < 0) return;
      const baseline = parseInt(sessionStorage.getItem(BASELINE_KEY) ?? "0", 10);
      if (count > baseline) {
        const delta = count - baseline;
        const { addNotification: add } = await import("@/lib/notifications");
        add({
          type: "pr_merged",
          title: "Catalog updated",
          body: `${delta} new entr${delta === 1 ? "y" : "ies"} merged`,
        });
        sessionStorage.setItem(BASELINE_KEY, String(count));
      }
    }, POLL_MS);

    return () => clearInterval(timerId);
  }, []);

  // Poll activity feed for PR state changes. Takes a snapshot on mount, then
  // on every tick fires pr_merged / pr_closed for any PR that was open and
  // has since transitioned. Covers scaffold, overlay, and registration PRs.
  useEffect(() => {
    fetchActivitySnapshot().then((prs) => {
      if (!prs) return;
      const snap: Record<string, TrackedPR> = {};
      for (const pr of prs) snap[String(pr.number)] = pr;
      sessionStorage.setItem(TRACKED_PRS_KEY, JSON.stringify(snap));
    });

    const timerId = setInterval(async () => {
      const raw = sessionStorage.getItem(TRACKED_PRS_KEY);
      const prev: Record<string, TrackedPR> = raw ? JSON.parse(raw) : {};

      const prs = await fetchActivitySnapshot();
      if (!prs) return;

      const { addNotification: add } = await import("@/lib/notifications");
      const next: Record<string, TrackedPR> = {};

      for (const pr of prs) {
        const key = String(pr.number);
        next[key] = pr;
        const was = prev[key];
        if (!was || was.state !== "open") continue;
        if (pr.merged) {
          add({ type: "pr_merged", title: "PR merged", body: pr.title });
        } else if (pr.state === "closed") {
          add({ type: "pr_closed", title: "PR closed", body: pr.title });
        }
      }

      sessionStorage.setItem(TRACKED_PRS_KEY, JSON.stringify(next));
    }, POLL_MS);

    return () => clearInterval(timerId);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (
        panelRef.current?.contains(e.target as Node) ||
        buttonRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function toggleOpen() {
    if (!open) {
      markAllRead();
      setUnread(0);
      setItems(getAll().map((n) => ({ ...n, read: true })));
    }
    setOpen((v) => !v);
  }

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={buttonRef}
        type="button"
        aria-label="Notifications"
        onClick={toggleOpen}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white leading-none">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-10 z-50 w-80 rounded-xl border border-border bg-background shadow-xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <span className="text-sm font-medium">Notifications</span>
            <div className="flex items-center gap-1">
              {items.length > 0 && (
                <>
                  <button
                    type="button"
                    title="Mark all read"
                    onClick={() => { markAllRead(); refresh(); }}
                    className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Clear all"
                    onClick={() => { clearAll(); refresh(); }}
                    className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* List */}
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground/50">
              <Bell className="h-6 w-6" />
              <p className="text-xs">No activity this session</p>
            </div>
          ) : (
            <ul className="max-h-72 overflow-y-auto divide-y divide-border/50">
              {items.map((n) => {
                const meta = TYPE_META[n.type];
                const Icon = meta.icon;
                return (
                  <li
                    key={n.id}
                    className={cn(
                      "flex items-start gap-3 px-4 py-3 text-sm transition-colors",
                      !n.read && "bg-muted/30",
                    )}
                  >
                    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.color)} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{n.title}</p>
                      {n.body && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{n.body}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground/50 mt-0.5">
                      {timeAgo(n.at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Footer */}
          <div className="border-t border-border/50 px-4 py-2">
            <p className="text-[10px] text-muted-foreground/40">
              Cleared when session ends
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
