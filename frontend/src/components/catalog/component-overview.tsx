"use client";

import { Fragment, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Check, GitPullRequest, Loader2, Lock, Globe, Database, KeyRound, ShieldCheck, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types mirrored from promotion-panel ──────────────────────────────────────

interface EnvVersion { tag: string; date: string; }
interface OverlayStatus { exists: boolean; openPR?: number; darlaneEnabled?: boolean; }
interface PromoStatus {
  lifecycle: string;
  locked: boolean;
  baseReady: boolean;
  ingressEnabled: boolean;
  certEnabled: boolean;
  vaultEnabled: boolean;
  databaseEnabled: boolean;
  tags: { dev: EnvVersion | null; staging: EnvVersion | null; production: EnvVersion | null; };
  overlays: { dev: OverlayStatus; staging: OverlayStatus; production: OverlayStatus; };
}

// ── Stage track ───────────────────────────────────────────────────────────────

const STAGES = [
  { key: "experimental", label: "Experimental" },
  { key: "development",  label: "Development"  },
  { key: "staging",      label: "Staging"      },
  { key: "production",   label: "Production"   },
] as const;

type Stage = typeof STAGES[number]["key"];

const STAGE_STYLE: Record<Stage, { dot: string; ring: string; label: string; line: string; check: string }> = {
  experimental: { dot: "bg-amber-500",  ring: "ring-amber-500/25",  label: "text-amber-600 dark:text-amber-400",  line: "bg-amber-400/60",  check: "bg-amber-400"  },
  development:  { dot: "bg-blue-500",   ring: "ring-blue-500/25",   label: "text-blue-600 dark:text-blue-400",    line: "bg-blue-400/60",   check: "bg-blue-400"   },
  staging:      { dot: "bg-violet-500", ring: "ring-violet-500/25", label: "text-violet-600 dark:text-violet-400", line: "bg-violet-400/60", check: "bg-violet-400" },
  production:   { dot: "bg-green-500",  ring: "ring-green-500/25",  label: "text-green-600 dark:text-green-400",  line: "bg-green-400/60",  check: "bg-green-400"  },
};

const LIFECYCLE_LEVEL: Record<string, number> = {
  experimental: 0, development: 1, staging: 2, production: 3,
};

function StageTrack({ lifecycle }: { lifecycle: string }) {
  const currentIdx = LIFECYCLE_LEVEL[lifecycle] ?? 0;
  const currentStyle = STAGE_STYLE[lifecycle as Stage] ?? STAGE_STYLE.experimental;

  return (
    <div className="w-full">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-5">
        Lifecycle Stage
      </p>

      {/* Nodes are shrink-0, connectors flex-1 between them — this centers each node */}
      <div className="flex items-start w-full">
        {STAGES.map((stage, idx) => {
          const isPast    = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const isFuture  = idx > currentIdx;
          const style     = STAGE_STYLE[stage.key];

          return (
            <Fragment key={stage.key}>
              {/* Connector before every node except the first */}
              {idx > 0 && (
                <div className="flex-1 h-0.5 mt-4 self-start mx-1">
                  <div className={cn(
                    "h-full transition-all duration-300",
                    idx <= currentIdx ? STAGE_STYLE[STAGES[idx - 1].key].line : "bg-border/50",
                  )} />
                </div>
              )}

              {/* Node + label */}
              <div className="flex flex-col items-center shrink-0">
                <div className={cn(
                  "h-8 w-8 rounded-full flex items-center justify-center transition-all duration-300",
                  isPast    ? cn(style.check, "text-white")                  : "",
                  isCurrent ? cn(style.dot, "text-white ring-4", style.ring) : "",
                  isFuture  ? "bg-muted border border-border/60"             : "",
                )}>
                  {isPast    && <Check className="h-3.5 w-3.5" />}
                  {isCurrent && <span className="text-xs font-bold text-white">{idx + 1}</span>}
                  {isFuture  && <span className="text-xs font-medium text-muted-foreground/40">{idx + 1}</span>}
                </div>
                <p className={cn(
                  "text-xs font-medium mt-2 text-center whitespace-nowrap",
                  isCurrent ? [currentStyle.label, "font-semibold"] : "",
                  isPast    ? "text-muted-foreground" : "",
                  isFuture  ? "text-muted-foreground/40" : "",
                )}>
                  {stage.label}
                </p>
                {isCurrent && (
                  <span className="text-[10px] text-muted-foreground mt-0.5">Current</span>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ── Env summary cards ─────────────────────────────────────────────────────────

const ENV_CONFIG = {
  dev:        { label: "Development", borderCls: "border-l-blue-500",   bgCls: "bg-blue-500/[0.04]",   dotCls: "bg-blue-500"   },
  staging:    { label: "Staging",     borderCls: "border-l-violet-500", bgCls: "bg-violet-500/[0.04]", dotCls: "bg-violet-500" },
  production: { label: "Production",  borderCls: "border-l-green-500",  bgCls: "bg-green-500/[0.04]",  dotCls: "bg-green-500"  },
} as const;

type Env = keyof typeof ENV_CONFIG;

type EnvState = "live" | "deployed" | "pending-pr" | "none";

function envState(env: Env, overlay: OverlayStatus, lifecycleLevel: number): EnvState {
  const envLevel = { dev: 1, staging: 2, production: 3 }[env];
  if (overlay.exists) {
    return lifecycleLevel >= envLevel ? "live" : "deployed";
  }
  if (overlay.openPR) return "pending-pr";
  return "none";
}

const STATE_BADGE: Record<EnvState, { label: string; cls: string; dot: string }> = {
  live:       { label: "Live",       cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",       dot: "bg-green-500 animate-pulse" },
  deployed:   { label: "Deployed",   cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",           dot: "bg-blue-400"                },
  "pending-pr":{ label: "PR Pending", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",      dot: "bg-amber-400"               },
  none:       { label: "Not started", cls: "bg-muted text-muted-foreground",                                             dot: "bg-muted-foreground/30"     },
};

function EnvCard({ env, overlay, tag, lifecycleLevel }: {
  env: Env;
  overlay: OverlayStatus;
  tag: EnvVersion | null;
  lifecycleLevel: number;
}) {
  const cfg   = ENV_CONFIG[env];
  const state = envState(env, overlay, lifecycleLevel);
  const badge = STATE_BADGE[state];

  return (
    <div className={cn(
      "rounded-lg border border-l-[3px] p-4 space-y-3",
      cfg.borderCls,
      state !== "none" ? cfg.bgCls : "bg-muted/20",
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">{cfg.label}</p>
        <span className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0",
          badge.cls,
        )}>
          <span className={cn("h-1.5 w-1.5 rounded-full", badge.dot)} />
          {badge.label}
        </span>
      </div>

      {/* Version tag */}
      {tag ? (
        <p className="font-mono text-[10px] text-muted-foreground truncate leading-relaxed border border-border/60 rounded px-2 py-1 bg-muted/40">
          {tag.tag}
        </p>
      ) : (
        <p className="text-[10px] text-muted-foreground/50 italic">No image deployed</p>
      )}

      {/* PR badge */}
      {overlay.openPR && (
        <div className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
          <GitPullRequest className="h-3 w-3 shrink-0" />
          <span>PR #{overlay.openPR} open</span>
        </div>
      )}

      {/* Darlane badge */}
      {overlay.darlaneEnabled && (
        <div className="flex items-center gap-1 text-[10px] text-indigo-600 dark:text-indigo-400">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
          Darlane enabled
        </div>
      )}
    </div>
  );
}

// ── Feature flag strip ────────────────────────────────────────────────────────

function FeatureFlags({ status }: { status: PromoStatus }) {
  const flags = [
    { label: "Ingress",     enabled: status.ingressEnabled,  Icon: Globe       },
    { label: "Vault",       enabled: status.vaultEnabled,    Icon: KeyRound    },
    { label: "Database",    enabled: status.databaseEnabled, Icon: Database    },
    { label: "Cert-Manager",enabled: status.certEnabled,     Icon: ShieldCheck },
  ].filter((f) => f.enabled);

  if (flags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {flags.map(({ label, Icon }) => (
        <span key={label} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
          <Icon className="h-3 w-3" />
          {label}
        </span>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ComponentOverviewProps {
  entityKind: string;
  entityName: string;
  lifecycle: string;
  hasSourceRepo: boolean;
  detailsSlot?: ReactNode;
}

export function ComponentOverview({
  entityKind,
  entityName,
  lifecycle,
  hasSourceRepo,
  detailsSlot,
}: ComponentOverviewProps) {
  const [status, setStatus]   = useState<PromoStatus | null>(null);
  const [loading, setLoading] = useState(hasSourceRepo);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!hasSourceRepo) return;
    fetch(
      `/api/catalog/entities/${encodeURIComponent(entityKind)}/${encodeURIComponent(entityName)}/promostatus`,
      { credentials: "include" },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PromoStatus>;
      })
      .then((d) => { setStatus(d); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, [entityKind, entityName, hasSourceRepo]);

  const lifecycleLevel = LIFECYCLE_LEVEL[status?.lifecycle ?? lifecycle] ?? 0;

  return (
    <div className="space-y-8">
      {/* Lifecycle stage track */}
      <StageTrack lifecycle={status?.lifecycle ?? lifecycle} />

      {/* Divider */}
      <div className="border-t border-border/60" />

      {/* Environment status */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">
          Environments
        </p>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading deployment status…
          </div>
        )}

        {error && !loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
            Could not load deployment status
          </div>
        )}

        {!loading && !error && !hasSourceRepo && (
          <p className="text-sm text-muted-foreground">
            No source repository linked. Scaffold this service to enable deployment tracking.
          </p>
        )}

        {status && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              {(["dev", "staging", "production"] as const).map((env) => (
                <EnvCard
                  key={env}
                  env={env}
                  overlay={status.overlays[env]}
                  tag={status.tags[env]}
                  lifecycleLevel={lifecycleLevel}
                />
              ))}
            </div>

            {/* Feature flags */}
            <FeatureFlags status={status} />

            {/* Locked / base not ready warning */}
            {(status.locked || !status.baseReady) && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400">
                <Lock className="h-3.5 w-3.5 shrink-0" />
                {status.locked ? "Entity is locked — no further promotion allowed." : "Base manifest is not yet ready."}
              </div>
            )}
          </div>
        )}
      </div>

      {/* About — static entity metadata rendered server-side, passed as slot */}
      {detailsSlot && (
        <>
          <div className="border-t border-border/60" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">
              About
            </p>
            {detailsSlot}
          </div>
        </>
      )}
    </div>
  );
}
