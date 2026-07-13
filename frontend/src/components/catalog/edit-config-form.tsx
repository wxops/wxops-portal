"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, CheckCircle, Clock, ExternalLink, Eye, GitPullRequest, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { StepAppConfig, validateResources } from "@/components/scaffold/step-app-config";
import {
  buildXTenantAppYAML,
  buildXTenantDatabaseYAML,
  buildEnvExternalSecretYAML,
  buildDbExternalSecretYAML,
} from "@/components/scaffold/xtenant-app-builder";
import { parseXTenantApp } from "@/components/scaffold/parse-xtenant-app";
import type { WizardState } from "@/components/scaffold/project-wizard";

interface EditConfigFormProps {
  team: string;
  appName: string;
  groups: string[];
  entityKind: string;
}

const INITIAL_STATE: WizardState = {
  step: 3,
  team: "",
  appName: "",
  description: "",
  templateId: "",
  runtimeVersion: "",
  packageManager: "",
  appFlavor: "webapp",
  containerPort: null,
  domain: "",
  reloader: false,
  vaultSecrets: false,
  databaseSecrets: false,
  certManager: false,
  ssoAuth: false,
  apiEnabled: false,
  apiType: "openapi",
  openapiPath: "",
  monitoringEnabled: false,
  metricsPath: "/metrics",
  ingressEnabled: false,
  livenessPath: "/healthz",
  readinessPath: "/readyz",
  rolloutType: "RollingUpdate",
  dbExtensions: [],
  envVars: [],
  podAnnotations: [],
  extraLabels: [],
};

const ARGOCD_URL = process.env.NEXT_PUBLIC_ARGOCD_URL ?? "";

const PHASES = [
  { id: "edit" as const, label: "Edit Config" },
  { id: "review" as const, label: "Review & Confirm" },
];

type Phase = "edit" | "review";

