"use client";

import { useEffect, useRef, useState } from "react";
import jsYaml from "js-yaml";

interface OpenApiViewerProps {
  // Raw YAML/JSON string from spec.definition (inline, no network call needed).
  spec?: string;
  // Backend URL to fetch the spec from when spec is absent.
  // Called with credentials so the session cookie is forwarded.
  specUrl?: string;
}

export function OpenApiViewer({ spec, specUrl }: OpenApiViewerProps) {
  const [parsed, setParsed] = useState<object | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        let raw = spec ?? null;

        if (!raw && specUrl) {
          const res = await fetch(specUrl, { credentials: "include" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          raw = await res.text();
        }

        if (!raw) {
          setLoading(false);
          return;
        }

        const obj = jsYaml.load(raw);
        if (cancelled) return;
        setParsed(obj as object);
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [spec, specUrl]);

  if (loading) {
    return (
      <div className="space-y-2 p-4">
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-4 w-2/5 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-muted-foreground px-4 py-3 rounded-md border border-dashed">
        Could not load API spec.
      </p>
    );
  }

  if (!parsed) return null;

  return <SwaggerRenderer spec={parsed} />;
}

// ── Vanilla SwaggerUIBundle mount ─────────────────────────────────────────────
// Uses swagger-ui-dist directly instead of swagger-ui-react to avoid the
// UNSAFE_componentWillMount / UNSAFE_componentWillReceiveProps warnings that
// swagger-ui-react's internal Schemes and ModelCollapse class components emit
// in React strict mode. The vanilla bundle is mounted imperatively via useEffect
// and has no React class components involved.

function SwaggerRenderer({ spec }: { spec: object }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;

    Promise.all([
      import("swagger-ui-dist/swagger-ui-bundle.js"),
      import("swagger-ui-dist/swagger-ui.css" as string),
    ]).then(([bundle]) => {
      if (cancelled || !containerRef.current) return;
      // swagger-ui-bundle.js is a UMD module; webpack wraps it so the constructor
      // lands on .default when dynamically imported as an ES module.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SwaggerUIBundle = (bundle as any).default ?? bundle;
      SwaggerUIBundle({
        spec,
        domNode: containerRef.current,
        docExpansion: "list",
        defaultModelsExpandDepth: -1,
        displayRequestDuration: true,
        tryItOutEnabled: true,
        layout: "BaseLayout",
      });
    });

    return () => {
      cancelled = true;
      el.innerHTML = "";
    };
  }, [spec]);

  return (
    <div
      ref={containerRef}
      className="swagger-ui-wrapper rounded-md border overflow-auto bg-white dark:bg-[oklch(0.10_0.014_290)]"
    />
  );
}
