"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { FileText, Maximize2, X } from "lucide-react";
import { useTheme } from "next-themes";
import { MermaidDiagram, type DocTooltipData } from "./mermaid-diagram";

interface GraphPanelProps {
  /** Graph without Doc nodes — the default clean view (dark theme). */
  chartBase: string;
  /** Graph including Doc nodes (dark theme). */
  chartWithDocs?: string;
  /** Light theme variants. */
  chartBaseLight?: string;
  chartWithDocsLight?: string;
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

function Legend({ isDark }: { isDark: boolean }) {
  const s = isDark
    ? { svc: "bg-[#1e1347] border-[#8b5cf6]", api: "bg-[#0c3547] border-[#22d3ee]", res: "bg-[#161550] border-[#818cf8]", rfc: "bg-[#1e1347] border-dashed border-[#a78bfa]", adr: "bg-[#0c1f4a] border-[#60a5fa]", doc: "bg-[#082a18] border-[#34d399]" }
    : { svc: "bg-[#ede9fe] border-[#7c3aed]", api: "bg-[#e0f2fe] border-[#0891b2]", res: "bg-[#e0e7ff] border-[#6366f1]", rfc: "bg-[#ede9fe] border-dashed border-[#8b5cf6]", adr: "bg-[#dbeafe] border-[#3b82f6]", doc: "bg-[#d1fae5] border-[#10b981]" };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1"><span className={`inline-block w-3 h-3 rounded-sm border ${s.svc}`} />Service</span>
      <span className="inline-flex items-center gap-1"><span className={`inline-block w-3 h-3 rounded-full border ${s.api}`} />API</span>
      <span className="inline-flex items-center gap-1"><span className={`inline-block w-3 h-3 rounded-sm border ${s.res}`} />Resource</span>
      <span className="text-muted-foreground/30 mx-0.5">|</span>
      <span className="inline-flex items-center gap-1"><span className={`inline-block w-3 h-3 rounded-sm border ${s.rfc}`} />RFC</span>
      <span className="inline-flex items-center gap-1"><span className={`inline-block w-3 h-3 rounded-sm border ${s.adr}`} />ADR</span>
      <span className="inline-flex items-center gap-1"><span className={`inline-block w-3 h-3 rounded-sm border ${s.doc}`} />Doc</span>
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
  const graphBg = isDark ? "bg-[#0d0b1f] border-[#2d2050]" : "bg-white border-border";
  const fadeBg  = isDark ? "from-[#0d0b1f]" : "from-white";

  if (!activeChart && !full) return null;

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
                <Legend isDark={isDark} />
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
                chart={activeChart || full!}
                docTooltips={activeTooltips}
                mode="pan"
                className={`h-full rounded-lg border ${graphBg} p-3`}
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
            {hasDocs && <Legend isDark={isDark} />}
          </div>
          <DocsToggle hasDocs={hasDocs} showDocs={showDocs} docsCount={docsCount} onToggle={toggleDocs} />
        </div>

        {/* Inline preview — click ⊕ to open modal */}
        <div className={`relative group rounded-lg border ${graphBg}`}>
          <div className="overflow-hidden max-h-64 p-4">
            <MermaidDiagram
              chart={activeChart || full!}
              docTooltips={activeTooltips}
            />
          </div>

          {/* Bottom fade hint */}
          <div className={`absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t ${fadeBg} to-transparent pointer-events-none rounded-b-lg`} />

          {/* Expand button */}
          <button
            onClick={() => setIsMaximized(true)}
            className={`absolute top-2 right-2 opacity-0 group-hover:opacity-100 inline-flex items-center justify-center rounded-md border backdrop-blur-sm p-1.5 text-muted-foreground hover:text-foreground shadow-sm transition-all ${isDark ? "border-white/10 bg-black/60" : "border-border bg-white/80"}`}
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
