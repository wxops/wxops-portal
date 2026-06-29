"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { MermaidDiagram } from "./mermaid-diagram";

interface DocViewerProps {
  content: string;
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-2xl font-bold mt-8 mb-4 text-foreground border-b border-border pb-3">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xl font-semibold mt-7 mb-3 text-foreground">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-medium mt-6 mb-2 text-foreground">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-base font-semibold mt-5 mb-2 text-foreground">
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
    // Check if the child is a mermaid code block — if so, skip the <pre> wrapper
    // since MermaidDiagram renders its own container.
    const child = Array.isArray(children) ? children[0] : children;
    if (
      child &&
      typeof child === "object" &&
      "props" in child &&
      typeof child.props?.className === "string" &&
      child.props.className.includes("language-mermaid")
    ) {
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
      return (
        <div className="mb-4 rounded-lg border border-border bg-muted/30 p-4 overflow-x-auto">
          <MermaidDiagram chart={chart} />
        </div>
      );
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
  return (
    <div className="min-w-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
