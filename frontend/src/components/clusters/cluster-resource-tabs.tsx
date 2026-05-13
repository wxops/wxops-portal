"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Box, Rocket, Loader2 } from "lucide-react";

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

type Tab = "pods" | "deployments";

// token prop removed — the backend reads the session cookie directly.
// The "One Token" from Pinniped Supervisor is stored server-side.
interface Props {
  clusterId: string;
}

export function ClusterResourceTabs({ clusterId }: Props) {
  const [tab, setTab] = useState<Tab>("pods");
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [namespace, setNamespace] = useState<string>("default");
  const [pods, setPods] = useState<PodInfo[]>([]);
  const [deployments, setDeployments] = useState<DeploymentInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Fetch namespaces once on mount to populate the namespace selector.
  useEffect(() => {
    fetch(`/api/v1/clusters/${clusterId}/namespaces`)
      .then((r) => r.json())
      .then((data) => {
        const list: string[] = data.namespaces ?? [];
        setNamespaces(list);
        if (list.length > 0) setNamespace(list[0]);
      })
      .catch(() => {/* namespace selector stays at "default" */});
  }, [clusterId]);

  // Fetch resources whenever tab or namespace changes.
  useEffect(() => {
    setLoading(true);
    setError("");
    const endpoint = tab === "pods" ? "pods" : "deployments";
    fetch(`/api/v1/clusters/${clusterId}/${endpoint}?namespace=${encodeURIComponent(namespace)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error as string);
        } else if (tab === "pods") {
          setPods(data.pods ?? []);
        } else {
          setDeployments(data.deployments ?? []);
        }
      })
      .catch(() => setError("Failed to fetch resources"))
      .finally(() => setLoading(false));
  }, [tab, namespace, clusterId]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "pods", label: "Pods", icon: <Box className="h-4 w-4" /> },
    { id: "deployments", label: "Deployments", icon: <Rocket className="h-4 w-4" /> },
  ];

  const statusVariant = (s: string): "default" | "secondary" | "destructive" | "outline" => {
    if (s === "Running") return "default";
    if (s === "Pending") return "secondary";
    return "destructive";
  };

  return (
    <Card>
      <CardHeader className="pb-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 border-b">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
          {namespaces.length > 0 ? (
            <Select value={namespace} onValueChange={(v) => v && setNamespace(v)}>
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue placeholder="Namespace" />
              </SelectTrigger>
              <SelectContent>
                {namespaces.map((ns) => (
                  <SelectItem key={ns} value={ns} className="text-xs">
                    {ns}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-xs text-muted-foreground">{namespace}</span>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}
        {!loading && error && <p className="text-sm text-destructive">{error}</p>}

        {/* Pods */}
        {tab === "pods" && !loading && !error && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Name</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 font-medium">Node</th>
                </tr>
              </thead>
              <tbody>
                {pods.map((p) => (
                  <tr key={p.name} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                    <td className="py-2 pr-4 font-mono text-xs">{p.name}</td>
                    <td className="py-2 pr-4">
                      <Badge variant={statusVariant(p.status)} className="text-xs">
                        {p.status}
                      </Badge>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">{p.node || "—"}</td>
                  </tr>
                ))}
                {pods.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                      No pods in <span className="font-mono">{namespace}</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Deployments */}
        {tab === "deployments" && !loading && !error && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Name</th>
                  <th className="pb-2 font-medium">Ready / Desired</th>
                </tr>
              </thead>
              <tbody>
                {deployments.map((d) => (
                  <tr key={d.name} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                    <td className="py-2 pr-4 font-mono text-xs">{d.name}</td>
                    <td className="py-2">
                      <Badge
                        variant={d.ready === d.desired ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {d.ready}/{d.desired}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {deployments.length === 0 && (
                  <tr>
                    <td colSpan={2} className="py-6 text-center text-sm text-muted-foreground">
                      No deployments in <span className="font-mono">{namespace}</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
