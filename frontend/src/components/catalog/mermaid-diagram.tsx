"use client";

import { useEffect, useRef, useState } from "react";

interface MermaidDiagramProps {
  chart: string;
}

// Global init flag — mermaid only needs to be initialised once per page load.
let initialised = false;

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!chart.trim() || !containerRef.current) return;

    let cancelled = false;

    import("mermaid").then(({ default: mermaid }) => {
      if (cancelled) return;

      if (!initialised) {
        mermaid.initialize({
          startOnLoad: false,
          theme: "neutral",
          flowchart: { curve: "basis", useMaxWidth: true },
          securityLevel: "loose",
        });
        initialised = true;
      }

      // Unique ID per render to avoid mermaid caching stale SVG.
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      mermaid
        .render(id, chart)
        .then(({ svg }) => {
          if (!cancelled && containerRef.current) {
            containerRef.current.innerHTML = svg;
            // Make the SVG fill the container width instead of being fixed.
            const svgEl = containerRef.current.querySelector("svg");
            if (svgEl) {
              svgEl.style.width = "100%";
              svgEl.style.height = "auto";
            }
          }
        })
        .catch((err) => {
          if (!cancelled) setError(String(err));
        });
    });

    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (error) {
    return (
      <p className="text-sm text-muted-foreground px-4 py-3 rounded-md border border-dashed">
        Could not render diagram.
      </p>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full overflow-x-auto rounded-md"
    />
  );
}
