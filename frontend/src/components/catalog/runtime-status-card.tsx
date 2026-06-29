"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, CheckCircle, AlertCircle, XCircle, Loader2, ExternalLink, Server } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

interface ClusterStatus {
  clusterId: string;
  clusterName: string;
  deployment: DeploymentInfo | null;
  error?: string;
}

const ARGOCD_URL = process.env.NEXT_PUBLIC_ARGOCD_URL ?? "";

function deriveNamespace(team: string): string {
  if (team === "platform-team") return "platform";
  return `tenant-${team}`;
}

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
                return { clusterId: cluster.id, clusterName: cluster.name, deployment: null, error: `HTTP ${res.status}` };
              }
              const data = await res.json();
              const deployments: DeploymentInfo[] = data.deployments ?? [];
              const match = deployments.find((d) => d.name === appName);
              return { clusterId: cluster.id, clusterName: cluster.name, deployment: match ?? null };
            } catch {
              return { clusterId: cluster.id, clusterName: cluster.name, deployment: null, error: "Unreachable" };
            }
          }),
        );

        if (mountedRef.current) {
          setStatuses(
            results.map((r) =>
              r.status === "fulfilled"
                ? r.value
                : { clusterId: "unknown", clusterName: "Unknown", deployment: null, error: "Failed" },
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

  const anyDeployed = statuses.some((s) => s.deployment);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          Runtime Status
          <span className="ml-auto font-mono text-[10px] font-normal text-muted-foreground/60">
            ns: {namespace}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {statuses.map((s) => (
          <div
            key={s.clusterId}
            className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
          >
            <Server className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{s.clusterName}</p>
              {s.error && (
                <p className="text-[11px] text-muted-foreground">{s.error}</p>
              )}
            </div>

            {s.error ? (
              <span className="text-xs text-muted-foreground">unavailable</span>
            ) : s.deployment ? (
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge ready={s.deployment.ready} desired={s.deployment.desired} />
                {ARGOCD_URL && (
                  <a
                    href={`${ARGOCD_URL}/applications/${team}-${appName}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Open in ArgoCD"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <XCircle className="h-3 w-3" />
                Not deployed
              </span>
            )}
          </div>
        ))}

        {!anyDeployed && (
          <p className="text-xs text-muted-foreground pt-1">
            No deployment found matching <span className="font-mono">{appName}</span> in{" "}
            <span className="font-mono">{namespace}</span>.
          </p>
        )}

        {ARGOCD_URL && anyDeployed && (
          <a
            href={`${ARGOCD_URL}/applications/${team}-${appName}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline pt-1"
          >
            <ExternalLink className="h-3 w-3" />
            Open in ArgoCD
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ ready, desired }: { ready: number; desired: number }) {
  const allReady = ready === desired && desired > 0;
  const partial = ready > 0 && ready < desired;

  if (allReady) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
        <CheckCircle className="h-3 w-3" />
        {ready}/{desired}
      </span>
    );
  }
  if (partial) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
        <AlertCircle className="h-3 w-3" />
        {ready}/{desired}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-900/30 dark:text-red-400">
      <XCircle className="h-3 w-3" />
      {ready}/{desired}
    </span>
  );
}
