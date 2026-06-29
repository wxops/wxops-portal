"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";

export interface DocTooltipData {
  title: string;
  docType: string;
  status: string;
  description?: string;
}

interface MermaidDiagramProps {
  chart: string;
  docTooltips?: Record<string, DocTooltipData>;
  /**
   * "fit"  — SVG scales to fill container width (default, good for inline previews).
   * "pan"  — SVG renders at its natural content size so dragging reveals off-screen
   *          parts of the graph. Scroll-to-zoom enabled in this mode.
   */
  mode?: "fit" | "pan";
  className?: string;
}

let lastTheme = "";

const statusColors: Record<string, string> = {
  proposed:       "text-amber-600 dark:text-amber-400",
  "under-review": "text-blue-600 dark:text-blue-400",
  accepted:       "text-green-600 dark:text-green-400",
  deprecated:     "text-gray-500 dark:text-gray-400",
  superseded:     "text-orange-500 dark:text-orange-400",
};

const docTypeLabel: Record<string, string> = {
  rfc:           "RFC",
  adr:           "ADR",
  documentation: "Doc",
};

export function MermaidDiagram({ chart, docTooltips, mode = "fit", className }: MermaidDiagramProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef   = useRef<HTMLDivElement>(null);
  const [error, setError]     = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; data: DocTooltipData;
  } | null>(null);

  // Pan state — ref for hot path, state drives cursor / transform
  const [isPanning, setIsPanning] = useState(false);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panOffsetRef = useRef({ x: 0, y: 0 });

  // Zoom state
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);

  // Reset transform when chart changes — derived-state pattern
  const [prevChart, setPrevChart] = useState(chart);
  if (chart !== prevChart) {
    setPrevChart(chart);
    setPanX(0);
    setPanY(0);
    setScale(1);
  }
  useEffect(() => {
    panOffsetRef.current = { x: 0, y: 0 };
    scaleRef.current = 1;
  }, [chart]);

  // Non-passive wheel listener for scroll-to-zoom (pan mode only)
  useEffect(() => {
    if (mode !== "pan") return;
    const el = wrapperRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newScale = Math.max(0.15, Math.min(8, scaleRef.current * factor));

      // Zoom towards cursor: keep the content point under cursor stationary
      const contentX = (cx - panOffsetRef.current.x) / scaleRef.current;
      const contentY = (cy - panOffsetRef.current.y) / scaleRef.current;
      const newPanX  = cx - contentX * newScale;
      const newPanY  = cy - contentY * newScale;

      scaleRef.current = newScale;
      panOffsetRef.current = { x: newPanX, y: newPanY };
      setScale(newScale);
      setPanX(newPanX);
      setPanY(newPanY);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [mode]);

  const tooltipsKey = docTooltips ? JSON.stringify(docTooltips) : "";

  useEffect(() => {
    if (!chart.trim() || !containerRef.current) return;
    let cancelled = false;

    const currentTheme = isDark ? "dark" : "light";

    import("mermaid").then(({ default: mermaid }) => {
      if (cancelled) return;

      if (lastTheme !== currentTheme) {
        mermaid.initialize({
          startOnLoad:   false,
          theme:         isDark ? "dark" : "default",
          themeVariables: isDark
            ? { primaryColor: "#1e1347", lineColor: "#4b5563", textColor: "#c4b5fd" }
            : { primaryColor: "#ede9fe", lineColor: "#94a3b8", textColor: "#1e1b4b" },
          flowchart:     { curve: "basis", useMaxWidth: true, nodeSpacing: 25, rankSpacing: 35, padding: 8 },
          securityLevel: "loose",
          fontSize:      13,
        });
        lastTheme = currentTheme;
      }

      const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      mermaid
        .render(id, chart)
        .then(({ svg }) => {
          if (!cancelled && containerRef.current) {
            containerRef.current.innerHTML = svg;

            const svgEl = containerRef.current.querySelector("svg");
            if (svgEl) {
              svgEl.style.display = "block";
              svgEl.setAttribute("preserveAspectRatio", "xMinYMin meet");

              // Remove Mermaid's background rect so the container color shows through
              const bgRect = svgEl.querySelector(".background") as SVGElement | null;
              if (bgRect) bgRect.style.fill = "transparent";

              if (mode === "pan") {
                const naturalWidth = svgEl.style.maxWidth;
                svgEl.removeAttribute("width");
                svgEl.style.width    = naturalWidth || "auto";
                svgEl.style.height   = "auto";
                svgEl.style.maxWidth = "none";
              } else {
                svgEl.style.width  = "100%";
                svgEl.style.height = "auto";
              }
            }

            if (docTooltips) {
              for (const [nodeId, data] of Object.entries(docTooltips)) {
                const el = containerRef.current.querySelector(
                  `[id^="flowchart-${nodeId}-"]`,
                ) as SVGGElement | null;
                if (!el) continue;

                el.style.cursor = "pointer";
                el.addEventListener("mouseenter", () => {
                  const rect = el.getBoundingClientRect();
                  setTooltip({ x: rect.left + rect.width / 2, y: rect.top, data });
                });
                el.addEventListener("mouseleave", () => setTooltip(null));
              }
            }
          }
        })
        .catch((err) => {
          if (!cancelled) setError(String(err));
        });
    });

    return () => {
      cancelled = true;
      setTooltip(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, tooltipsKey, isDark]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("a")) return;
    if ((e.target as HTMLElement).closest("[data-zoom-ctrl]")) return;
    e.preventDefault();

    dragStartRef.current = {
      x: e.clientX - panOffsetRef.current.x,
      y: e.clientY - panOffsetRef.current.y,
    };
    setIsPanning(true);

    const onMove = (ev: MouseEvent) => {
      const newX = ev.clientX - dragStartRef.current.x;
      const newY = ev.clientY - dragStartRef.current.y;
      panOffsetRef.current = { x: newX, y: newY };
      setPanX(newX);
      setPanY(newY);
    };
    const onUp = () => {
      setIsPanning(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  function zoomBy(factor: number) {
    const newScale = Math.max(0.15, Math.min(8, scaleRef.current * factor));
    scaleRef.current = newScale;
    setScale(newScale);
  }

  function resetView() {
    scaleRef.current = 1;
    panOffsetRef.current = { x: 0, y: 0 };
    setScale(1);
    setPanX(0);
    setPanY(0);
  }

  if (error) {
    return (
      <p className="text-sm text-muted-foreground px-4 py-3 rounded-md border border-dashed">
        Could not render diagram.
      </p>
    );
  }

  const btnBase = isDark
    ? "flex h-7 w-7 items-center justify-center rounded border border-white/10 bg-black/60 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-black/80 transition-colors"
    : "flex h-7 w-7 items-center justify-center rounded border border-border bg-white/80 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-white shadow-sm transition-colors";

  return (
    <>
      <div
        ref={wrapperRef}
        className={`relative w-full overflow-hidden select-none ${className ?? ""}`}
        style={{ cursor: isPanning ? "grabbing" : "grab" }}
        onMouseDown={handleMouseDown}
        onDragStart={(e) => e.preventDefault()}
      >
        <div
          style={{
            transform:       `translate(${panX}px, ${panY}px) scale(${scale})`,
            transformOrigin: "0 0",
            willChange:      "transform",
          }}
        >
          <div ref={containerRef} />
        </div>

        {/* Zoom controls — only in pan/modal mode */}
        {mode === "pan" && (
          <div
            data-zoom-ctrl
            className="absolute bottom-3 right-3 z-10 flex items-center gap-1"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button onClick={() => zoomBy(1.25)} className={btnBase} title="Zoom in">+</button>
            <span className={`min-w-[42px] text-center text-xs font-mono text-muted-foreground backdrop-blur-sm rounded border px-1.5 py-1 select-none ${isDark ? "bg-black/60 border-white/10" : "bg-white/80 border-border shadow-sm"}`}>
              {Math.round(scale * 100)}%
            </span>
            <button onClick={() => zoomBy(1 / 1.25)} className={btnBase} title="Zoom out">−</button>
            <button onClick={resetView} className={btnBase} title="Reset view">↺</button>
          </div>
        )}
      </div>

      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left:      tooltip.x,
            top:       tooltip.y - 8,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="rounded-lg border bg-popover shadow-lg px-3 py-2.5 text-xs max-w-[240px]">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="font-semibold uppercase tracking-wide text-[10px] bg-muted px-1.5 py-0.5 rounded">
                {docTypeLabel[tooltip.data.docType] ?? tooltip.data.docType}
              </span>
              <span className={`font-medium ${statusColors[tooltip.data.status] ?? "text-muted-foreground"}`}>
                {tooltip.data.status}
              </span>
            </div>
            <p className="font-medium text-foreground leading-snug">
              {tooltip.data.title}
            </p>
            {tooltip.data.description && (
              <p className="text-muted-foreground mt-1 leading-snug line-clamp-2">
                {tooltip.data.description}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
