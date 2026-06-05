"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { FileText, Maximize2, X } from "lucide-react";
import { MermaidDiagram, type DocTooltipData } from "./mermaid-diagram";

interface GraphPanelProps {
  /** Graph without Doc nodes — the default clean view. */
  chartBase: string;
  /** Graph including Doc nodes, shown when "Show decisions" is toggled on.
   *  Omit (or pass same string as chartBase) when there are no docs. */
  chartWithDocs?: string;
  docTooltips?: Record<string, DocTooltipData>;
  docsCount?: number;
}

interface DocsToggleProps {
  hasDocs: boolean;
  showDocs: boolean;
  docsCount: number;
  onToggle: () => void;
}

function DocsToggle({ hasDocs, showDocs, docsCount, onToggle }: DocsToggleProps) {
  if (!hasDocs) return null;
  return (
    <button
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
        showDocs
          ? "border-primary/40 bg-primary/5 text-primary hover:bg-primary/10"
          : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
      }`}
    >
      <FileText className="h-3.5 w-3.5" />
      {showDocs ? "Hide decisions" : `Show decisions (${docsCount})`}
    </button>
  );
}

const Legend = () => (
  <div className="flex items-center gap-2 text-xs text-muted-foreground">
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded-sm bg-violet-200 border border-violet-500" />
      RFC
    </span>
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded-sm bg-blue-100 border border-blue-500" />
      ADR
    </span>
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded-sm bg-emerald-100 border border-emerald-500" />
      Doc
    </span>
  </div>
);

export function GraphPanel({
  chartBase,
  chartWithDocs,
  docTooltips,
  docsCount = 0,
}: GraphPanelProps) {
  const hasDocs = !!chartWithDocs && chartWithDocs !== chartBase && docsCount > 0;

  // If there's no base (system has only docs), default the toggle on
  const [showDocs, setShowDocs]       = useState(!chartBase);
  const [isMaximized, setIsMaximized] = useState(false);

  // SSR-safe portal gate: false on server, true on client — no setState needed
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  // Body scroll lock when maximized
  useEffect(() => {
    document.body.style.overflow = isMaximized ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isMaximized]);

  // Close on Escape
  useEffect(() => {
    if (!isMaximized) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsMaximized(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isMaximized]);

  const activeChart = hasDocs && showDocs ? chartWithDocs! : chartBase;
  const activeTooltips = showDocs ? docTooltips : undefined;

  if (!activeChart && !chartWithDocs) return null;

  const hint = [
    "Drag to pan",
    hasDocs && showDocs ? "hover doc nodes for details · click to open" : null,
  ].filter(Boolean).join(" · ");

  const toggleDocs = () => setShowDocs((v) => !v);

  const fullscreenOverlay = isMaximized && mounted
    ? createPortal(
        /* Backdrop */
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
          onClick={(e) => { if (e.target === e.currentTarget) setIsMaximized(false); }}
        >
          {/* Floating panel — not full-screen */}
          <div className="relative flex flex-col w-[90vw] max-w-5xl h-[70vh] bg-background rounded-xl border shadow-2xl overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between border-b px-4 py-2.5 shrink-0 gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Decision &amp; Service Graph
                </h2>
                {showDocs && <Legend />}
              </div>
              <div className="flex items-center gap-2">
                <DocsToggle hasDocs={hasDocs} showDocs={showDocs} docsCount={docsCount} onToggle={toggleDocs} />
                <button
                  onClick={() => setIsMaximized(false)}
                  className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  title="Close (Esc)"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Diagram — fills panel, drag covers the whole area */}
            <div className="flex-1 overflow-hidden p-3">
              <MermaidDiagram
                chart={activeChart || chartWithDocs!}
                docTooltips={activeTooltips}
                mode="pan"
                className="h-full rounded-md border bg-muted/20 p-3"
              />
            </div>

            <p className="text-xs text-center text-muted-foreground py-2 shrink-0 border-t">
              {hint} · click outside or press Esc to close
            </p>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <section className="space-y-3">
        {/* Section header — title + legend + docs toggle only; expand lives on the diagram */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Decision &amp; Service Graph
            </h2>
            {showDocs && hasDocs && <Legend />}
          </div>
          <DocsToggle hasDocs={hasDocs} showDocs={showDocs} docsCount={docsCount} onToggle={toggleDocs} />
        </div>

        {/* Inline diagram — Obsidian-style hover expand */}
        <div className="relative group rounded-md border bg-muted/20">
          <div className="overflow-hidden max-h-64 p-4">
            <MermaidDiagram
              chart={activeChart || chartWithDocs!}
              docTooltips={activeTooltips}
            />
          </div>

          {/* Bottom fade — hints clipped content when graph is large */}
          <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-muted/40 to-transparent pointer-events-none rounded-b-md" />

          {/* Expand button — appears on hover like Obsidian graph */}
          <button
            onClick={() => setIsMaximized(true)}
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 inline-flex items-center justify-center rounded-md border border-border/60 bg-background/90 backdrop-blur-sm p-1.5 text-muted-foreground hover:text-foreground shadow-sm transition-all"
            title="Expand graph"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground">{hint}</p>
      </section>

      {fullscreenOverlay}
    </>
  );
}
