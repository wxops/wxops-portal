"use client";

import { useEffect, useState } from "react";
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

// ── Lazy SwaggerUI mount ──────────────────────────────────────────────────────
// swagger-ui-react is heavy — only loaded after the spec is ready.

function SwaggerRenderer({ spec }: { spec: object }) {
  const [SwaggerUI, setSwaggerUI] =
    useState<React.ComponentType<{ spec: object }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import("swagger-ui-react"),
      import("swagger-ui-react/swagger-ui.css" as string),
    ]).then(([mod]) => {
      if (!cancelled) setSwaggerUI(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!SwaggerUI) {
    return (
      <div className="space-y-2 p-4">
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-4 w-2/5 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="swagger-ui-wrapper rounded-md border overflow-hidden bg-white dark:bg-zinc-950">
      <SwaggerUI spec={spec} />
    </div>
  );
}
