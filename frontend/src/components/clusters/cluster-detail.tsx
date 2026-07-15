"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, Download, Loader2, RefreshCw, Copy, Check, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClusterResourceTabs } from "@/components/clusters/cluster-resource-tabs";

interface IdentityInfo {
  username: string;
  uid: string;
  groups: string[];
}

interface Props {
  clusterId: string;
  clusterName: string;
}

type IdentityState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: IdentityInfo };

type IdentityAction =
  | { type: "loading" }
  | { type: "success"; data: IdentityInfo }
  | { type: "error"; message: string };

function identityReducer(_: IdentityState, action: IdentityAction): IdentityState {
  switch (action.type) {
    case "loading": return { status: "loading" };
    case "success": return { status: "success", data: action.data };
    case "error":   return { status: "error", message: action.message };
  }
}

// With the "One Token" model, the Pinniped Supervisor id_token lives in the
// encrypted session cookie managed by the Go backend.  No per-cluster popup or
// sessionStorage token is needed — the backend reads the cookie and forwards it
// to the spoke cluster automatically.
export function ClusterDetail({ clusterId, clusterName }: Props) {
  const [identityState, dispatch] = useReducer(identityReducer, { status: "loading" });
  const [fetchTrigger, setFetchTrigger] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [kubeconfigDownloaded, setKubeconfigDownloaded] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // Button handler — dispatches loading state from an event handler (not inside an
  // effect) so the react-hooks/set-state-in-effect rule is not triggered.
  const handleReload = useCallback(() => {
    dispatch({ type: "loading" });
    setFetchTrigger((t) => t + 1);
    setReloadKey((k) => k + 1);
  }, []);

  // Pure async fetch — no synchronous setState here; initial loading state comes
  // from useReducer's initial value, subsequent loading from handleReload above.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/clusters/${clusterId}/identity`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) dispatch({ type: "error", message: data.error as string });
        else dispatch({ type: "success", data: data as IdentityInfo });
      })
      .catch((e: unknown) => {
        if (!cancelled) dispatch({ type: "error", message: String(e) });
      });
    return () => { cancelled = true; };
  }, [clusterId, fetchTrigger]);

  async function downloadKubeconfig() {
    const res = await fetch(`/api/v1/clusters/${clusterId}/kubeconfig`);
    const text = await res.text();
    const blob = new Blob([text], { type: "application/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kubeconfig-${clusterId}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setKubeconfigDownloaded(true);
  }

  const kubeconfigSnippet = [
    `export KUBECONFIG=~/Downloads/kubeconfig-${clusterId}.yaml`,
    `kubectl get pods -n <your-namespace>`,
    `kubectl auth whoami`,
  ].join("\n");

  return (
    <div className="space-y-6">
      {/* Identity card */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Kubernetes Identity — {clusterName}</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleReload}
                disabled={identityState.status === "loading"}
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${identityState.status === "loading" ? "animate-spin" : ""}`} />
                Reload
              </button>
              <button
                onClick={downloadKubeconfig}
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <Download className="h-3 w-3" />
                Download kubeconfig
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {identityState.status === "loading" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading identity…
            </div>
          )}
          {identityState.status === "error" && (
            <p className="text-sm text-destructive">
              {identityState.message || "session expired — please log in or reload again"}
            </p>
          )}
          {identityState.status === "success" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div>
                  <span className="text-xs text-muted-foreground">Username</span>
                  <p className="font-mono text-sm">{identityState.data.username}</p>
                </div>
                {identityState.data.uid && (
                  <div>
                    <span className="text-xs text-muted-foreground">UID</span>
                    <p className="font-mono text-sm">{identityState.data.uid}</p>
                  </div>
                )}
              </div>

              {identityState.data.groups?.length > 0 && (
                <div>
                  <span className="text-xs text-muted-foreground">Groups</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {identityState.data.groups.map((g) => (
                      <Badge key={g} variant="secondary" className="text-xs">
                        {g}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>

        {/* Kubeconfig usage snippet — shown after first download */}
        {kubeconfigDownloaded && (
          <div className="border-t bg-muted/20 px-5 py-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-medium text-muted-foreground">Use your kubeconfig</p>
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(kubeconfigSnippet).then(() => {
                    setCopiedSnippet(true);
                    setTimeout(() => setCopiedSnippet(false), 1500);
                  });
                }}
                className={cn(
                  "flex items-center gap-1 text-[10px] rounded border px-1.5 py-0.5 transition-colors",
                  copiedSnippet
                    ? "text-wxops-green border-wxops-green/30 bg-wxops-green/10"
                    : "text-muted-foreground border-border bg-muted/50 hover:bg-muted hover:text-foreground"
                )}
              >
                {copiedSnippet ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copiedSnippet ? "copied" : "copy all"}
              </button>
            </div>
            <div className="rounded-lg border bg-card overflow-hidden">
              {kubeconfigSnippet.split("\n").map((line, i) => (
                <div key={i} className={cn("flex items-center gap-2 px-3 py-1.5 font-mono text-xs", i > 0 && "border-t border-border/40")}>
                  <span className="text-muted-foreground/40 select-none tabular-nums w-3">{i + 1}</span>
                  <span className={cn("text-foreground/80", line.startsWith("#") && "text-muted-foreground/60")}>{line}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Resource tabs — session cookie forwarded automatically */}
      <ClusterResourceTabs clusterId={clusterId} reloadKey={reloadKey} />
    </div>
  );
}
