"use client";

import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";

// Dynamically imported with SSR disabled — SwaggerUI accesses browser DOM at
// module load time and will throw during server rendering.
const SwaggerUI = dynamic(() => import("swagger-ui-react"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
      Loading API documentation…
    </div>
  ),
});

interface SwaggerViewerProps {
  /** Same-origin URL that serves the raw OpenAPI JSON/YAML spec. */
  specUrl: string;
}

export function SwaggerViewer({ specUrl }: SwaggerViewerProps) {
  return (
    <div className="swagger-portal-wrapper rounded-lg border overflow-hidden bg-white text-black">
      <SwaggerUI
        url={specUrl}
        docExpansion="list"
        defaultModelsExpandDepth={-1}
        displayRequestDuration
        tryItOutEnabled
      />
    </div>
  );
}
