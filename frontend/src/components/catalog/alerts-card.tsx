"use client";

import { useEffect, useRef, useState } from "react";
import { BellRing, BellOff, ExternalLink, Loader2, BookOpen } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { SessionExpired, isSessionExpired } from "@/components/ui/session-expired";
import { cn } from "@/lib/utils";

interface Alert {
  name: string;
  severity?: string;
  summary?: string;
  description?: string;
  runbookUrl?: string;
  pod?: string;
  namespace?: string;
  startsAt: string;
  fingerprint?: string;
}

interface AlertsResponse {
  enabled: boolean;
  namespace?: string;
  alerts: Alert[];
}

interface AlertsCardProps {
  entityKind: string;
  entityName: string;
}

const REFRESH_MS = 30_000;

/**
 * Severity → tone. `critical` and `warning` are the two the upstream
 * kube-prometheus-stack rules actually emit; anything else renders neutral
 * rather than guessing.
 */
function severityTone(severity?: string): StatusTone {
  switch (severity) {
    case "critical":
      return "critical";
    case "warning":
      return "warning";
    case "info":
      return "info";
    default:
      return "muted";
  }
}

/** Firing duration, in the coarsest unit that is still informative. */
function firingFor(startsAt: string): string {
  const started = new Date(startsAt).getTime();
  if (Number.isNaN(started)) return "";

  const mins = Math.floor((Date.now() - started) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <BellRing className="h-3.5 w-3.5" />
          Active Alerts
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function AlertsCard({ entityKind, entityName }: AlertsCardProps) {
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    async function fetchAlerts() {
      try {
        const res = await fetch(
          `/api/catalog/entities/${encodeURIComponent(entityKind)}/${encodeURIComponent(entityName)}/alerts`,
          { credentials: "include" },
        );
        if (!res.ok) {
          if (mountedRef.current) {
            if (isSessionExpired(res.status)) {
              setExpired(true);
            } else {
              // A 502 means Alertmanager did not answer. Say so explicitly —
              // silence would read as "no alerts", the opposite meaning.
              setError("Alertmanager unreachable");
            }
          }
          return;
        }
        const payload: AlertsResponse = await res.json();
        if (mountedRef.current) {
          setData(payload);
          setError(null);
          setExpired(false);
        }
      } catch {
        if (mountedRef.current) setError("Alertmanager unreachable");
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    }

    fetchAlerts();
    const interval = setInterval(fetchAlerts, REFRESH_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [entityKind, entityName]);

  // Alertmanager not configured — the panel has nothing to say, so it stays out
  // of the way entirely rather than showing an empty state.
  if (!loading && data && !data.enabled) return null;

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking alerts...
        </div>
      </Shell>
    );
  }

  if (expired) {
    return (
      <Shell>
        <SessionExpired resource="alerts" />
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <p className="text-sm text-amber-600 dark:text-amber-400">
          {error} — alert status is unknown, not clear.
        </p>
      </Shell>
    );
  }

  const alerts = data?.alerts ?? [];

  if (alerts.length === 0) {
    return (
      <Shell>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <BellOff className="h-3.5 w-3.5" />
          No alerts firing.
        </p>
      </Shell>
    );
  }

  // Critical first — during an incident the top of the list must be the thing
  // that matters most.
  const ordered = [...alerts].sort((a, b) => {
    const rank = (s?: string) => (s === "critical" ? 0 : s === "warning" ? 1 : 2);
    return rank(a.severity) - rank(b.severity);
  });

  return (
    <Shell>
      <div className="divide-y divide-border rounded-lg border border-border">
        {ordered.map((alert, i) => (
          <div
            key={alert.fingerprint ?? `${alert.name}-${i}`}
            className={cn(
              "space-y-1.5 border-l-[3px] p-3",
              alert.severity === "critical"
                ? "border-l-red-500 bg-red-500/5"
                : alert.severity === "warning"
                  ? "border-l-amber-500 bg-amber-500/5"
                  : "border-l-border",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-medium">{alert.name}</span>
              {alert.severity && (
                <StatusChip tone={severityTone(alert.severity)} label={alert.severity} />
              )}
              <span className="ml-auto text-[11px] text-muted-foreground">
                firing {firingFor(alert.startsAt)}
              </span>
            </div>

            {alert.summary && <p className="text-xs text-muted-foreground">{alert.summary}</p>}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {alert.pod && <span className="truncate font-mono">{alert.pod}</span>}
              {alert.runbookUrl && (
                <a
                  href={alert.runbookUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-wxops-cyan hover:underline"
                >
                  <BookOpen className="h-3 w-3" />
                  Runbook
                  <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}
