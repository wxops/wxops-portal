"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, ExternalLink, Server, Loader2 } from "lucide-react";

// ── ArgoCD branded link button ────────────────────────────────────────────────
function ArgoCDLink({ href, label }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded border border-orange-400/40 bg-orange-400/10 px-2 py-0.5 text-[10px] font-semibold text-orange-600 hover:bg-orange-400/20 hover:border-orange-400/70 dark:text-orange-400 transition-colors whitespace-nowrap"
    >
      {/* ArgoCD gear icon */}
      <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current shrink-0" aria-hidden="true">
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
      </svg>
      {label ?? "ArgoCD"}
      <ExternalLink className="h-2.5 w-2.5 shrink-0" />
    </a>
  );
}
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface RuntimeStatusCardProps {
  appName: string;
  team: string;
}

interface ClusterInfo {
  id: string;
  name: string;
}

interface DeploymentInfo {
  name: string;
  namespace: string;
  ready: number;
  desired: number;
}

// One matched deployment with its resolved env label + dot color
interface MatchedDeployment {
  info: DeploymentInfo;
  label: string;
  dotCls: string;
}

interface ClusterStatus {
  clusterId: string;
  clusterName: string;
  matches: MatchedDeployment[];
  error?: string;
}

type Health = "healthy" | "degraded" | "down" | "error";

const ARGOCD_URL = process.env.NEXT_PUBLIC_ARGOCD_URL ?? "";

// Suffixes to probe, in pipeline order (dev → staging → production)
const ENV_VARIANTS = [
  { suffix: "-dev",        label: "dev",        dotCls: "bg-wxops-indigo"  },
  { suffix: "",            label: "dev",        dotCls: "bg-wxops-indigo"  },
  { suffix: "-staging",    label: "staging",    dotCls: "bg-violet-500"    },
  { suffix: "-production", label: "production", dotCls: "bg-wxops-green"   },
] as const;

// Display order: dev first, then staging, then production
const ENV_ORDER: Record<string, number> = { dev: 0, staging: 1, production: 2 };

function deriveNamespace(team: string): string {
  return team === "platform-team" ? "platform" : `tenant-${team}`;
}

function resolveMatches(deployments: DeploymentInfo[], appName: string): MatchedDeployment[] {
  const seen = new Set<string>();
  const results: MatchedDeployment[] = [];

  for (const v of ENV_VARIANTS) {
    const targetName = `${appName}${v.suffix}`;
    const dep = deployments.find((d) => d.name === targetName);
    if (dep && !seen.has(dep.name)) {
      seen.add(dep.name);
      results.push({ info: dep, label: v.label, dotCls: v.dotCls });
    }
  }

  return results.sort((a, b) => (ENV_ORDER[a.label] ?? 0) - (ENV_ORDER[b.label] ?? 0));
}

function deploymentHealth(d: DeploymentInfo): Health {
  if (d.desired === 0) return "down";
  if (d.ready === d.desired) return "healthy";
  if (d.ready > 0) return "degraded";
  return "down";
}

const accentBorder: Record<Health, string> = {
  healthy:  "border-l-wxops-green",
  degraded: "border-l-amber-500",
  down:     "border-l-red-500",
  error:    "border-l-red-400",
};

const rowBg: Record<Health, string> = {
  healthy:  "bg-wxops-green/5",
  degraded: "bg-amber-500/5",
  down:     "bg-red-500/5",
  error:    "bg-red-500/5",
};

const aggDotCls: Record<string, string> = {
  healthy:  "bg-wxops-green animate-status",
  degraded: "bg-amber-500",
  down:     "bg-red-500",
  none:     "bg-muted-foreground/30",
};

// ── Status chip ───────────────────────────────────────────────────────────────
const HEALTH_LABEL: Record<Health, string> = {
  healthy:  "Healthy",
  degraded: "Degraded",
  down:     "Down",
  error:    "Error",
};

