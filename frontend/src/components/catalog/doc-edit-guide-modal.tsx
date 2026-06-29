"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Copy, Check, GitBranch, Terminal } from "lucide-react";
import type { Entity } from "@/lib/types";

interface DocEditGuideModalProps {
  entity: Entity;
  onClose: () => void;
}

function branchName(entity: Entity): string {
  const slug = entity.metadata.name.replace(/[^a-z0-9-]/g, "-");
  return `docs/${slug}`;
}

function commitMessage(entity: Entity): string {
  const docType = entity.spec.docType ?? "doc";
  return `docs(${docType}): update ${entity.metadata.name}`;
}

function parseContentUrl(url: string): { repoUrl: string; repoName: string; filePath: string } | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/");
    const srcIdx = parts.indexOf("src");
    if (srcIdx < 3) return null;
    const owner = parts[srcIdx - 2];
    const repo = parts[srcIdx - 1];
    const filePath = parts.slice(srcIdx + 3).join("/");
    const repoUrl = `${u.origin}/${owner}/${repo}`;
    return { repoUrl, repoName: repo, filePath };
  } catch {
    return null;
  }
}

export function DocEditGuideModal({ entity, onClose }: DocEditGuideModalProps) {
  const branch = useMemo(() => branchName(entity), [entity]);
  const message = useMemo(() => commitMessage(entity), [entity]);
  const contentUrl = entity.spec.contentUrl ?? "";
  const parsed = useMemo(() => parseContentUrl(contentUrl), [contentUrl]);

  const repoUrl = parsed?.repoUrl ?? "<your-gitea-url>/<org>/<repo>";
  const repoName = parsed?.repoName ?? "repo";
  const filePath = parsed?.filePath ?? `docs/${entity.metadata.name}.md`;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const steps = [
    {
      title: "Clone the repository",
      description: "If you haven't cloned it yet:",
      command: `git clone ${repoUrl}.git && cd ${repoName}`,
    },
    {
      title: "Create a new branch",
      description: "Branch off main with a descriptive name:",
      command: `git checkout -b ${branch}`,
    },
    {
      title: "Edit the document",
      description: `Open the file in your preferred editor:`,
      commands: [
        { label: "VS Code", command: `code ${filePath}` },
        { label: "Vim", command: `vim ${filePath}` },
        { label: "Nano", command: `nano ${filePath}` },
      ],
    },
    {
      title: "Stage and commit your changes",
      description: "Use the recommended commit message:",
      command: `git add ${filePath} && git commit -m "${message}"`,
    },
    {
      title: "Push and open a Pull Request",
      description: "Push your branch — the portal will create a PR for review:",
      command: `git push origin ${branch}`,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border bg-background shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-5 py-3">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-wxops-purple" />
            <h3 className="text-sm font-semibold">Edit Document Content</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs text-muted-foreground">
            Document content lives in the git repository. Follow these steps to
            edit <span className="font-mono text-foreground">{entity.metadata.name}</span> and
            open a Pull Request for review.
          </p>

          {/* File path hint */}
          <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 space-y-1.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
              File path
            </p>
            <CopyableCode code={filePath} />
            {contentUrl && (
              <a
                href={contentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                Open in Gitea →
              </a>
            )}
          </div>
        </div>

        {/* Steps */}
        <div className="px-5 pb-5 space-y-4">
          {steps.map((step, i) => (
            <div key={i} className="relative pl-7">
              {/* Step number */}
              <div className="absolute left-0 top-0 flex h-5 w-5 items-center justify-center rounded-full bg-wxops-purple/10 text-wxops-purple text-[10px] font-bold">
                {i + 1}
              </div>
              {/* Connector line */}
              {i < steps.length - 1 && (
                <div className="absolute left-[9px] top-5 bottom-[-16px] w-px bg-border" />
              )}

              <p className="text-sm font-medium leading-tight">{step.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                {step.description}
              </p>

              {"command" in step && step.command && (
                <CopyableCode code={step.command} />
              )}

              {"commands" in step && step.commands && (
                <div className="space-y-1.5">
                  {step.commands.map((c) => (
                    <div key={c.label} className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground w-14 shrink-0">
                        {c.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <CopyableCode code={c.command} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="border-t px-5 py-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <Terminal className="inline h-3 w-3 mr-1 -mt-0.5" />
            After pushing, open a Pull Request in Gitea. Once merged, the portal
            will pick up the changes automatically. You can preview the rendered
            document here before merging.
          </p>
        </div>
      </div>
    </div>
  );
}

function CopyableCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative rounded-md border border-border bg-muted/40 px-3 py-2 pr-9 font-mono text-xs leading-relaxed break-all">
      {code}
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-1.5 top-1.5 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground hover:bg-muted"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
