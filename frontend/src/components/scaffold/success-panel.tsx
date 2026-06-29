"use client";

import Link from "next/link";
import { CheckCircle, ExternalLink, BookOpen, GitPullRequest, Clock, ArrowRight } from "lucide-react";

interface SuccessPanelProps {
  repoUrl: string;
  status: string;
  appName: string;
  team: string;
}

export function SuccessPanel({ repoUrl, status, appName, team }: SuccessPanelProps) {
  const isLocal = repoUrl.startsWith("file://");

  return (
    <div className="mx-auto max-w-lg text-center space-y-6 py-8">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
        <CheckCircle className="h-8 w-8 text-green-500" />
      </div>

      <div>
        <h2 className="text-xl font-bold">Project Created</h2>
        <p className="mt-1 text-muted-foreground">
          <span className="font-mono text-foreground">{team}/{appName}</span> has
          been scaffolded successfully.
        </p>
      </div>

      {/* What was created */}
      <div className="rounded-lg border border-border bg-muted/20 p-4 text-left space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">What was created</p>
        <ul className="text-sm space-y-1 text-muted-foreground">
          <li className="flex items-center gap-2">
            <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
            Repository <span className="font-mono text-foreground">{team}/{appName}</span>
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
            XTenantApp + catalog entities committed
          </li>
          {!isLocal && (
            <li className="flex items-center gap-2">
              <GitPullRequest className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              {status}
            </li>
          )}
        </ul>
      </div>

      {/* Git-flow status */}
      {!isLocal && (
        <div className="rounded-lg border border-border bg-muted/10 p-4 text-left space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Next Steps — Git Flow</p>
          <div className="flex items-center gap-2">
            {/* develop — active */}
            <div className="flex-1 rounded-md border-2 border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950/30 px-2.5 py-2 text-center">
              <p className="text-[10px] font-bold text-blue-700 dark:text-blue-400">develop</p>
              <p className="text-[9px] text-blue-600/70 dark:text-blue-400/60 mt-0.5">template pushed</p>
              <div className="mt-1 flex justify-center">
                <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-500 text-white px-1.5 py-0.5 text-[8px] font-semibold">
                  <span className="h-1 w-1 rounded-full bg-white animate-pulse" />
                  building dev-*
                </span>
              </div>
            </div>

            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />

            {/* staging — waiting */}
            <div className="flex-1 rounded-md border border-border bg-muted/20 px-2.5 py-2 text-center opacity-50">
              <p className="text-[10px] font-bold text-muted-foreground">staging</p>
              <p className="text-[9px] text-muted-foreground/60 mt-0.5">empty branch</p>
              <div className="mt-1 flex justify-center">
                <span className="inline-flex rounded-full bg-muted px-1.5 py-0.5 text-[8px] text-muted-foreground">
                  waiting for PR
                </span>
              </div>
            </div>

            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />

            {/* main — waiting */}
            <div className="flex-1 rounded-md border border-border bg-muted/20 px-2.5 py-2 text-center opacity-50">
              <p className="text-[10px] font-bold text-muted-foreground">main</p>
              <p className="text-[9px] text-muted-foreground/60 mt-0.5">catalog entities</p>
              <div className="mt-1 flex justify-center">
                <span className="inline-flex rounded-full bg-muted px-1.5 py-0.5 text-[8px] text-muted-foreground">
                  waiting for release
                </span>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            CI is building your first <code className="font-mono bg-muted rounded px-0.5">dev-*</code> image.
            When ready, open a PR from <strong>develop → staging</strong> to create your first release candidate.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {!isLocal ? (
          <>
            <a
              href={repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-lg border border-wxops-purple/40 bg-wxops-purple/5 px-4 py-2.5 text-sm font-medium text-wxops-purple transition-colors hover:bg-wxops-purple/10"
            >
              Open Repository
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 px-3 py-2 text-left">
              <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                A platform review PR has been opened automatically.
                The service will appear in the catalog after it is merged.
                ArgoCD will then provision it automatically.
              </p>
            </div>
          </>
        ) : (
          <>
            <Link
              href={`/dashboard/catalog/Component/${appName}`}
              className="flex items-center justify-center gap-2 rounded-lg border border-wxops-purple/40 bg-wxops-purple/5 px-4 py-2.5 text-sm font-medium text-wxops-purple transition-colors hover:bg-wxops-purple/10"
            >
              <BookOpen className="h-3.5 w-3.5" />
              View in Catalog
            </Link>
            <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2 font-mono">
              Local dev mode — manifests written to disk.
              <br />
              Catalog entity available after cache refresh (~5 min or restart).
            </p>
          </>
        )}
      </div>

      <div className="flex justify-center gap-3">
        <Link
          href="/dashboard/scaffold"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
        >
          Back to Scaffold
        </Link>
        <Link
          href="/dashboard/activity"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
        >
          View Activity
        </Link>
      </div>
    </div>
  );
}
