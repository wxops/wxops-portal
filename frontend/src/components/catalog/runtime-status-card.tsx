"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ExternalLink,
  Loader2,
  RefreshCw,
  ScrollText,
  Waypoints,
  Cpu,
  MemoryStick,
  Flame,
  ShieldAlert,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusChip, syncTone, healthTone, isTransitional } from "@/components/ui/status-chip";
import { SessionExpired, isSessionExpired } from "@/components/ui/session-expired";
import { cn } from "@/lib/utils";

// ── Types (mirror the backend /environments payload) ──────────────────────────

interface ArgoStatus {
  available: boolean;
  sync?: string;
  health?: string;
  revision?: string;
  phase?: string;
  finishedAt?: string;
}

interface XRStatus {
  available: boolean;
  ready: boolean;
  created: boolean;
  url?: string;
  image?: string;
  namespace?: string;
}

interface EnvLinks {
  logs?: string;
  traces?: string;
  cpu?: string;
  memory?: string;
  profiles?: string;
  argocd?: string;
}

interface EnvStatus {
  env: string;
  clusterId: string;
  clusterName: string;
  argo: ArgoStatus;
  xr: XRStatus;
  links: EnvLinks;
  /** forbidden | not-found | unreachable — absent when the read succeeded. */
  unavailable?: string;
}

interface EnvResponse {
  grafanaUrl?: string;
  argocdUrl?: string;
  environments: EnvStatus[];
}

interface RuntimeStatusCardProps {
  entityKind: string;
  entityName: string;
}

// ── Environment presentation ──────────────────────────────────────────────────
// Colours match ComponentOverview's EnvCards so the same environment reads the
// same way wherever it appears.

const ENV_META: Record<string, { label: string; dot: string; border: string }> = {
  dev: { label: "dev", dot: "bg-blue-500", border: "border-l-blue-500" },
  staging: { label: "staging", dot: "bg-violet-500", border: "border-l-violet-500" },
  production: { label: "production", dot: "bg-wxops-green", border: "border-l-wxops-green" },
};

const REFRESH_INTERVAL = 30;

// ── Unavailable-state copy ────────────────────────────────────────────────────
// A missing environment is not a failure. Only `unreachable` is an error; the
// other two are "nothing to show yet" and "an operator has work to do".

const UNAVAILABLE_META: Record<string, { text: string; cls: string; icon: boolean }> = {
  forbidden: {
    text: "Cluster RBAC not applied — a platform admin needs to grant read access",
    cls: "text-amber-600 dark:text-amber-400",
    icon: true,
  },
  "not-found": {
    text: "Not deployed to this environment",
    cls: "text-muted-foreground",
    icon: false,
  },
  unreachable: {
    text: "Cluster unreachable",
    cls: "text-red-600 dark:text-red-400",
    icon: true,
  },
};

// ── Signal links ──────────────────────────────────────────────────────────────

// Every link is scoped to this specific environment's pods, so the numbers
// behind them are not diluted by the other environments sharing the namespace.
const SIGNALS = [
  { key: "logs", label: "Logs", Icon: ScrollText },
  { key: "traces", label: "Traces", Icon: Waypoints },
  { key: "cpu", label: "CPU", Icon: Cpu },
  { key: "memory", label: "Memory", Icon: MemoryStick },
  { key: "profiles", label: "Profiles", Icon: Flame },
] as const;

function SignalLink({
  href,
  label,
  Icon,
}: {
  href: string;
  label: string;
  Icon: typeof ScrollText;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon className="h-3 w-3" />
      {label}
      <ExternalLink className="h-2.5 w-2.5 shrink-0" />
    </a>
  );
}

function ArgoCDLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-orange-400/40 bg-orange-400/10 px-2 py-1 text-[11px] font-semibold text-orange-600 transition-colors hover:border-orange-400/70 hover:bg-orange-400/20 dark:text-orange-400"
    >
      <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0 fill-current" aria-hidden="true">
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
      </svg>
      ArgoCD
      <ExternalLink className="h-2.5 w-2.5 shrink-0" />
    </a>
  );
}

// ── One environment row ───────────────────────────────────────────────────────