function StatusChip({ health }: { health: Health }) {
  const configs = {
    healthy:  { cls: "border-wxops-green/20 bg-wxops-green/10 text-wxops-green",               dot: "bg-wxops-green animate-status" },
    degraded: { cls: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
    down:     { cls: "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400",         dot: "bg-red-500" },
    error:    { cls: "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400",         dot: "bg-red-500" },
  };
  const c = configs[health];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", c.cls)}>
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", c.dot)} />
      {HEALTH_LABEL[health]}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function RuntimeStatusCard({ appName, team }: RuntimeStatusCardProps) {
  const [statuses, setStatuses] = useState<ClusterStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [noClusters, setNoClusters] = useState(false);

  const namespace = deriveNamespace(team);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    async function fetchStatus() {
      try {
        const clustersRes = await fetch("/api/v1/clusters", { credentials: "include" });
        if (!clustersRes.ok) {
          if (mountedRef.current) { setNoClusters(true); setLoading(false); }
          return;
        }
        const clustersData = await clustersRes.json();
        const clusters: ClusterInfo[] = clustersData.clusters ?? [];

        if (clusters.length === 0) {
          if (mountedRef.current) { setNoClusters(true); setLoading(false); }
          return;
        }

        const results = await Promise.allSettled(
          clusters.map(async (cluster): Promise<ClusterStatus> => {
            try {
              const res = await fetch(
                `/api/v1/clusters/${cluster.id}/deployments?namespace=${encodeURIComponent(namespace)}`,
                { credentials: "include" },
              );
              if (!res.ok) {
                return { clusterId: cluster.id, clusterName: cluster.name, matches: [], error: `HTTP ${res.status}` };
              }
              const data = await res.json();
              const deployments: DeploymentInfo[] = data.deployments ?? [];
              const matches = resolveMatches(deployments, appName);
              return { clusterId: cluster.id, clusterName: cluster.name, matches };
            } catch {
              return { clusterId: cluster.id, clusterName: cluster.name, matches: [], error: "Unreachable" };
            }
          }),
        );

        if (mountedRef.current) {
          setStatuses(
            results.map((r) =>
              r.status === "fulfilled"
                ? r.value
                : { clusterId: "unknown", clusterName: "Unknown", matches: [], error: "Failed" },
            ),
          );
        }
      } catch {
        if (mountedRef.current) setNoClusters(true);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => { mountedRef.current = false; clearInterval(interval); };
  }, [appName, namespace]);

  // Aggregate health across every matched deployment on every cluster
  const aggHealth = (() => {
    if (loading || noClusters || statuses.length === 0) return "none";
    const allMatches = statuses.flatMap((s) => s.matches ?? []).filter(Boolean);
    if (statuses.some((s) => s.error)) return "down";
    if (allMatches.length === 0) return "none";
    const healths = allMatches.map((m) => deploymentHealth(m.info));
    if (healths.every((h) => h === "healthy")) return "healthy";
    if (healths.some((h) => h === "down")) return "down";
    return "degraded";
  })();

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            Runtime Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking clusters...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (noClusters) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            Runtime Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No clusters configured.</p>
        </CardContent>
      </Card>
    );
  }

  const anyDeployed = statuses.some((s) => s.matches.length > 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          Runtime Status
          <span className="font-mono text-[10px] font-normal text-muted-foreground/50 ml-1">
            ns/{namespace}
          </span>
          <span className={cn("ml-auto h-2.5 w-2.5 rounded-full shrink-0", aggDotCls[aggHealth] ?? aggDotCls.none)} />
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {statuses.map((s) => (
          <div key={s.clusterId} className="space-y-1.5">

            {/* Cluster header */}
            <div className="flex items-center gap-1.5 px-0.5">
              <Server className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <p className="text-xs font-semibold text-muted-foreground truncate">{s.clusterName}</p>
              {s.error && (
                <span className="ml-auto text-[10px] text-red-500 font-mono shrink-0">{s.error}</span>
              )}
            </div>

            {/* Per-environment deployment rows */}
            <div className="space-y-1.5 pl-3 border-l border-border">
              {(s.matches ?? []).length > 0 ? (
                (s.matches ?? []).filter(Boolean).map((m) => {
                  const health = deploymentHealth(m.info);
                  return (
                    <div
                      key={m.info.name}
                      className={cn(
                        "flex items-center gap-3 rounded-md border border-l-[3px] border-border px-3 py-2.5 transition-colors",
                        accentBorder[health],
                        rowBg[health],
                      )}
                    >
                      {/* Env indicator — dot + label */}
                      <span className="flex items-center gap-1.5 shrink-0">
                        <span className={cn("h-2 w-2 rounded-full shrink-0", m.dotCls)} />
                        <span className="text-sm font-medium text-foreground">
                          {m.label.charAt(0).toUpperCase() + m.label.slice(1)}
                        </span>
                      </span>

                      {/* Status chip · pod count · ArgoCD link */}
                      <div className="flex items-center gap-2 shrink-0 ml-auto">
                        <StatusChip health={health} />
                        <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                          {m.info.ready}/{m.info.desired} pods
                        </span>
                        {ARGOCD_URL && (
                          <ArgoCDLink
                            href={`${ARGOCD_URL}/applications/${team}-${appName}-${m.label}`}
                          />
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                /* Not deployed on this cluster */
                <div className="flex items-center gap-3 rounded-md border border-dashed border-border px-3 py-2.5 opacity-50">
                  <span className="text-xs text-muted-foreground">
                    {s.error ? "Cluster unreachable" : `No deployment found for ${appName}`}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}

        {!anyDeployed && (
          <p className="text-xs text-muted-foreground">
            No deployments found matching{" "}
            <span className="font-mono">{appName}</span> in{" "}
            <span className="font-mono">{namespace}</span>.
          </p>
        )}

        {ARGOCD_URL && anyDeployed && (
          <ArgoCDLink
            href={`${ARGOCD_URL}/applications?search=${appName}`}
            label="View all in ArgoCD"
          />
        )}
      </CardContent>
    </Card>
  );
}
