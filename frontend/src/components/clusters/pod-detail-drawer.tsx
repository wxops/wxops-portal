"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  X, Copy, Check, Loader2, Terminal, Package,
  HardDrive, AlertCircle, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContainerEnv {
  name: string;
  value: string;
  source: "literal" | "secret" | "configmap" | "field";
}

interface VolumeMount {
  name: string;
  mountPath: string;
  readOnly: boolean;
}

interface ContainerDetail {
  name: string;
  image: string;
  ready: boolean;
  restartCount: number;
  requests: Record<string, string>;
  limits: Record<string, string>;
  env: ContainerEnv[];
  envFrom: string[];
  volumeMounts: VolumeMount[];
}

interface PodDetail {
  name: string;
  namespace: string;
  status: string;
  node: string;
  containers: ContainerDetail[];
}

interface Props {
  clusterId: string;
  podName: string;
  namespace: string;
  onClose: () => void;
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={copy}
      title="Copy"
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border border-border bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-wxops-green" /> : <Copy className="h-3 w-3" />}
      {label && <span>{label}</span>}
    </button>
  );
}

// ── Source badge for env vars ─────────────────────────────────────────────────

function SourceBadge({ source }: { source: ContainerEnv["source"] }) {
  const styles: Record<typeof source, string> = {
    secret:    "text-amber-500 bg-amber-500/10 border-amber-500/20",
    configmap: "text-wxops-cyan bg-wxops-cyan/10 border-wxops-cyan/20",
    field:     "text-wxops-purple bg-wxops-purple/10 border-wxops-purple/20",
    literal:   "text-muted-foreground bg-muted border-border",
  };
  const labels: Record<typeof source, string> = {
    secret: "secret", configmap: "cm", field: "field", literal: "env",
  };
  return (
    <span className={cn("rounded border px-1.5 py-0.5 text-[9px] font-mono font-medium leading-none", styles[source])}>
      {labels[source]}
    </span>
  );
}

// ── Main drawer ───────────────────────────────────────────────────────────────

