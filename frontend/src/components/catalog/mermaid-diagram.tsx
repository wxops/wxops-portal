"use client";

import { useEffect, useRef, useState } from "react";

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
   *          parts of the graph. Use this when the wrapper is h-full.
   */
  mode?: "fit" | "pan";
  className?: string;
}

let initialised = false;

const statusColors: Record<string, string> = {
  proposed:      "text-amber-600 dark:text-amber-400",
  "under-review":"text-blue-600 dark:text-blue-400",
  accepted:      "text-green-600 dark:text-green-400",
  deprecated:    "text-gray-500 dark:text-gray-400",
  superseded:    "text-orange-500 dark:text-orange-400",
};

const docTypeLabel: Record<string, string> = {
  rfc:           "RFC",
  adr:           "ADR",
  documentation: "Doc",
};

export function MermaidDiagram({ chart, docTooltips, mode = "fit", className }: MermaidDiagramProps) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const [error, setError]     = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; data: DocTooltipData;
  } | null>(null);

  // Pan state — ref for the hot path, state drives cursor / transform re-render
  const [isPanning, setIsPanning] = useState(false);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panOffsetRef = useRef({ x: 0, y: 0 });

  // Reset pan when chart changes — derived-state pattern avoids setState-in-effect lint.
  // Ref mutation goes in a separate effect (refs must not be written during render).
  const [prevChart, setPrevChart] = useState(chart);
  if (chart !== prevChart) {
    setPrevChart(chart);
    setPanX(0);
    setPanY(0);
  }
  useEffect(() => {
    panOffsetRef.current = { x: 0, y: 0 };
  }, [chart]);

  const tooltipsKey = docTooltips ? JSON.stringify(docTooltips) : "";

  useEffect(() => {
    if (!chart.trim() || !containerRef.current) return;
    let cancelled = false;

    import("mermaid").then(({ default: mermaid }) => {
      if (cancelled) return;

      if (!initialised) {
        mermaid.initialize({
          startOnLoad:   false,
          theme:         "neutral",
          flowchart:     { curve: "basis", useMaxWidth: true, nodeSpacing: 25, rankSpacing: 35, padding: 8 },
          securityLevel: "loose",
          fontSize:      13,
        });
        initialised = true;
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

              if (mode === "pan") {
                // Natural content size — Mermaid stores it in style.maxWidth (e.g. "842px").
                // Use that as an explicit width so the SVG isn't forced to fill the container,
                // letting content extend beyond the viewport and be revealed by dragging.
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
  }, [chart, tooltipsKey]);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Ignore clicks on SVG links so navigation still works
    if ((e.target as HTMLElement).closest("a")) return;
    e.preventDefault();

    dragStartRef.current = {
      x: e.clientX - panOffsetRef.current.x,
      y: e.clientY - panOffsetRef.current.y,
    };
    setIsPanning(true);

    // Track on document so fast movement outside the container doesn't drop the drag
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

  if (error) {
    return (
      <p className="text-sm text-muted-foreground px-4 py-3 rounded-md border border-dashed">
        Could not render diagram.
      </p>
    );
  }

  return (
    <>
      <div
        className={`w-full overflow-hidden select-none ${className ?? ""}`}
        style={{ cursor: isPanning ? "grabbing" : "grab" }}
        onMouseDown={handleMouseDown}
        onDragStart={(e) => e.preventDefault()}
      >
        <div style={{ transform: `translate(${panX}px, ${panY}px)`, willChange: "transform" }}>
          <div ref={containerRef} />
        </div>
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
