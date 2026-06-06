"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { FileText, Maximize2, X } from "lucide-react";
import { MermaidDiagram, type DocTooltipData } from "./mermaid-diagram";

interface GraphPanelProps {
  /** Graph without Doc nodes — the default clean view. */
  chartBase: string;
  /** Graph including Doc nodes, shown when "Show decisions" is toggled on. */
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
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded-sm bg-[#1e1347] border border-[#8b5cf6]" />
      Service
    </span>
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded-full bg-[#0c3547] border border-[#22d3ee]" />
      API
    </span>
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded-sm bg-[#161550] border border-[#818cf8]" />
      Resource
    </span>
    <span className="text-muted-foreground/30 mx-0.5">|</span>
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded-sm bg-[#1e1347] border border-dashed border-[#a78bfa]" />
      RFC
    </span>
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded-sm bg-[#0c1f4a] border border-[#60a5fa]" />
      ADR
    </span>
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded-sm bg-[#082a18] border border-[#34d399]" />
      Doc
    </span>
  </div>
);

// Dark graph canvas — matches the Mermaid dark theme background
const GRAPH_BG = "bg-[#0d0b1f] border-[#2d2050]";

export function GraphPanel({
  chartBase,
  chartWithDocs,
  docTooltips,
  docsCount = 0,
}: GraphPanelProps) {
  const hasDocs = !!chartWithDocs && chartWithDocs !== chartBase && docsCount > 0;

  const [showDocs, setShowDocs]       = useState(!chartBase);
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

  const activeChart    = hasDocs && showDocs ? chartWithDocs! : chartBase;
  const activeTooltips = showDocs ? docTooltips : undefined;

  if (!activeChart && !chartWithDocs) return null;

  const toggleDocs = () => setShowDocs((v) => !v);

  const fullscreenOverlay = isMaximized && mounted
    ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
          onClick={(e) => { if (e.target === e.currentTarget) setIsMaximized(false); }}
        >
          <div className="relative flex flex-col w-[90vw] max-w-5xl h-[75vh] bg-background rounded-xl border shadow-2xl overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between border-b px-4 py-2.5 shrink-0 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
                  Decision &amp; Service Graph
                </h2>
                <Legend />
              </div>
              <div className="flex items-center gap-2 shrink-0">
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

            {/* Diagram */}
            <div className="flex-1 overflow-hidden p-3">
              <MermaidDiagram
                chart={activeChart || chartWithDocs!}
                docTooltips={activeTooltips}
                mode="pan"
                className={`h-full rounded-lg border ${GRAPH_BG} p-3`}
              />
            </div>

            <p className="text-xs text-center text-muted-foreground py-2 shrink-0 border-t">
              Drag to pan · scroll to zoom
              {hasDocs && showDocs && " · hover doc nodes for details · click to open"}
              {" · "}press Esc or click outside to close
            </p>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Decision &amp; Service Graph
            </h2>
            {showDocs && hasDocs && <Legend />}
          </div>
          <DocsToggle hasDocs={hasDocs} showDocs={showDocs} docsCount={docsCount} onToggle={toggleDocs} />
        </div>

        {/* Inline preview — click ⊕ to open modal */}
        <div className={`relative group rounded-lg border ${GRAPH_BG}`}>
          <div className="overflow-hidden max-h-64 p-4">
            <MermaidDiagram
              chart={activeChart || chartWithDocs!}
              docTooltips={activeTooltips}
            />
          </div>

          {/* Bottom fade hint */}
          <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#0d0b1f] to-transparent pointer-events-none rounded-b-lg" />

          {/* Expand button */}
          <button
            onClick={() => setIsMaximized(true)}
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 inline-flex items-center justify-center rounded-md border border-white/10 bg-black/60 backdrop-blur-sm p-1.5 text-muted-foreground hover:text-foreground shadow-sm transition-all"
            title="Expand graph"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Expand to pan and zoom
          {hasDocs && " · toggle decisions to see RFC/ADR context"}
        </p>
      </section>

      {fullscreenOverlay}
    </>
  );
}
