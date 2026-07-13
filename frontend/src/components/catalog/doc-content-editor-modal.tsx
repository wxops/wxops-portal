"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Copy,
  Check,
  Loader2,
  Eye,
  Pencil,
  Columns2,
  GitBranch,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DocViewer } from "./doc-viewer";
import type { Entity } from "@/lib/types";

interface DocContentEditorModalProps {
  entity: Entity;
  onClose: () => void;
}

type ViewMode = "write" | "preview" | "split";

export function DocContentEditorModal({ entity, onClose }: DocContentEditorModalProps) {
  const mounted                    = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [content, setContent]     = useState("");
  const [original, setOriginal]   = useState("");
  const [loading, setLoading]     = useState(true);
  const [fetchErr, setFetchErr]   = useState<string | null>(null);
  const [viewMode, setViewMode]   = useState<ViewMode>("split");
  const [copied, setCopied]       = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const textareaRef               = useRef<HTMLTextAreaElement>(null);

  // Escape closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Focus editor on open
  useEffect(() => {
    if (!loading && viewMode !== "preview") {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [loading, viewMode]);

  // Fetch current content
  useEffect(() => {
    fetch(
      `/api/catalog/entities/${entity.kind}/${entity.metadata.name}/content`,
      { credentials: "include" },
    )
      .then(async (res) => {
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          setFetchErr(j?.error ?? `HTTP ${res.status}`);
          return;
        }
        const text = await res.text();
        setContent(text);
        setOriginal(text);
      })
      .catch((err) => setFetchErr(String(err)))
      .finally(() => setLoading(false));
  }, [entity.kind, entity.metadata.name]);

  // Tab key → insert 2 spaces
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end   = el.selectionEnd;
      const next  = content.slice(0, start) + "  " + content.slice(end);
      setContent(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2;
      });
    }
  }, [content]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isDirty = content !== original;
  const filePath = parseFilePath(entity.spec.contentUrl ?? "");
  const branchName = `docs/${entity.metadata.name.replace(/[^a-z0-9-]/g, "-")}`;

  const commitSteps = [
    { cmd: `git checkout -b ${branchName}`, label: "Create branch" },
    { cmd: `# Paste your copied content into: ${filePath || entity.metadata.name + ".md"}`, label: "Paste content" },
    { cmd: `git add ${filePath || "."} && git commit -m "docs: update ${entity.metadata.name}"`, label: "Commit" },
    { cmd: `git push origin ${branchName}`, label: "Push & open PR" },
  ];

  const panel = (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-background px-5 py-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <Pencil className="h-4 w-4 text-wxops-purple" />
          <div>
            <h2 className="text-sm font-semibold leading-tight">
              Edit Content — {entity.metadata.title ?? entity.metadata.name}
            </h2>
            {filePath && (
              <p className="text-[10px] font-mono text-muted-foreground">{filePath}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggles */}
          <div className="flex items-center rounded-md border border-border overflow-hidden">
            {(["write", "split", "preview"] as ViewMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setViewMode(m)}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                  viewMode === m
                    ? "bg-wxops-purple/10 text-wxops-purple"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                {m === "write"   && <Pencil  className="h-3 w-3" />}
                {m === "split"   && <Columns2 className="h-3 w-3" />}
                {m === "preview" && <Eye     className="h-3 w-3" />}
                <span className="capitalize">{m}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading content…
          </div>
        ) : fetchErr ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
            <p className="text-sm text-muted-foreground">Could not load content</p>
            <p className="text-xs font-mono text-red-500 dark:text-red-400">{fetchErr}</p>
            <p className="text-xs text-muted-foreground/70">
              Set a <code className="font-mono">contentUrl</code> on this document first.
            </p>
          </div>
        ) : (
          <div
            className={cn(
              "h-full",
              viewMode === "split"   && "grid grid-cols-2 divide-x divide-border",
              viewMode === "write"   && "flex",
              viewMode === "preview" && "flex overflow-y-auto",
            )}
          >
            {/* Editor pane */}
            {viewMode !== "preview" && (
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                className={cn(
                  "h-full resize-none bg-muted/20 p-5 font-mono text-sm leading-7",
                  "focus:outline-none placeholder:text-muted-foreground/50",
                  viewMode === "write" && "w-full",
                  viewMode === "split" && "min-w-0",
                )}
                placeholder="Start writing markdown here…"
              />
            )}

            {/* Preview pane */}
            {viewMode !== "write" && (
              <div
                className={cn(
                  "overflow-y-auto",
                  viewMode === "preview" && "w-full px-10 py-8 max-w-4xl mx-auto",
                  viewMode === "split"   && "min-w-0 px-8 py-6",
                )}
              >
                {content.trim() ? (
                  <DocViewer content={content} />
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    Nothing to preview yet.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {!loading && !fetchErr && (
        <div className="border-t bg-background shrink-0">
          {/* Main action row */}
          <div className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {isDirty ? (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 inline-block" />
                  Unsaved changes
                </span>
              ) : (
                <span className="text-muted-foreground/60">No changes</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  copied
                    ? "border-green-400 bg-green-50 text-green-700 dark:border-green-600 dark:bg-green-900/20 dark:text-green-400"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied!" : "Copy Markdown"}
              </button>

              <button
                type="button"
                onClick={() => setGuideOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-md bg-wxops-purple px-3 py-1.5 text-xs font-medium text-white hover:bg-wxops-purple/90 transition-colors"
              >
                <GitBranch className="h-3.5 w-3.5" />
                Commit via Git
                {guideOpen ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </button>
            </div>
          </div>

          {/* Collapsible git guide */}
          {guideOpen && (
            <div className="border-t px-5 py-4 bg-muted/30 space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Copy your edited content above, then follow these steps to open a Pull Request:
              </p>
              <div className="space-y-2">
                {commitSteps.map((step, i) => (
                  <CommitStep key={i} number={i + 1} label={step.label} cmd={step.cmd} />
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed pt-1">
                Once merged, the portal picks up the new content automatically.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (!mounted) return null;
  return createPortal(panel, document.body);
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function parseFilePath(url: string): string {
  if (!url) return "";
  if (!url.startsWith("http")) return url;
  try {
    const parts = new URL(url).pathname.split("/");
    const idx = parts.findIndex((p) => p === "src" || p === "raw");
    if (idx < 0) return "";
    return parts.slice(idx + 3).join("/");
  } catch {
    return "";
  }
}

function CommitStep({ number, label, cmd }: { number: number; label: string; cmd: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-start gap-2.5">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-wxops-purple/15 text-wxops-purple text-[9px] font-bold mt-0.5">
        {number}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
        <div className="group relative rounded-md border border-border bg-background px-2.5 py-1.5 pr-8 font-mono text-[11px] leading-relaxed break-all">
          {cmd}
          <button
            type="button"
            onClick={handleCopy}
            className="absolute right-1 top-1 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
          >
            {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      </div>
    </div>
  );
}