export function PodDetailDrawer({ clusterId, podName, namespace, onClose }: Props) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [detail, setDetail] = useState<PodDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeContainer, setActiveContainer] = useState(0);

  const load = () => {
    setLoading(true);
    setError("");
    fetch(`/api/v1/clusters/${clusterId}/pods/${encodeURIComponent(podName)}?namespace=${encodeURIComponent(namespace)}`)
      .then((r) => r.json())
      .then((data: PodDetail & { error?: string }) => {
        if (data.error) setError(data.error);
        else { setDetail(data); setActiveContainer(0); }
        setLoading(false);
      })
      .catch(() => { setError("Failed to load pod detail"); setLoading(false); });
  };

  useEffect(() => { load(); }, [clusterId, podName, namespace]); // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const kubectlCmds = [
    { label: "exec bash",       cmd: `kubectl exec -it -n ${namespace} ${podName} -- bash` },
    { label: "logs (tail 100)", cmd: `kubectl logs -n ${namespace} ${podName} --tail=100 -f` },
    { label: "port-forward",    cmd: `kubectl port-forward -n ${namespace} ${podName} 8080:8080` },
    { label: "describe",        cmd: `kubectl describe pod ${podName} -n ${namespace}` },
  ];

  const ctr = detail?.containers[activeContainer];

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col bg-card border-l shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="shrink-0 flex items-start gap-3 px-5 py-4 border-b">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold truncate font-mono">{podName}</p>
              <CopyButton value={podName} />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">{namespace}</p>
          </div>
          {detail && (
            <button
              onClick={load}
              className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto divide-y divide-border">

          {/* kubectl commands — always shown without fetch */}
          <section className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">kubectl commands</span>
            </div>
            <div className="space-y-1.5">
              {kubectlCmds.map((k) => (
                <div key={k.label} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                  <code className="flex-1 text-[11px] font-mono text-foreground/85 truncate">{k.cmd}</code>
                  <CopyButton value={k.cmd} />
                </div>
              ))}
            </div>
          </section>

          {/* Loading / error states for the fetched detail */}
          {loading && (
            <div className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading container details…
            </div>
          )}

          {!loading && error && (
            <div className="flex items-start gap-2 px-5 py-4 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {!loading && detail && (
            <>
              {/* Container selector */}
              {detail.containers.length > 1 && (
                <div className="flex gap-1 px-5 py-3">
                  {detail.containers.map((c, i) => (
                    <button
                      key={c.name}
                      onClick={() => setActiveContainer(i)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                        i === activeContainer ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}

              {ctr && (
                <>
                  {/* Container image + status */}
                  <section className="px-5 py-4 space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Package className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Container</span>
                    </div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] text-muted-foreground">Image</p>
                        <p className="font-mono text-xs text-foreground/85 break-all">{ctr.image}</p>
                      </div>
                      <CopyButton value={ctr.image} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[11px] text-muted-foreground mb-1">Status</p>
                        <div className="flex items-center gap-1.5">
                          <span className={cn("h-2 w-2 rounded-full", ctr.ready ? "bg-wxops-green" : "bg-amber-400")} />
                          <span className="text-xs">{ctr.ready ? "Ready" : "Not ready"}</span>
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] text-muted-foreground mb-1">Restarts</p>
                        <span className={cn("text-xs font-semibold tabular-nums", ctr.restartCount > 0 ? "text-amber-500" : "text-foreground")}>
                          {ctr.restartCount}
                        </span>
                      </div>
                    </div>

                    {/* Resource limits */}
                    {(Object.keys(ctr.requests).length > 0 || Object.keys(ctr.limits).length > 0) && (
                      <div className="rounded-lg border bg-muted/30 overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b">
                              <th className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground">Resource</th>
                              <th className="px-3 py-1.5 text-right text-[10px] font-medium text-muted-foreground">Request</th>
                              <th className="px-3 py-1.5 text-right text-[10px] font-medium text-muted-foreground">Limit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {["cpu", "memory"].map((res) => {
                              const req = ctr.requests[res];
                              const lim = ctr.limits[res];
                              if (!req && !lim) return null;
                              return (
                                <tr key={res} className="border-t border-border/50">
                                  <td className="px-3 py-1.5 font-mono text-muted-foreground">{res}</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{req || "—"}</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{lim || "—"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  {/* Env vars */}
                  {(ctr.env.length > 0 || ctr.envFrom.length > 0) && (
                    <section className="px-5 py-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Environment</p>

                      {/* envFrom bulk imports */}
                      {ctr.envFrom.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {ctr.envFrom.map((ef) => {
                            const [kind, name] = ef.split(":");
                            return (
                              <span key={ef} className={cn(
                                "rounded border px-2 py-0.5 text-[10px] font-mono",
                                kind === "secret"
                                  ? "text-amber-500 bg-amber-500/10 border-amber-500/20"
                                  : "text-wxops-cyan bg-wxops-cyan/10 border-wxops-cyan/20"
                              )}>
                                {kind}/{name}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {/* Individual env vars */}
                      {ctr.env.length > 0 && (
                        <div className="rounded-lg border overflow-hidden">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b bg-muted/30">
                                <th className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground">Key</th>
                                <th className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground">Value</th>
                                <th className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground">From</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ctr.env.map((e) => (
                                <tr key={e.name} className="border-t border-border/40 hover:bg-muted/20">
                                  <td className="px-3 py-1.5 font-mono text-foreground/85 max-w-[120px] truncate">{e.name}</td>
                                  <td className="px-3 py-1.5 font-mono text-muted-foreground max-w-[140px] truncate">
                                    {e.source === "secret" ? (
                                      <span className="text-amber-500/70">***</span>
                                    ) : (
                                      e.value || <span className="text-muted-foreground/40">—</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5"><SourceBadge source={e.source} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  )}

                  {/* Volume mounts */}
                  {ctr.volumeMounts.length > 0 && (
                    <section className="px-5 py-4">
                      <div className="flex items-center gap-2 mb-3">
                        <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Volume mounts</p>
                      </div>
                      <div className="space-y-1.5">
                        {ctr.volumeMounts.map((vm) => (
                          <div key={vm.name + vm.mountPath} className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
                            <span className="font-mono text-foreground/80 shrink-0">{vm.name}</span>
                            <span className="text-muted-foreground/50">→</span>
                            <span className="font-mono text-muted-foreground truncate flex-1">{vm.mountPath}</span>
                            {vm.readOnly && (
                              <span className="shrink-0 text-[9px] text-amber-500 border border-amber-500/30 bg-amber-500/10 rounded px-1">ro</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