export function EditConfigForm({ team, appName, groups, entityKind }: EditConfigFormProps) {
  const [state, setState] = useState<WizardState>({ ...INITIAL_STATE, team, appName });
  const [originalYAML, setOriginalYAML] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("edit");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ status?: string } | null>(null);

  const isPlatformTeam = groups.some((g) => g === "platform-team" || g.endsWith(":platform-team"));

  const patch = (p: Partial<WizardState>) =>
    setState((prev) => ({ ...prev, ...p }));

  useEffect(() => {
    fetch(`/api/scaffold/projects/${encodeURIComponent(team)}/${encodeURIComponent(appName)}/config`, {
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? `HTTP ${res.status}`);
        }
        const config = await res.json();
        const parsed = parseXTenantApp(config);
        const initialState = { ...INITIAL_STATE, ...parsed, team, appName };
        setState(initialState);
        setOriginalYAML(buildAllYAML(initialState));
      })
      .catch((err) => setLoadError(String(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newYAML = useMemo(() => buildAllYAML(state), [state]);
  const hasChanges = originalYAML !== newYAML;

  const diffLines = useMemo(() => {
    if (!originalYAML || !newYAML) return [];
    return computeDiff(originalYAML, newYAML);
  }, [originalYAML, newYAML]);

  const handleSubmit = async () => {
    const resourceError = validateResources(state);
    if (resourceError) {
      toast.error(resourceError);
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        templateId: state.templateId || undefined,
        appFlavor: state.appFlavor,
        containerPort: state.containerPort ?? undefined,
        reloader: state.reloader,
        vaultSecrets: state.vaultSecrets,
        databaseSecrets: state.databaseSecrets,
        certManager: state.certManager,
        // certClusterIssuer omitted — set per-env in the Promote flow.
        ssoAuth: state.ssoAuth,
        ingressEnabled: state.ingressEnabled,
        livenessPath: state.livenessPath || undefined,
        readinessPath: state.readinessPath || undefined,
        rolloutType: state.rolloutType || undefined,
        envVars: state.envVars.filter((p) => p.key),
        podAnnotations: state.podAnnotations.filter((p) => p.key),
        extraLabels: state.extraLabels.filter((p) => p.key),
      };

      const res = await fetch(
        `/api/scaffold/projects/${encodeURIComponent(team)}/${encodeURIComponent(appName)}/config`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json();
      toast.success(data.status ?? "Config updated");
      setSuccess({ status: data.status });
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Success ──────────────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="mx-auto max-w-lg text-center space-y-6 py-8">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
          <CheckCircle className="h-8 w-8 text-green-500" />
        </div>

        <div>
          <h2 className="text-xl font-bold">Config Updated</h2>
          <p className="mt-1 text-muted-foreground">
            <span className="font-mono text-foreground">{team}/{appName}</span> configuration has been updated.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-muted/20 p-4 text-left space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">What was updated</p>
          <ul className="text-sm space-y-1 text-muted-foreground">
            <li className="flex items-center gap-2">
              <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
              XTenantApp base manifest updated
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
              Dev overlay patch updated
            </li>
            {success.status && (
              <li className="flex items-center gap-2">
                <GitPullRequest className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                {success.status}
              </li>
            )}
          </ul>
        </div>

        {success.status?.toLowerCase().includes("pr") && (
          <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 px-3 py-2 text-left">
            <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800 dark:text-amber-300">
              A platform review PR has been opened. ArgoCD will apply the changes after it is merged.
            </p>
          </div>
        )}

        <div className="flex justify-center gap-3">
          <Link
            href={`/dashboard/catalog/${entityKind}/${appName}`}
            className="flex items-center gap-2 rounded-lg border border-wxops-purple/40 bg-wxops-purple/5 px-4 py-2.5 text-sm font-medium text-wxops-purple transition-colors hover:bg-wxops-purple/10"
          >
            Back to Entity
          </Link>
          {ARGOCD_URL && (
            <a
              href={`${ARGOCD_URL}/applications/${team}-${appName}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted/50"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              ArgoCD
            </a>
          )}
        </div>
      </div>
    );
  }

  // ── Loading / Error ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading current config...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-lg space-y-4">
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          Failed to load config: {loadError}
        </div>
        <Link
          href={`/dashboard/catalog/${entityKind}/${appName}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </div>
    );
  }

  // ── Main ─────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4">
          <Link href="/dashboard/catalog" className="hover:text-foreground">Catalog</Link>
          <span>/</span>
          <Link href={`/dashboard/catalog/${entityKind}/${appName}`} className="hover:text-foreground">{appName}</Link>
          <span>/</span>
          <span className="text-foreground font-medium">Edit Config</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight">Edit Config: {team}/{appName}</h1>
        <p className="text-muted-foreground mt-1">
          {phase === "edit"
            ? "Update XTenantApp platform features, resources, and probes."
            : "Review changes before submitting. This will create a PR to gitops-infra."}
        </p>
      </div>

      {/* Step indicator — matches scaffold wizard style */}
      <div className="flex items-center gap-2">
        {PHASES.map(({ id, label }, idx) => (
          <div key={id} className="flex items-center gap-2">
            {idx > 0 && (
              <div className={cn("h-px w-8 transition-colors", phase === "review" ? "bg-wxops-purple" : "bg-border")} />
            )}
            <div className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              phase === id
                ? "bg-wxops-purple/10 text-wxops-purple"
                : phase === "review" && id === "edit"
                  ? "bg-muted text-foreground"
                  : "bg-muted/50 text-muted-foreground",
            )}>
              <span className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                phase === id
                  ? "bg-wxops-purple text-white"
                  : phase === "review" && id === "edit"
                    ? "bg-foreground/20 text-foreground"
                    : "bg-border text-muted-foreground",
              )}>
                {idx + 1}
              </span>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Edit phase ── */}
      {phase === "edit" && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-border p-6">
              <StepAppConfig state={state} onChange={patch} isPlatformTeam={isPlatformTeam} />
            </div>

            <div className="rounded-xl border border-border p-6 bg-muted/20">
              <p className="mb-3 text-sm font-medium">Live Preview</p>
              <div className="space-y-3">
                <ManifestPreview title="XTenantApp" yaml={buildXTenantAppYAML(state)} />
                {state.databaseSecrets && (
                  <ManifestPreview title="XTenantDatabase" yaml={buildXTenantDatabaseYAML(state)} />
                )}
                {state.vaultSecrets && (
                  <ManifestPreview title="ExternalSecret (env)" yaml={buildEnvExternalSecretYAML(state)} />
                )}
                {state.databaseSecrets && (
                  <ManifestPreview title="ExternalSecret (db-creds)" yaml={buildDbExternalSecretYAML(state)} />
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Link
              href={`/dashboard/catalog/${entityKind}/${appName}`}
              className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
            >
              <ArrowLeft className="h-4 w-4" />
              Cancel
            </Link>
            <button
              type="button"
              onClick={() => setPhase("review")}
              disabled={!hasChanges}
              className="flex items-center gap-1.5 rounded-lg bg-wxops-purple px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-wxops-purple/90 disabled:opacity-40 disabled:pointer-events-none"
            >
              <Eye className="h-4 w-4" />
              Review Changes
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </>
      )}

      {/* ── Review phase ── */}
      {phase === "review" && (
        <>
          <div className="rounded-xl border border-border overflow-hidden">
            {/* Diff legend */}
            <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border bg-muted/20 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-red-500/20 border border-red-500/40" />
                Removed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-green-500/20 border border-green-500/40" />
                Added
              </span>
              <span className="ml-auto font-mono">
                +{diffLines.filter((l) => l.type === "add").length} / -{diffLines.filter((l) => l.type === "del").length}
              </span>
            </div>

            {/* Diff table */}
            <div className="overflow-auto max-h-[65vh]">
              {hasChanges ? (
                <table className="w-full border-collapse font-mono text-[12px] leading-5">
                  <tbody>
                    {diffLines.map((line, i) => (
                      <tr
                        key={i}
                        className={cn(
                          line.type === "add" && "bg-green-500/10",
                          line.type === "del" && "bg-red-500/10",
                        )}
                      >
                        <td className="w-10 px-2 text-right text-muted-foreground/50 select-none border-r border-border">
                          {line.oldNum ?? ""}
                        </td>
                        <td className="w-10 px-2 text-right text-muted-foreground/50 select-none border-r border-border">
                          {line.newNum ?? ""}
                        </td>
                        <td className="w-6 text-center select-none">
                          <span className={cn(
                            line.type === "add" && "text-green-600 dark:text-green-400",
                            line.type === "del" && "text-red-600 dark:text-red-400",
                          )}>
                            {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                          </span>
                        </td>
                        <td className="px-3 whitespace-pre-wrap">{line.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No changes detected.
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setPhase("edit")}
              className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Edit
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !hasChanges}
              className="flex items-center gap-1.5 rounded-lg bg-wxops-purple px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-wxops-purple/90 disabled:opacity-40 disabled:pointer-events-none"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                "Confirm & Submit"
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────────────── */

function ManifestPreview({ title, yaml }: { title: string; yaml: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <pre className="overflow-auto rounded-md border bg-background p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
        {yaml}
      </pre>
    </div>
  );
}

function buildAllYAML(s: WizardState): string {
  const parts = [`# --- XTenantApp ---\n${buildXTenantAppYAML(s)}`];
  if (s.databaseSecrets) parts.push(`# --- XTenantDatabase ---\n${buildXTenantDatabaseYAML(s)}`);
  if (s.vaultSecrets) parts.push(`# --- ExternalSecret (env) ---\n${buildEnvExternalSecretYAML(s)}`);
  if (s.databaseSecrets) parts.push(`# --- ExternalSecret (db-creds) ---\n${buildDbExternalSecretYAML(s)}`);
  return parts.join("\n");
}

/* ── Simple LCS-based line diff ─────────────────────────────────────────────── */

interface DiffLine {
  type: "ctx" | "add" | "del";
  text: string;
  oldNum?: number;
  newNum?: number;
}

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const lcs = buildLCS(oldLines, newLines);
  const result: DiffLine[] = [];
  let oi = 0, ni = 0, li = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (li < lcs.length && oi < oldLines.length && ni < newLines.length && oldLines[oi] === lcs[li] && newLines[ni] === lcs[li]) {
      result.push({ type: "ctx", text: oldLines[oi], oldNum: oi + 1, newNum: ni + 1 });
      oi++; ni++; li++;
    } else if (oi < oldLines.length && (li >= lcs.length || oldLines[oi] !== lcs[li])) {
      result.push({ type: "del", text: oldLines[oi], oldNum: oi + 1 });
      oi++;
    } else {
      result.push({ type: "add", text: newLines[ni], newNum: ni + 1 });
      ni++;
    }
  }
  return result;
}

function buildLCS(a: string[], b: string[]): string[] {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

  const result: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { result.unshift(a[i - 1]); i--; j--; }
    else if (dp[i - 1][j] > dp[i][j - 1]) i--;
    else j--;
  }
  return result;
}
