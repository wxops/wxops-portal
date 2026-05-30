"use client";

import { useEffect, useReducer } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, Download, Loader2 } from "lucide-react";
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

  // Load identity via Pinniped WhoAmIRequest on mount / cluster change.
  useEffect(() => {
    dispatch({ type: "loading" });
    fetch(`/api/v1/clusters/${clusterId}/identity`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) dispatch({ type: "error", message: data.error as string });
        else dispatch({ type: "success", data: data as IdentityInfo });
      })
      .catch((e: unknown) => dispatch({ type: "error", message: String(e) }));
  }, [clusterId]);

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
  }

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
            <button
              onClick={downloadKubeconfig}
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Download className="h-3 w-3" />
              Download kubeconfig
            </button>
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
            <p className="text-sm text-destructive">{identityState.message}</p>
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
      </Card>

      {/* Resource tabs — session cookie forwarded automatically */}
      <ClusterResourceTabs clusterId={clusterId} />
    </div>
  );
}
