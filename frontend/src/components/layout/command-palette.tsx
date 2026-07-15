"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search, X, Layers, Globe, Users, Database, FileText, User, Box, Star, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getCatalogSearch, type IndexedEntity } from "@/lib/catalog-index";
import { getRecent, getPinned, trackVisit, type NavEntity } from "@/lib/entity-nav";

// ── Kind appearance map ────────────────────────────────────────────────────────

const KIND: Record<string, { icon: React.ElementType; dot: string }> = {
  Component: { icon: Layers,   dot: "bg-blue-500"   },
  System:    { icon: Box,      dot: "bg-purple-500" },
  API:       { icon: Globe,    dot: "bg-green-500"  },
  Resource:  { icon: Database, dot: "bg-orange-500" },
  Group:     { icon: Users,    dot: "bg-yellow-500" },
  User:      { icon: User,     dot: "bg-pink-500"   },
  Doc:       { icon: FileText, dot: "bg-cyan-500"   },
};

function entityHref(kind: string, name: string): string {
  if (kind === "System") return `/dashboard/catalog/systems/${name}`;
  if (kind === "Group")  return `/dashboard/catalog/groups/${name}`;
  if (kind === "User")   return `/dashboard/catalog/users/${name}`;
  return `/dashboard/catalog/${kind}/${name}`;
}

