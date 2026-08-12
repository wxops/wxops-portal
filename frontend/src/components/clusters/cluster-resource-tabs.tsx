"use client";

import { Fragment, useState, useEffect, useReducer, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Box, Rocket, Globe, Loader2, RefreshCw,
  Copy, Check, ChevronDown, ChevronRight, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PodDetailDrawer } from "@/components/clusters/pod-detail-drawer";
import { SessionExpired, isSessionExpired } from "@/components/ui/session-expired";

const REFRESH_INTERVAL = 30;

// ── Types ─────────────────────────────────────────────────────────────────────

interface PodInfo {
  name: string;
  namespace: string;
  status: string;
  node: string;
}

interface DeploymentInfo {
  name: string;
  namespace: string;
  ready: number;
  desired: number;
}

interface ServicePort {
  name: string;
  protocol: string;
  port: number;
  targetPort: string;
  nodePort?: number;
}

interface ServiceInfo {
  name: string;
  namespace: string;
  type: string;
  clusterIP: string;
  ports: ServicePort[];
}

interface QuotaResource {
  name: string;
  hard: string;
  used: string;
}

interface QuotaInfo {
  name: string;
  resources: QuotaResource[];
}

type Tab = "pods" | "deployments" | "services";

type ResourceState = {
  loading: boolean;
  error: string;
  // Distinct from `error`: a 401 is recoverable in place via re-login, so it
  // gets its own affordance rather than a dead-end message.
  expired: boolean;
  pods: PodInfo[];
  deployments: DeploymentInfo[];
  services: ServiceInfo[];
};

type ResourceAction =
  | { type: "loading" }
  | { type: "pods"; items: PodInfo[] }
  | { type: "deployments"; items: DeploymentInfo[] }
  | { type: "services"; items: ServiceInfo[] }
  | { type: "error"; message: string }
  | { type: "expired" };

function resourceReducer(state: ResourceState, action: ResourceAction): ResourceState {
  switch (action.type) {
    case "loading":      return { ...state, loading: true, error: "" };
    case "pods":         return { ...state, loading: false, expired: false, pods: action.items };
    case "deployments":  return { ...state, loading: false, expired: false, deployments: action.items };
    case "services":     return { ...state, loading: false, expired: false, services: action.items };
    case "error":        return { ...state, loading: false, error: action.message };
    case "expired":      return { ...state, loading: false, error: "", expired: true };
  }
}

interface Props {
  clusterId: string;
  reloadKey?: number;
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyBtn({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title="Copy"
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground opacity-0 group-hover:opacity-100",
        className
      )}
    >
      {copied ? <Check className="h-3 w-3 text-wxops-green" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ── Pod status helpers ────────────────────────────────────────────────────────

function podStatusMeta(status: string): { dot: string; color: string } {
  switch (status) {
    case "Running":   return { dot: "bg-wxops-green",         color: "text-wxops-green"    };
    case "Pending":   return { dot: "bg-amber-400",           color: "text-amber-500"      };
    case "Succeeded": return { dot: "bg-wxops-cyan",          color: "text-wxops-cyan"     };
    case "Failed":    return { dot: "bg-destructive",         color: "text-destructive"    };
    default:          return { dot: "bg-muted-foreground/40", color: "text-muted-foreground" };
  }
}

// ── Deployment health helpers ─────────────────────────────────────────────────

function deployHealth(ready: number, desired: number) {
  if (desired === 0)      return { color: "text-muted-foreground", bg: "bg-muted",          border: "border-border"         };
  if (ready === desired)  return { color: "text-wxops-green",      bg: "bg-wxops-green/15", border: "border-wxops-green/30" };
  if (ready > 0)          return { color: "text-amber-500",        bg: "bg-amber-500/10",   border: "border-amber-500/30"   };
  return                         { color: "text-destructive",       bg: "bg-destructive/10", border: "border-destructive/30" };
}

function DeploymentDots({ ready, desired }: { ready: number; desired: number }) {
  const max = Math.min(desired, 10);
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} className={cn("h-2 w-2 rounded-full", i < ready ? "bg-wxops-green" : "bg-muted-foreground/25")} />
      ))}
      {desired > 10 && <span className="text-[10px] text-muted-foreground ml-1">+{desired - 10}</span>}
    </div>
  );
}

// ── Service type badge ────────────────────────────────────────────────────────

function ServiceTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    ClusterIP:    "text-wxops-purple bg-wxops-purple/10 border-wxops-purple/30",
    NodePort:     "text-wxops-cyan   bg-wxops-cyan/10   border-wxops-cyan/30",
    LoadBalancer: "text-wxops-green  bg-wxops-green/10  border-wxops-green/30",
    ExternalName: "text-amber-500    bg-amber-500/10    border-amber-500/30",
  };
  return (
    <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-medium", styles[type] ?? "text-muted-foreground bg-muted border-border")}>
      {type}
    </span>
  );
}

// ── kubectl command blocks ────────────────────────────────────────────────────

function KubectlBlock({ commands }: { commands: { label: string; cmd: string }[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };
  return (
    <div className="border-t border-border/50 bg-muted/20 px-4 py-3 space-y-1.5">
      {commands.map((k) => (
        <div key={k.label} className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-1.5">
          <code className="flex-1 text-[11px] font-mono text-foreground/80 truncate">{k.cmd}</code>
          <button
            onClick={(e) => { e.stopPropagation(); copy(k.label, k.cmd); }}
            className="shrink-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] border border-border bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            {copied === k.label ? <Check className="h-3 w-3 text-wxops-green" /> : <Copy className="h-3 w-3" />}
            copy
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Quota strip ───────────────────────────────────────────────────────────────

function QuotaStrip({ quotas }: { quotas: QuotaInfo[] }) {
  if (quotas.length === 0) return null;
  // Flatten all resources from all quotas, show key ones inline.
  const allRes = quotas.flatMap((q) => q.resources);
  const show = ["cpu", "memory", "pods"].map((key) => allRes.find((r) => r.name === key)).filter(Boolean) as QuotaResource[];
  if (show.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2 border-b bg-muted/20 text-[11px]">
      <span className="text-muted-foreground font-medium">Quota:</span>
      {show.map((r) => (
        <span key={r.name} className="flex items-center gap-1 text-muted-foreground">
          <span className="font-mono text-foreground/70">{r.name}</span>
          <span className="text-muted-foreground/50">{r.used || "0"} / {r.hard}</span>
        </span>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ClusterResourceTabs({ clusterId, reloadKey = 0 }: Props) {
  const [tab, setTab] = useState<Tab>("pods");
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [namespace, setNamespace] = useState<string>("default");
  const [resources, dispatchResource] = useReducer(resourceReducer, {
    loading: false, error: "", expired: false, pods: [], deployments: [], services: [],
  });
  const { loading, error, expired, pods, deployments, services } = resources;

  const [quotas, setQuotas] = useState<QuotaInfo[]>([]);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [drawerPod, setDrawerPod] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const autoRefreshKey = useRef(0);

  const fetchResources = useCallback(() => {
    dispatchResource({ type: "loading" });
    const endpointMap: Record<Tab, string> = {
      pods: "pods", deployments: "deployments", services: "services",
    };
    const endpoint = endpointMap[tab];
    fetch(`/api/v1/clusters/${clusterId}/${endpoint}?namespace=${encodeURIComponent(namespace)}`)
      .then(async (r) => {
        // 401 means the Pinniped session can no longer be exchanged for cluster
        // credentials — surface it as recoverable rather than as a fetch error.
        if (isSessionExpired(r.status)) return { __expired: true } as const;
        return r.json();
      })
      .then((data) => {
        if (data.__expired) {
          dispatchResource({ type: "expired" });
        } else if (data.error) {
          dispatchResource({ type: "error", message: data.error as string });
        } else if (tab === "pods") {
          dispatchResource({ type: "pods", items: data.pods ?? [] });
        } else if (tab === "deployments") {
          dispatchResource({ type: "deployments", items: data.deployments ?? [] });
        } else {
          dispatchResource({ type: "services", items: data.services ?? [] });
        }
      })
      .catch(() => dispatchResource({ type: "error", message: "Failed to fetch resources" }));
    setCountdown(REFRESH_INTERVAL);
    setExpandedRow(null);
    autoRefreshKey.current += 1;
  }, [clusterId, tab, namespace]);

  // Namespaces + quota on mount / cluster / namespace change.
  useEffect(() => {
    fetch(`/api/v1/clusters/${clusterId}/namespaces`)
      .then((r) => r.json())
      .then((data) => {
        const list: string[] = data.namespaces ?? [];
        setNamespaces(list);
        if (list.length > 0) setNamespace(list[0]);
      })
      .catch(() => {});
  }, [clusterId, reloadKey]);

  useEffect(() => {
    fetch(`/api/v1/clusters/${clusterId}/quotas?namespace=${encodeURIComponent(namespace)}`)
      .then((r) => r.json())
      .then((data) => setQuotas(data.quotas ?? []))
      .catch(() => setQuotas([]));
  }, [clusterId, namespace, reloadKey]);

  useEffect(() => { fetchResources(); }, [fetchResources, reloadKey]); // eslint-disable-line react-hooks/set-state-in-effect

  // 30s auto-refresh countdown.
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { fetchResources(); return REFRESH_INTERVAL; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [fetchResources]);

  // ── Health strip counts ──────────────────────────────────────────────────────
  const podCounts = pods.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});

  const tabDefs: { id: Tab; label: string; icon: React.ReactNode; count: number }[] = [
    { id: "pods",        label: "Pods",        icon: <Box    className="h-3.5 w-3.5" />, count: pods.length        },
    { id: "deployments", label: "Deployments", icon: <Rocket className="h-3.5 w-3.5" />, count: deployments.length },
    { id: "services",    label: "Services",    icon: <Globe  className="h-3.5 w-3.5" />, count: services.length    },
  ];

  const toggleRow = (key: string) => setExpandedRow((prev) => prev === key ? null : key);

  return (
    <>
      <Card>
        <CardHeader className="pb-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Tabs */}
            <div className="flex gap-0.5">
              {tabDefs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    tab === t.id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  {t.icon}
                  {t.label}
                  {t.count > 0 && (
                    <span className={cn(
                      "ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-mono leading-none",
                      tab === t.id ? "bg-background border border-border text-foreground" : "bg-muted text-muted-foreground"
                    )}>
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Namespace + refresh */}
            <div className="flex items-center gap-2">
              {namespaces.length > 0 ? (
                <Select value={namespace} onValueChange={(v) => v && setNamespace(v)}>
                  <SelectTrigger className="h-8 w-44 text-xs">
                    <SelectValue placeholder="Namespace" />
                  </SelectTrigger>
                  <SelectContent>
                    {namespaces.map((ns) => (
                      <SelectItem key={ns} value={ns} className="text-xs">{ns}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-xs text-muted-foreground font-mono">{namespace}</span>
              )}
              <button
                onClick={fetchResources}
                disabled={loading}
                title={`Auto-refreshes in ${countdown}s`}
                className="flex items-center gap-1.5 h-8 rounded-md border border-input bg-background px-2.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
              >
                <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
                <span className="tabular-nums text-muted-foreground">{countdown}s</span>
              </button>
            </div>
          </div>
        </CardHeader>

        {/* Quota strip */}
        <QuotaStrip quotas={quotas} />

        {/* Pod health strip */}
        {tab === "pods" && pods.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2 border-b bg-muted/10 text-[11px]">
            {podCounts["Running"]   && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-wxops-green" /><span className="text-wxops-green font-medium">{podCounts["Running"]} running</span></span>}
            {podCounts["Pending"]   && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" /><span className="text-amber-500 font-medium">{podCounts["Pending"]} pending</span></span>}
            {podCounts["Failed"]    && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-destructive" /><span className="text-destructive font-medium">{podCounts["Failed"]} failed</span></span>}
            {podCounts["Succeeded"] && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-wxops-cyan" /><span className="text-wxops-cyan font-medium">{podCounts["Succeeded"]} succeeded</span></span>}
          </div>
        )}

        <CardContent className="pt-4 px-0 pb-0">
          {loading && pods.length === 0 && deployments.length === 0 && services.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground px-5 py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          )}
          {!loading && expired && (
            <div className="px-5 pb-4">
              <SessionExpired resource="cluster resources" compact />
            </div>
          )}
          {!loading && !expired && error && <p className="text-sm text-destructive px-5 pb-4">{error}</p>}

          {/* ── Pods ─────────────────────────────────────────────────────── */}
          {tab === "pods" && !error && (
            <div className={cn("transition-opacity", loading && "opacity-60 pointer-events-none")}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2.5 pl-5 pr-4 text-xs font-medium text-muted-foreground">Name</th>
                    <th className="pb-2.5 pr-4 text-xs font-medium text-muted-foreground">Status</th>
                    <th className="pb-2.5 pr-4 text-xs font-medium text-muted-foreground">Node</th>
                    <th className="pb-2.5 pr-4 text-xs font-medium text-muted-foreground" />
                  </tr>
                </thead>
                <tbody>
                  {pods.map((p) => {
                    const sm = podStatusMeta(p.status);
                    const isExpanded = expandedRow === p.name;
                    const cmds = [
                      { label: "exec bash",       cmd: `kubectl exec -it -n ${namespace} ${p.name} -- bash` },
                      { label: "logs (tail 100)", cmd: `kubectl logs -n ${namespace} ${p.name} --tail=100 -f` },
                      { label: "port-forward",    cmd: `kubectl port-forward -n ${namespace} ${p.name} 8080:8080` },
                      { label: "describe",        cmd: `kubectl describe pod ${p.name} -n ${namespace}` },
                    ];
                    return (
                      <Fragment key={p.name}>
                        <tr
                          onClick={() => toggleRow(p.name)}
                          className="group border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                        >
                          <td className="py-2.5 pl-5 pr-4">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {isExpanded
                                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100" />
                              }
                              <span className="font-mono text-xs text-foreground/85 truncate max-w-[220px]">{p.name}</span>
                              <CopyBtn value={p.name} />
                            </div>
                          </td>
                          <td className="py-2.5 pr-4">
                            <div className="flex items-center gap-1.5">
                              <span className={cn("h-2 w-2 rounded-full shrink-0", sm.dot)} />
                              <span className={cn("text-xs font-medium", sm.color)}>{p.status || "Unknown"}</span>
                            </div>
                          </td>
                          <td className="py-2.5 pr-4 text-xs text-muted-foreground">{p.node || "—"}</td>
                          <td className="py-2.5 pr-4">
                            <button
                              onClick={(e) => { e.stopPropagation(); setDrawerPod(p.name); }}
                              className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground border border-border rounded px-1.5 py-0.5 bg-muted/50 hover:bg-muted transition-colors"
                            >
                              <ExternalLink className="h-3 w-3" />
                              details
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b">
                            <td colSpan={4} className="p-0">
                              <KubectlBlock commands={cmds} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {pods.length === 0 && !loading && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                        No pods in <span className="font-mono">{namespace}</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Deployments ──────────────────────────────────────────────── */}
          {tab === "deployments" && !error && (
            <div className={cn("transition-opacity", loading && "opacity-60 pointer-events-none")}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2.5 pl-5 pr-4 text-xs font-medium text-muted-foreground">Name</th>
                    <th className="pb-2.5 pr-4 text-xs font-medium text-muted-foreground">Replicas</th>
                    <th className="pb-2.5 pr-4 text-xs font-medium text-muted-foreground">Health</th>
                  </tr>
                </thead>
                <tbody>
                  {deployments.map((d) => {
                    const h = deployHealth(d.ready, d.desired);
                    const isExpanded = expandedRow === d.name;
                    const cmds = [
                      { label: "rollout status", cmd: `kubectl rollout status deployment/${d.name} -n ${namespace}` },
                      { label: "describe",        cmd: `kubectl describe deployment ${d.name} -n ${namespace}` },
                      { label: "scale to 0",      cmd: `kubectl scale deployment/${d.name} --replicas=0 -n ${namespace}` },
                      { label: "scale to 1",      cmd: `kubectl scale deployment/${d.name} --replicas=1 -n ${namespace}` },
                    ];
                    return (
                      <Fragment key={d.name}>
                        <tr
                          onClick={() => toggleRow(d.name)}
                          className="group border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                        >
                          <td className="py-2.5 pl-5 pr-4">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {isExpanded
                                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100" />
                              }
                              <span className="font-mono text-xs text-foreground/85 truncate max-w-[240px]">{d.name}</span>
                              <CopyBtn value={d.name} />
                            </div>
                          </td>
                          <td className="py-2.5 pr-4">
                            <span className={cn(
                              "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums",
                              h.bg, h.border, h.color
                            )}>
                              {d.ready}/{d.desired}
                            </span>
                          </td>
                          <td className="py-2.5 pr-4">
                            <DeploymentDots ready={d.ready} desired={d.desired} />
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b">
                            <td colSpan={3} className="p-0">
                              <KubectlBlock commands={cmds} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {deployments.length === 0 && !loading && (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                        No deployments in <span className="font-mono">{namespace}</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Services ─────────────────────────────────────────────────── */}
          {tab === "services" && !error && (
            <div className={cn("transition-opacity", loading && "opacity-60 pointer-events-none")}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2.5 pl-5 pr-4 text-xs font-medium text-muted-foreground">Name</th>
                    <th className="pb-2.5 pr-4 text-xs font-medium text-muted-foreground">Type</th>
                    <th className="pb-2.5 pr-4 text-xs font-medium text-muted-foreground">Cluster IP</th>
                    <th className="pb-2.5 pr-5 text-xs font-medium text-muted-foreground">Port(s)</th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((svc) => {
                    const isExpanded = expandedRow === svc.name;
                    const dns = `${svc.name}.${namespace}.svc.cluster.local`;
                    const portStr = svc.ports.map((p) => `${p.port}${p.protocol !== "TCP" ? "/" + p.protocol : ""}`).join(", ");
                    return (
                      <Fragment key={svc.name}>
                        <tr
                          onClick={() => toggleRow(svc.name)}
                          className="group border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                        >
                          <td className="py-2.5 pl-5 pr-4">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {isExpanded
                                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100" />
                              }
                              <span className="font-mono text-xs text-foreground/85 truncate max-w-[180px]">{svc.name}</span>
                              <CopyBtn value={svc.name} />
                            </div>
                          </td>
                          <td className="py-2.5 pr-4"><ServiceTypeBadge type={svc.type} /></td>
                          <td className="py-2.5 pr-4 font-mono text-xs text-muted-foreground">{svc.clusterIP}</td>
                          <td className="py-2.5 pr-5 font-mono text-xs text-muted-foreground">{portStr || "—"}</td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b">
                            <td colSpan={4} className="p-0">
                              <div className="border-t border-border/50 bg-muted/20 px-5 py-3 space-y-3">
                                {/* DNS name */}
                                <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
                                  <span className="text-[10px] text-muted-foreground font-medium shrink-0 w-16">DNS</span>
                                  <code className="flex-1 text-[11px] font-mono text-foreground/85 truncate">{dns}</code>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(dns); }}
                                    className="shrink-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] border border-border bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    <Copy className="h-3 w-3" />
                                    copy
                                  </button>
                                </div>

                                {/* Port details */}
                                {svc.ports.length > 0 && (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs border rounded-lg overflow-hidden">
                                      <thead>
                                        <tr className="bg-muted/50 border-b">
                                          <th className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground">Name</th>
                                          <th className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground">Protocol</th>
                                          <th className="px-3 py-1.5 text-right text-[10px] font-medium text-muted-foreground">Port</th>
                                          <th className="px-3 py-1.5 text-right text-[10px] font-medium text-muted-foreground">TargetPort</th>
                                          {svc.type === "NodePort" && <th className="px-3 py-1.5 text-right text-[10px] font-medium text-muted-foreground">NodePort</th>}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {svc.ports.map((p, i) => (
                                          <tr key={i} className="border-t border-border/40">
                                            <td className="px-3 py-1.5 font-mono text-muted-foreground">{p.name || "—"}</td>
                                            <td className="px-3 py-1.5 font-mono">{p.protocol}</td>
                                            <td className="px-3 py-1.5 text-right font-mono tabular-nums">{p.port}</td>
                                            <td className="px-3 py-1.5 text-right font-mono tabular-nums">{p.targetPort}</td>
                                            {svc.type === "NodePort" && <td className="px-3 py-1.5 text-right font-mono tabular-nums">{p.nodePort || "—"}</td>}
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}

                                {/* kubectl commands for service */}
                                <KubectlBlock commands={[
                                  { label: "describe", cmd: `kubectl describe service ${svc.name} -n ${namespace}` },
                                  { label: "port-forward", cmd: `kubectl port-forward service/${svc.name} -n ${namespace} ${svc.ports[0]?.port ?? 80}:${svc.ports[0]?.port ?? 80}` },
                                ]} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {services.length === 0 && !loading && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                        No services in <span className="font-mono">{namespace}</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="h-2" />
        </CardContent>
      </Card>

      {/* Pod detail drawer */}
      {drawerPod && (
        <PodDetailDrawer
          clusterId={clusterId}
          podName={drawerPod}
          namespace={namespace}
          onClose={() => setDrawerPod(null)}
        />
      )}
    </>
  );
}
