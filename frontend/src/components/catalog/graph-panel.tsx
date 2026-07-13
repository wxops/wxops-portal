"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { FileText, Maximize2, X, Network } from "lucide-react";
import { useTheme } from "next-themes";
import { MermaidDiagram, type DocTooltipData } from "./mermaid-diagram";

interface GraphPanelProps {
  chartBase: string;
  chartWithDocs?: string;
  chartBaseLight?: string;
  chartWithDocsLight?: string;
  docTooltips?: Record<string, DocTooltipData>;
  docsCount?: number;
}

function DocsToggle({
  hasDocs, showDocs, docsCount, onToggle,
}: {
  hasDocs: boolean; showDocs: boolean; docsCount: number; onToggle: () => void;
}) {
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

function Legend({ isDark }: { isDark: boolean }) {
  const s = isDark
    ? { svc: "bg-[#1e1347] border-[#8b5cf6]", api: "bg-[#0c3547] border-[#22d3ee]", res: "bg-[#161550] border-[#818cf8]", rfc: "bg-[#1e1347] border-dashed border-[#a78bfa]", adr: "bg-[#0c1f4a] border-[#60a5fa]", doc: "bg-[#082a18] border-[#34d399]" }
    : { svc: "bg-[#ede9fe] border-[#7c3aed]", api: "bg-[#e0f2fe] border-[#0891b2]", res: "bg-[#e0e7ff] border-[#6366f1]", rfc: "bg-[#ede9fe] border-dashed border-[#8b5cf6]", adr: "bg-[#dbeafe] border-[#3b82f6]", doc: "bg-[#d1fae5] border-[#10b981]" };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><span className={`inline-block w-2.5 h-2.5 rounded-sm border ${s.svc}`} />Service</span>
      <span className="inline-flex items-center gap-1.5"><span className={`inline-block w-2.5 h-2.5 rounded-full border ${s.api}`} />API</span>
      <span className="inline-flex items-center gap-1.5"><span className={`inline-block w-2.5 h-2.5 rounded-sm border ${s.res}`} />Resource</span>
      <span className="text-muted-foreground/30">·</span>
      <span className="inline-flex items-center gap-1.5"><span className={`inline-block w-2.5 h-2.5 rounded-sm border ${s.rfc}`} />RFC</span>
      <span className="inline-flex items-center gap-1.5"><span className={`inline-block w-2.5 h-2.5 rounded-sm border ${s.adr}`} />ADR</span>
      <span className="inline-flex items-center gap-1.5"><span className={`inline-block w-2.5 h-2.5 rounded-sm border ${s.doc}`} />Doc</span>
    </div>
  );
}

export function GraphPanel({
  chartBase,
  chartWithDocs,
  chartBaseLight,
  chartWithDocsLight,
  docTooltips,
  docsCount = 0,
}: GraphPanelProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

  const base = isDark ? chartBase : (chartBaseLight || chartBase);
  const full = isDark ? chartWithDocs : (chartWithDocsLight || chartWithDocs);

  const hasDocs = !!full && full !== base && docsCount > 0;

  const [showDocs, setShowDocs]       = useState(!base);
  const [isMaximized, setIsMaximized] = useState(false);

  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  useEffect(() => {
    document.body.style.overflow = isMaximized ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isMaximized]);

  useEffect(() => {
    if (!isMaximized) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsMaximized(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isMaximized]);

  const activeChart    = hasDocs && showDocs ? full! : base;
  const activeTooltips = showDocs ? docTooltips : undefined;
  const graphBg        = isDark ? "bg-[#0d0b1f] border-[#2d2050]" : "bg-slate-50 border-slate-200";

  if (!activeChart && !full) return null;

  const toggleDocs = () => setShowDocs((v) => !v);

  const fullscreenOverlay = isMaximized && mounted
    ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[3px]"
          onClick={(e) => { if (e.target === e.currentTarget) setIsMaximized(false); }}
        >
          <div className="relative flex flex-col w-[95vw] max-w-6xl h-[85vh] bg-background rounded-2xl border shadow-2xl overflow-hidden">
            {/* accent bar */}
            <div className="h-0.5 shrink-0 bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-500" />

            {/* Toolbar */}
            <div className="flex items-center justify-between border-b px-5 py-3 shrink-0 gap-3 bg-muted/10">
              <div className="flex items-center gap-4 min-w-0 flex-wrap">
                <div className="flex items-center gap-2 shrink-0">
                  <Network className="h-4 w-4 text-violet-500" />
                  <h2 className="text-sm font-semibold">Service &amp; Decision Landscape</h2>
                </div>
                <Legend isDark={isDark} />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <DocsToggle hasDocs={hasDocs} showDocs={showDocs} docsCount={docsCount} onToggle={toggleDocs} />
                <button
                  onClick={() => setIsMaximized(false)}
                  className="inline-flex items-center justify-center rounded-lg border border-border p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                  title="Close (Esc)"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Diagram — full height, pannable */}
            <div className="flex-1 overflow-hidden p-4">
              <MermaidDiagram
                chart={activeChart || full!}
                docTooltips={activeTooltips}
                mode="pan"
                className={`h-full rounded-xl border ${graphBg} p-4`}
              />
            </div>

            <p className="text-xs text-center text-muted-foreground py-2.5 shrink-0 border-t bg-muted/5">
              Drag to pan · scroll to zoom
              {hasDocs && showDocs && " · hover doc nodes for details · click to open"}
              {" · "}Esc or click outside to close
            </p>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      {/* Trigger pill — lives in the hero stats row */}
      <button
        onClick={() => setIsMaximized(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 dark:border-violet-800/60 bg-violet-50 dark:bg-violet-950/40 px-3 py-1 text-xs font-medium text-violet-700 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/50 hover:border-violet-300 dark:hover:border-violet-700 transition-colors"
      >
        <Network className="h-3 w-3" />
        View Landscape
        <Maximize2 className="h-2.5 w-2.5 opacity-60" />
      </button>

      {fullscreenOverlay}
    </>
  );
}
