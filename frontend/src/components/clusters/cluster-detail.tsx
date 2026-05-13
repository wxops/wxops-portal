"use client";

import { useEffect, useState } from "react";
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

// With the "One Token" model, the Pinniped Supervisor id_token lives in the
// encrypted session cookie managed by the Go backend.  No per-cluster popup or
// sessionStorage token is needed — the backend reads the cookie and forwards it
// to the spoke cluster automatically.
export function ClusterDetail({ clusterId, clusterName }: Props) {
  const [identity, setIdentity] = useState<IdentityInfo | null>(null);
  const [identityError, setIdentityError] = useState("");
  const [loadingIdentity, setLoadingIdentity] = useState(true);

  // Load identity via Pinniped WhoAmIRequest on mount.
  useEffect(() => {
    setLoadingIdentity(true);
    setIdentityError("");
    fetch(`/api/v1/clusters/${clusterId}/identity`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setIdentityError(data.error as string);
        else setIdentity(data as IdentityInfo);
      })
      .catch((e: unknown) => setIdentityError(String(e)))
      .finally(() => setLoadingIdentity(false));
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
          {loadingIdentity && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading identity…
            </div>
          )}
          {identityError && !loadingIdentity && (
            <p className="text-sm text-destructive">{identityError}</p>
          )}
          {identity && !loadingIdentity && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div>
                  <span className="text-xs text-muted-foreground">Username</span>
                  <p className="font-mono text-sm">{identity.username}</p>
                </div>
                {identity.uid && (
                  <div>
                    <span className="text-xs text-muted-foreground">UID</span>
                    <p className="font-mono text-sm">{identity.uid}</p>
                  </div>
                )}
              </div>

              {identity.groups?.length > 0 && (
                <div>
                  <span className="text-xs text-muted-foreground">Groups</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {identity.groups.map((g) => (
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