function EnvRow({ status }: { status: EnvStatus }) {
  const meta = ENV_META[status.env] ?? {
    label: status.env,
    dot: "bg-muted-foreground",
    border: "border-l-border",
  };

  const unavailable = status.unavailable ? UNAVAILABLE_META[status.unavailable] : undefined;
  const hasSignals = SIGNALS.some((s) => status.links[s.key]);

  return (
    <div className={cn("space-y-2 border-l-[3px] py-3 pl-4 pr-1", meta.border)}>
      {/* Header: env name + state chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)} />
        <span className="text-sm font-medium">{meta.label}</span>

        {status.argo.available && (
          <>
            {status.argo.sync && (
              <StatusChip tone={syncTone(status.argo.sync)} label={status.argo.sync} />
            )}
            {status.argo.health && (
              <StatusChip
                tone={healthTone(status.argo.health)}
                label={status.argo.health}
                pulse={isTransitional(status.argo.health)}
              />
            )}
          </>
        )}

        {status.xr.available && (
          <StatusChip
            tone={status.xr.ready ? "positive" : status.xr.created ? "warning" : "muted"}
            label={status.xr.ready ? "Provisioned" : status.xr.created ? "Provisioning" : "Pending"}
          />
        )}

        {status.links.argocd && (
          <span className="ml-auto">
            <ArgoCDLink href={status.links.argocd} />
          </span>
        )}
      </div>

      {/* Detail line */}
      {(status.argo.revision || status.xr.image || status.xr.url) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {status.argo.revision && (
            <span className="font-mono">rev {status.argo.revision}</span>
          )}
          {status.xr.image && (
            <span className="truncate font-mono" title={status.xr.image}>
              {status.xr.image}
            </span>
          )}
          {status.xr.url && (
            <a
              href={status.xr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-wxops-cyan hover:underline"
            >
              {status.xr.url.replace(/^https?:\/\//, "")}
              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
            </a>
          )}
        </div>
      )}

      {unavailable && (
        <p className={cn("flex items-center gap-1.5 text-[11px]", unavailable.cls)}>
          {unavailable.icon && <ShieldAlert className="h-3 w-3 shrink-0" />}
          {unavailable.text}
        </p>
      )}

      {hasSignals && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {SIGNALS.map(({ key, label, Icon }) => {
            const href = status.links[key];
            return href ? <SignalLink key={key} href={href} label={label} Icon={Icon} /> : null;
          })}
        </div>
      )}
    </div>
  );
}

// ── Card shell ────────────────────────────────────────────────────────────────

function Shell({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Activity className="h-3.5 w-3.5" />
          Runtime Status
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function RuntimeStatusCard({ entityKind, entityName }: RuntimeStatusCardProps) {
  const [data, setData] = useState<EnvResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Tracked separately from `error`: a 401 is recoverable in place and gets a
  // re-login affordance, not a dead-end error message.
  const [expired, setExpired] = useState(false);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);

  // Bumping refreshSeq re-runs the effect, which is how the manual refresh
  // button triggers a fetch without the fetch itself escaping the effect.
  const [refreshSeq, setRefreshSeq] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    async function fetchStatus() {
      try {
        const res = await fetch(
          `/api/catalog/entities/${encodeURIComponent(entityKind)}/${encodeURIComponent(entityName)}/environments`,
          { credentials: "include" },
        );
        if (!res.ok) {
          if (mountedRef.current) {
            if (isSessionExpired(res.status)) {
              setExpired(true);
            } else {
              setError(`HTTP ${res.status}`);
            }
          }
          return;
        }
        const payload: EnvResponse = await res.json();
        if (mountedRef.current) {
          setData(payload);
          setError(null);
          setExpired(false);
        }
      } catch {
        if (mountedRef.current) setError("Failed to load runtime status");
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setCountdown(REFRESH_INTERVAL);
        }
      }
    }

    fetchStatus();

    // Tick down once a second and refetch at zero, so the next refresh is
    // visible rather than a silent 30s surprise.
    const tick = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          fetchStatus();
          return REFRESH_INTERVAL;
        }
        return n - 1;
      });
    }, 1_000);

    return () => {
      mountedRef.current = false;
      clearInterval(tick);
    };
  }, [entityKind, entityName, refreshSeq]);

  const refreshButton = (
    <button
      type="button"
      onClick={() => setRefreshSeq((n) => n + 1)}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
      {countdown}s
    </button>
  );

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading environment status...
        </div>
      </Shell>
    );
  }

  if (expired) {
    return (
      <Shell>
        <SessionExpired resource="runtime status" />
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell action={refreshButton}>
        <p className="text-sm text-muted-foreground">{error}</p>
      </Shell>
    );
  }

  const environments = data?.environments ?? [];

  if (environments.length === 0) {
    return (
      <Shell action={refreshButton}>
        <p className="text-sm text-muted-foreground">
          No clusters registered — runtime status is unavailable.
        </p>
      </Shell>
    );
  }

  // Group by cluster so a multi-cluster estate reads as sections rather than a
  // flat list with repeated environment names.
  const clusters = Array.from(new Set(environments.map((e) => e.clusterId)));
  const multiCluster = clusters.length > 1;

  return (
    <Shell action={refreshButton}>
      <div className="space-y-4">
        {clusters.map((clusterId) => {
          const rows = environments.filter((e) => e.clusterId === clusterId);
          return (
            <div key={clusterId} className="space-y-1">
              {multiCluster && (
                <p className="pl-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {rows[0]?.clusterName ?? clusterId}
                </p>
              )}
              <div className="divide-y divide-border rounded-lg border border-border">
                {rows.map((row) => (
                  <EnvRow key={`${row.clusterId}-${row.env}`} status={row} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
