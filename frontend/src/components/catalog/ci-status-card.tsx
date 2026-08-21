"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle, XCircle, AlertCircle, Clock, Loader2, ExternalLink, GitBranch, GitCommit, Tag, Timer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CIRunsPanel } from "@/components/catalog/ci-runs-panel";
import { useActiveEntityTab } from "@/components/catalog/entity-tabs";

interface CIStatusCardProps {
  entityKind: string;
  entityName: string;
}

export interface WorkflowRun {
  id: number;
  display_title: string;
  status: string;
  conclusion: string;
  event: string;
  html_url: string;
  head_branch: string;
  head_sha: string;
  path: string;
  run_number: number;
  started_at: string;
  completed_at: string;
}

function looksLikeTag(ref: string): boolean {
  if (!ref) return false;
  return /^v?\d+(\.\d+){0,2}/.test(ref);
}

function isTagRun(run: WorkflowRun): boolean {
  if (run.event === "release" || run.event === "create") return true;
  if (looksLikeTag(run.head_branch)) return true;
  return false;
}

function timeAgo(dateStr: string): string | null {
  if (!dateStr) return null;
  const ts = new Date(dateStr).getTime();
  if (isNaN(ts)) return null;
  const diff = Date.now() - ts;
  if (diff < 0) return null;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function duration(start: string, end: string): string | null {
  if (!start || !end) return null;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (isNaN(s) || isNaN(e)) return null;
  const diff = e - s;
  if (diff <= 0) return null;
  const secs = Math.floor(diff / 1000);
  if (secs < 1) return null;
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function StatusIcon({ status, conclusion }: { status: string; conclusion: string }) {
  if (status === "running" || status === "waiting") {
    return <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />;
  }
  if (conclusion === "success") {
    return <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />;
  }
  if (conclusion === "failure") {
    return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
  }
  return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
}

function statusColor(status: string, conclusion: string): string {
  if (status === "running" || status === "waiting") return "bg-amber-500";
  if (conclusion === "success") return "bg-green-500";
  if (conclusion === "failure") return "bg-red-500";
  if (conclusion === "skipped") return "bg-slate-400";
  return "bg-muted-foreground";
}

function StatusBadge({ status, conclusion }: { status: string; conclusion: string }) {
  const label = status === "running" ? "running" : status === "waiting" ? "queued" : conclusion || status;
  const colors =
    status === "running" || status === "waiting"
      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
      : conclusion === "success"
        ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
        : conclusion === "failure"
          ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
          : conclusion === "skipped"
            ? "bg-slate-100 text-slate-600 dark:bg-slate-800/30 dark:text-slate-400"
            : "bg-muted text-muted-foreground";

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${colors}`}>
      {label}
    </span>
  );
}

export function RunRow({ run }: { run: WorkflowRun }) {
  const ago = timeAgo(run.started_at || run.completed_at);
  const dur = run.completed_at ? duration(run.started_at, run.completed_at) : null;
  const isTag = isTagRun(run);
  const shortSha = run.head_sha ? run.head_sha.slice(0, 7) : "";

  return (
    <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
      <StatusIcon status={run.status} conclusion={run.conclusion} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {run.display_title}
          {run.run_number > 0 && <span className="text-muted-foreground font-normal"> #{run.run_number}</span>}
        </p>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap">
          {/* Ref: tag or branch */}
          {isTag ? (
            <span className="inline-flex items-center gap-0.5 font-mono text-amber-600 dark:text-amber-400">
              <Tag className="h-3 w-3" />{run.head_branch}
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5 font-mono">
              <GitBranch className="h-3 w-3" />{run.head_branch}
            </span>
          )}
          {/* Commit SHA */}
          {shortSha && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-0.5 font-mono">
                <GitCommit className="h-3 w-3" />{shortSha}
              </span>
            </>
          )}
          {/* Duration — only for completed runs */}
          {dur && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-0.5">
                <Timer className="h-3 w-3" />{dur}
              </span>
            </>
          )}
          {/* Time ago */}
          {ago && (
            <>
              <span>·</span>
              <span>{ago}</span>
            </>
          )}
        </div>
      </div>
      <StatusBadge status={run.status} conclusion={run.conclusion} />
      <a
        href={run.html_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        title="View in Gitea"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

function RunHistoryDots({ runs }: { runs: WorkflowRun[] }) {
  const passed = runs.filter((r) => r.conclusion === "success").length;
  const failed = runs.filter((r) => r.conclusion === "failure").length;
  const other = runs.length - passed - failed;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        {runs.map((run) => (
          <a
            key={run.id}
            href={run.html_url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${run.display_title} #${run.run_number} — ${run.conclusion || run.status}${run.head_sha ? ` (${run.head_sha.slice(0, 7)})` : ""}`}
            className={`h-2.5 w-2.5 rounded-full ${statusColor(run.status, run.conclusion)} hover:ring-2 ring-offset-1 ring-offset-background transition-shadow`}
          />
        ))}
      </div>
      <span className="text-[10px] text-muted-foreground">
        {passed > 0 && <span className="text-green-600 dark:text-green-400">{passed} passed</span>}
        {failed > 0 && <>{passed > 0 && ", "}<span className="text-red-600 dark:text-red-400">{failed} failed</span></>}
        {other > 0 && <>{(passed > 0 || failed > 0) && ", "}<span>{other} other</span></>}
      </span>
    </div>
  );
}

export function CIStatusCard({ entityKind, entityName }: CIStatusCardProps) {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const active = useActiveEntityTab() === "pipeline";

  // Gated on `active`: entity-tabs.tsx keeps this card mounted-but-hidden
  // once the Pipeline tab has been visited, so without this the 30s poll
  // would keep hitting the backend forever even while the user is on a
  // different tab. Effect re-runs (and fires one immediate fetch) whenever
  // `active` flips back to true, instead of waiting up to 30s for stale data.
  useEffect(() => {
    if (!active) return;
    mountedRef.current = true;

    async function fetchCI() {
      try {
        const res = await fetch(
          `/api/catalog/entities/${encodeURIComponent(entityKind)}/${encodeURIComponent(entityName)}/ci`,
          { credentials: "include" },
        );
        if (!res.ok) {
          if (mountedRef.current) setError(`HTTP ${res.status}`);
          return;
        }
        const data = await res.json();
        if (mountedRef.current) setRuns(data.runs ?? []);
      } catch {
        if (mountedRef.current) setError("Failed to load CI status");
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    }

    fetchCI();
    const interval = setInterval(fetchCI, 30_000);
    return () => { mountedRef.current = false; clearInterval(interval); };
  }, [entityKind, entityName, active]);

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5" /> CI / CD
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking pipelines...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5" /> CI / CD
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (runs.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5" /> CI / CD
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No CI runs found.</p>
        </CardContent>
      </Card>
    );
  }

  const latest = runs[0];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5" /> CI / CD
          <span className="ml-auto text-[10px] font-normal">{runs.length} run{runs.length !== 1 ? "s" : ""}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <RunHistoryDots runs={runs} />
        <RunRow run={latest} />

        <Dialog>
          <DialogTrigger
            render={
              <Button variant="ghost" size="sm" className="w-full justify-center text-muted-foreground">
                View all runs →
              </Button>
            }
          />
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>CI / CD runs — {entityName}</DialogTitle>
            </DialogHeader>
            <CIRunsPanel entityKind={entityKind} entityName={entityName} />
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
