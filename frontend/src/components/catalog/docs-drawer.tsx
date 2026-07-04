"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { FileText, Plus, X, Loader2 } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const docStatusCls: Record<string, string> = {
  proposed:       "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  "under-review": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  accepted:       "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  deprecated:     "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  superseded:     "bg-gray-100 text-gray-600 dark:bg-gray-800/30 dark:text-gray-400",
};

const DOC_GROUPS = [
  {
    type:      "rfc",
    label:     "RFC",
    accentCls: "border-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-400",
    dotCls:    "bg-violet-500",
  },
  {
    type:      "adr",
    label:     "ADR",
    accentCls: "border-blue-400/30 bg-blue-400/10 text-blue-600 dark:text-blue-400",
    dotCls:    "bg-blue-500",
  },
  {
    type:      "documentation",
    label:     "Doc",
    accentCls: "border-wxops-purple/25 bg-wxops-purple/10 text-wxops-purple",
    dotCls:    "bg-wxops-purple",
  },
] as const;

interface DocItem {
  name: string;
  title?: string;
  description?: string;
  docType?: string;
  docStatus?: string;
  author?: string;
  draft?: boolean;
}

interface DocsDrawerProps {
  entityRef: string;
}

export function DocsDrawer({ entityRef }: DocsDrawerProps) {
  const [open, setOpen]       = useState(false);
  const [docs, setDocs]       = useState<DocItem[]>([]);
  const [fetched, setFetched] = useState(false);

  // Derived: drawer is open but fetch hasn't resolved yet — no separate loading state needed
  const loading = open && !fetched;

  useEffect(() => {
    if (!open || fetched) return;
    fetch("/api/catalog/entities", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) { setFetched(true); return; }
        const data = await res.json();
        const entityName = entityRef.split("/").pop() ?? "";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const related = (data.entities ?? []).filter((e: any) => {
          if (e.kind !== "Doc") return false;
          const relatedTo: string[] = e.spec?.relatedTo ?? [];
          return relatedTo.some(
            (r: string) => r === entityRef || r.split("/").pop() === entityName,
          );
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setDocs(related.map((e: any) => ({
          name:        e.metadata.name,
          title:       e.metadata.title,
          description: e.metadata.description,
          docType:     e.spec?.docType,
          docStatus:   e.spec?.docStatus,
          author:      e.spec?.author,
          draft:       e.spec?.draft,
        })));
        setFetched(true);
      })
      .catch(() => { setFetched(true); });
  }, [open, fetched, entityRef]);

  return (
    <>
      {/* Toggle button — sits in header actions row */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
          open
            ? "border-wxops-purple/40 bg-wxops-purple/10 text-wxops-purple"
            : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50",
        )}
      >
        <FileText className="h-3.5 w-3.5" />
        Show Documents
      </button>

      {open && createPortal(
        <>
          {/* Backdrop — rendered into document.body to escape any transform containing block */}
          <div
            className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />

          {/* Drawer panel */}
          <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[400px] flex-col bg-background border-l border-border shadow-2xl docs-drawer-enter">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-wxops-purple/10">
                  <FileText className="h-4 w-4 text-wxops-purple" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold leading-tight">Documents</h2>
                  {!loading && (
                    <p className="text-[10px] text-muted-foreground">
                      {docs.length} {docs.length === 1 ? "document" : "documents"} linked
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/dashboard/catalog/register?kind=Doc&relatedTo=${entityRef}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-1 rounded-md border border-wxops-purple/30 bg-wxops-purple/10 px-2.5 py-1 text-[11px] font-medium text-wxops-purple hover:bg-wxops-purple/20 transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  New
                </Link>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading documents…
                </div>
              ) : docs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted mb-4">
                    <FileText className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium">No documents linked yet</p>
                  <p className="text-xs text-muted-foreground mt-1 mb-5 max-w-[220px] leading-relaxed">
                    Create RFCs, ADRs, or runbooks linked to this entity.
                  </p>
                  <Link
                    href={`/dashboard/catalog/register?kind=Doc&relatedTo=${entityRef}`}
                    onClick={() => setOpen(false)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-wxops-purple px-3.5 py-1.5 text-xs font-medium text-white hover:bg-wxops-purple/90 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create Document
                  </Link>
                </div>
              ) : (
                <div className="space-y-5">
                  {DOC_GROUPS.map(({ type, label, accentCls, dotCls }) => {
                    const group = docs.filter((d) => (d.docType ?? "documentation") === type);
                    if (group.length === 0) return null;
                    return (
                      <div key={type}>
                        {/* Group header */}
                        <div className="flex items-center gap-2 mb-2.5">
                          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotCls)} />
                          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                            {label}
                          </span>
                          <span className="text-[10px] text-muted-foreground/50 font-mono ml-auto">
                            {group.length}
                          </span>
                        </div>

                        {/* Cards */}
                        <div className="space-y-2">
                          {group.map((doc) => {
                            const statusCls = docStatusCls[doc.docStatus ?? ""] ?? "bg-muted text-muted-foreground";
                            return (
                              <Link
                                key={doc.name}
                                href={`/dashboard/catalog/Doc/${doc.name}`}
                                onClick={() => setOpen(false)}
                                className="group block rounded-xl border border-border p-3.5 transition-all duration-150 hover:border-wxops-purple/40 hover:bg-wxops-purple/5"
                              >
                                <div className="flex items-center gap-1.5 mb-1.5">
                                  <span className={cn(
                                    "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                                    accentCls,
                                  )}>
                                    {label}
                                  </span>
                                  {doc.draft && (
                                    <span className="text-[10px] rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 px-1.5 py-0.5 font-medium">
                                      Draft
                                    </span>
                                  )}
                                  {doc.docStatus && (
                                    <span className={cn("text-[10px] rounded-full px-1.5 py-0.5 font-medium", statusCls)}>
                                      {doc.docStatus}
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm font-medium leading-snug group-hover:text-wxops-purple transition-colors">
                                  {doc.title ?? doc.name}
                                </p>
                                {doc.description && (
                                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                                    {doc.description}
                                  </p>
                                )}
                                {doc.author && (
                                  <p className="text-[10px] text-muted-foreground/70 mt-2.5 font-mono">
                                    {doc.author}
                                  </p>
                                )}
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