function IdleSection({
  label, icon, items, onSelect,
}: {
  label: string;
  icon: React.ReactNode;
  items: NavEntity[];
  onSelect: (e: NavEntity) => void;
}) {
  return (
    <div className="mb-1">
      <div className="flex items-center gap-1.5 px-4 py-1.5">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          {label}
        </span>
      </div>
      {items.map((e) => {
        const cfg  = KIND[e.kind] ?? KIND.Component;
        const Icon = cfg.icon;
        return (
          <button
            key={`${e.kind}/${e.name}`}
            type="button"
            onClick={() => onSelect(e)}
            className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-muted/50 transition-colors"
          >
            <Icon className={cn("h-4 w-4 shrink-0", cfg.dot.replace("bg-", "text-"))} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium truncate">{e.title}</span>
                {e.lifecycle && (
                  <span className="shrink-0 text-[10px] text-muted-foreground/50">{e.lifecycle}</span>
                )}
              </div>
              {e.description && (
                <p className="text-xs text-muted-foreground truncate">{e.description}</p>
              )}
            </div>
            <span className="shrink-0 flex items-center gap-1.5">
              <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
              <span className="text-[10px] font-mono text-muted-foreground/50">{e.kind}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export function CommandPalette() {
  const [open, setOpen]         = useState(false);
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState<IndexedEntity[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(false);
  const [recent, setRecent]     = useState<NavEntity[]>([]);
  const [pinned, setPinned]     = useState<NavEntity[]>([]);

  const inputRef  = useRef<HTMLInputElement>(null);
  const listRef   = useRef<HTMLUListElement>(null);
  const searchRef = useRef<((q: string, limit?: number) => IndexedEntity[]) | null>(null);
  const router    = useRouter();

  // ── Open the palette: reset all transient state + warm up the index ──────────
  const openPalette = useCallback(() => {
    setQuery("");
    setResults([]);
    setSelected(0);
    setError(false);
    setLoading(true);
    setOpen(true);
    // Read localStorage snapshots for the idle view
    setRecent(getRecent().slice(0, 5));
    setPinned(getPinned());
    // Build / retrieve the FlexSearch index (module-level cache, built once)
    getCatalogSearch()
      .then((fn) => { searchRef.current = fn; })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  // ── Global Ctrl/Cmd+K + custom event listener ────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        if (open) setOpen(false);
        else openPalette();
      }
    }
    function onOpen() { openPalette(); }
    window.addEventListener("keydown", onKey);
    window.addEventListener("command-palette:open", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("command-palette:open", onOpen);
    };
  }, [open, openPalette]);

  // ── Focus input after the palette renders open ───────────────────────────────
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // ── Lock body scroll while open ──────────────────────────────────────────────
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // ── Synchronous search (in-memory FlexSearch, no debounce needed) ────────────
  const doSearch = useCallback((q: string) => {
    if (!searchRef.current || !q.trim()) {
      setResults([]);
      return;
    }
    setResults(searchRef.current(q, 8));
    setSelected(0);
  }, []);

  // ── Keyboard navigation ──────────────────────────────────────────────────────
  function onKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "Escape":
        setOpen(false);
        break;
      case "ArrowDown":
        e.preventDefault();
        setSelected((s) => {
          const next = Math.min(s + 1, results.length - 1);
          (listRef.current?.children[next] as HTMLElement | undefined)
            ?.scrollIntoView({ block: "nearest" });
          return next;
        });
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelected((s) => {
          const next = Math.max(s - 1, 0);
          (listRef.current?.children[next] as HTMLElement | undefined)
            ?.scrollIntoView({ block: "nearest" });
          return next;
        });
        break;
      case "Enter":
        if (results[selected]) navigate(results[selected]);
        break;
    }
  }

  function navigate(entity: { kind: string; name: string; title: string; description: string; lifecycle: string }) {
    trackVisit({
      kind:        entity.kind,
      name:        entity.name,
      title:       entity.title,
      description: entity.description,
      lifecycle:   entity.lifecycle,
    });
    router.push(entityHref(entity.kind, entity.name));
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh]"
      onKeyDown={onKeyDown}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Panel */}
      <div
        className="relative w-full max-w-2xl mx-4 rounded-2xl border border-border bg-background shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Search row ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-4 px-5 py-4 border-b border-border">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              doSearch(e.target.value);
            }}
            placeholder="Search catalog…"
            className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          {/* Spinner while index builds on first open */}
          {loading && (
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-muted border-t-muted-foreground" />
          )}
          {!loading && query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => { setQuery(""); setResults([]); inputRef.current?.focus(); }}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <kbd className="hidden sm:flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* ── Results ────────────────────────────────────────────────────────── */}
        {results.length > 0 && (
          <ul ref={listRef} className="max-h-[26rem] overflow-y-auto py-1">
            {results.map((entity, i) => {
              const cfg = KIND[entity.kind] ?? KIND.Component;
              const Icon = cfg.icon;
              const isActive = i === selected;
              return (
                <li key={`${entity.kind}/${entity.name}`}>
                  <button
                    type="button"
                    className={cn(
                      "w-full flex items-center gap-4 px-5 py-3 text-left transition-colors",
                      isActive ? "bg-muted" : "hover:bg-muted/50"
                    )}
                    onMouseEnter={() => setSelected(i)}
                    onClick={() => navigate(entity)}
                  >
                    {/* Kind icon */}
                    <Icon className={cn("h-5 w-5 shrink-0", cfg.dot.replace("bg-", "text-"))} />

                    {/* Name + description hint */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium truncate">{entity.title}</span>
                        {entity.lifecycle && (
                          <span className="shrink-0 text-[10px] text-muted-foreground/60">
                            {entity.lifecycle}
                          </span>
                        )}
                      </div>
                      {entity.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {entity.description}
                        </p>
                      )}
                    </div>

                    {/* Kind badge */}
                    <span className="shrink-0 flex items-center gap-1.5">
                      <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
                      <span className="text-[10px] font-mono text-muted-foreground/60">
                        {entity.kind}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* ── No results ─────────────────────────────────────────────────────── */}
        {query && !loading && results.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No results for &ldquo;{query}&rdquo;
          </div>
        )}

        {/* ── Error state ────────────────────────────────────────────────────── */}
        {error && (
          <div className="px-4 py-4 text-center text-xs text-red-500">
            Failed to load catalog index
          </div>
        )}

        {/* ── Idle: pinned + recently viewed ────────────────────────────────── */}
        {!query && !error && (
          <div className="py-2">
            {pinned.length > 0 && (
              <IdleSection
                label="Pinned"
                icon={<Star className="h-3 w-3 fill-current text-amber-500" />}
                items={pinned}
                onSelect={navigate}
              />
            )}
            {recent.length > 0 && (
              <IdleSection
                label="Recently Viewed"
                icon={<Clock className="h-3 w-3 text-muted-foreground" />}
                items={recent}
                onSelect={navigate}
              />
            )}
            {pinned.length === 0 && recent.length === 0 && (
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-[11px] text-muted-foreground/50">
                  Search across all catalog entities
                </span>
                <div className="hidden sm:flex items-center gap-3 text-[10px] text-muted-foreground/40 font-mono">
                  <span>↑↓ navigate</span>
                  <span>↵ open</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
