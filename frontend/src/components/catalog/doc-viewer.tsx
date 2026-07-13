"use client";

import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { Maximize2, X } from "lucide-react";
import { MermaidDiagram } from "./mermaid-diagram";
import { slugifyHeading } from "@/lib/doc-utils";

interface DocViewerProps {
  content: string;
}

/**
 * Pre-scan the raw markdown string and return a Map<byteOffset → id>.
 * Byte offsets match the position.start.offset values that remark/rehype
 * attach to AST nodes, so the rehype plugin can look up the correct slug.
 */
function buildHeadingIdMap(content: string): Map<number, string> {
  const map    = new Map<number, string>();
  const counts: Record<string, number> = {};
  let offset   = 0;
  let inCode   = false;

  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("```")) {
      inCode = !inCode;
    } else if (!inCode) {
      const m = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/);
      if (m) {
        const raw  = m[2].trim().replace(/[*_`~]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
        const base = slugifyHeading(raw);
        counts[base] = (counts[base] ?? 0) + 1;
        const id   = counts[base] === 1 ? base : `${base}-${counts[base] - 1}`;
        map.set(offset, id);
      }
    }
    offset += line.length + 1; // +1 for the \n
  }

  return map;
}

/**
 * Returns a rehype plugin that stamps `id` directly onto heading AST nodes
 * (via node.properties.id) before hast-util-to-jsx-runtime converts them to
 * React elements. This means `id` arrives as a plain prop in the component
 * — no dependency on node.position being available inside the render function.
 */
function createRehypeHeadingIds(idMap: Map<number, string>) {
  return function rehypeHeadingIds() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return function transformer(tree: any) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function walk(node: any) {
        if (node.type === "element" && /^h[1-6]$/.test(node.tagName)) {
          const id = idMap.get(node.position?.start?.offset ?? -1);
          if (id) {
            node.properties = node.properties ?? {};
            node.properties.id = id;
          }
        }
        for (const child of node.children ?? []) walk(child);
      }
      walk(tree);
    };
  };
}

// Inline mermaid wrapper — shows diagram at fit size with an expand button.
// Clicking expand opens a full-screen pan/zoom modal via createPortal.
function MermaidBlock({ chart }: { chart: string }) {
  const [open, setOpen] = useState(false);
  const mounted         = useSyncExternalStore(() => () => {}, () => true, () => false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <>
      <div className="group relative mb-4 rounded-lg border border-border bg-muted/30 p-4 overflow-x-auto">
        <MermaidDiagram chart={chart} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Expand diagram"
          className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded border border-border bg-background/80 backdrop-blur-sm text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {mounted && open && createPortal(
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
            <span className="text-sm font-medium text-foreground">Diagram</span>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Drag to pan · Scroll to zoom</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <MermaidDiagram chart={chart} mode="pan" className="h-full" />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// Heading components receive `id` from node.properties (set by the rehype plugin).
// All other styling lives here; no AST traversal needed at render time.
const markdownComponents: Components = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h1: ({ id, children }: any) => (
    <h1 id={id} className="text-2xl font-bold mt-8 mb-4 text-foreground border-b border-border pb-3 scroll-mt-20">
      {children}
    </h1>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h2: ({ id, children }: any) => (
    <h2 id={id} className="text-xl font-semibold mt-7 mb-3 text-foreground scroll-mt-20">
      {children}
    </h2>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h3: ({ id, children }: any) => (
    <h3 id={id} className="text-lg font-medium mt-6 mb-2 text-foreground scroll-mt-20">
      {children}
    </h3>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h4: ({ id, children }: any) => (
    <h4 id={id} className="text-base font-semibold mt-5 mb-2 text-foreground scroll-mt-20">
      {children}
    </h4>
  ),
    p: ({ children }) => (
      <p className="text-[15px] text-foreground leading-7 mb-4">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="list-disc list-outside pl-6 text-[15px] mb-4 space-y-1.5">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal list-outside pl-6 text-[15px] mb-4 space-y-1.5">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="text-[15px] text-foreground leading-7">{children}</li>,
    pre: ({ children }) => {
      const child = Array.isArray(children) ? children[0] : children;
      // If the code renderer already returned a MermaidBlock, skip the <pre> wrapper.
      if (child && typeof child === "object" && "type" in child && (child as React.ReactElement).type === MermaidBlock) {
        return <>{children}</>;
      }
      return (
        <pre className="bg-muted rounded-lg p-4 overflow-x-auto mb-4 text-sm font-mono border border-border leading-relaxed">
          {children}
        </pre>
      );
    },
    code: ({ className, children }) => {
      if (className?.includes("language-mermaid")) {
        const chart = String(children).replace(/\n$/, "");
        return <MermaidBlock chart={chart} />;
      }
      return (
        <code className="bg-muted px-1.5 py-0.5 rounded text-[13px] font-mono border border-border/50">
          {children}
        </code>
      );
    },
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-primary/40 pl-5 text-[15px] text-muted-foreground italic mb-4 py-1">
        {children}
      </blockquote>
    ),
    table: ({ children }) => (
      <div className="overflow-x-auto mb-4 rounded-lg border border-border">
        <table className="text-sm border-collapse w-full">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
    th: ({ children }) => (
      <th className="border-b border-border px-4 py-2 font-semibold text-left text-sm">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-b border-border px-4 py-2 text-sm">{children}</td>
    ),
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:text-primary/80"
      >
        {children}
      </a>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    em: ({ children }) => <em className="italic">{children}</em>,
    hr: () => <hr className="border-border my-6" />,
};

export function DocViewer({ content }: DocViewerProps) {
  const idMap        = useMemo(() => buildHeadingIdMap(content), [content]);
  const rehypePlugin = useMemo(() => createRehypeHeadingIds(idMap), [idMap]);

  return (
    <div className="min-w-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypePlugin]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
