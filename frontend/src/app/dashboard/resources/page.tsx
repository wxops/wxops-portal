import { Suspense } from "react";
import { cookies } from "next/headers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FolderOpen } from "lucide-react";
import { ResourceControls } from "@/components/resources/resource-controls";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

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

async function fetchNamespaces(cookie: string): Promise<{ namespaces: string[]; error?: string }> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/k8s/namespaces`, {
      headers: { Cookie: `wxops_session=${cookie}` },
      cache: "no-store",
    });
    if (!res.ok) return { namespaces: [], error: await res.text() };
    return res.json();
  } catch {
    return { namespaces: [], error: "Backend unreachable" };
  }
}

async function fetchPods(cookie: string, namespace: string): Promise<{ pods: PodInfo[]; error?: string }> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/v1/k8s/pods?namespace=${encodeURIComponent(namespace)}`,
      { headers: { Cookie: `wxops_session=${cookie}` }, cache: "no-store" }
    );
    if (!res.ok) return { pods: [], error: await res.text() };
    return res.json();
  } catch {
    return { pods: [], error: "Backend unreachable" };
  }
}

async function fetchDeployments(cookie: string, namespace: string): Promise<{ deployments: DeploymentInfo[]; error?: string }> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/v1/k8s/deployments?namespace=${encodeURIComponent(namespace)}`,
      { headers: { Cookie: `wxops_session=${cookie}` }, cache: "no-store" }
    );
    if (!res.ok) return { deployments: [], error: await res.text() };
    return res.json();
  } catch {
    return { deployments: [], error: "Backend unreachable" };
  }
}

const statusVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  Running: "default",
  Pending: "secondary",
  Failed: "destructive",
  Succeeded: "outline",
};

export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; namespace?: string }>;
}) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("wxops_session")?.value ?? "";
  const params = await searchParams;
  const tab = params.tab ?? "namespaces";
  const namespace = params.namespace ?? "default";

  // Namespaces are always fetched: used for the grid tab AND the namespace selector.
  const { namespaces, error: nsError } = await fetchNamespaces(sessionCookie);

  let pods: PodInfo[] = [];
  let podError = "";
  let deployments: DeploymentInfo[] = [];
  let depError = "";

  if (tab === "pods") {
    const result = await fetchPods(sessionCookie, namespace);
    pods = result.pods ?? [];
    podError = result.error ?? "";
  }
  if (tab === "deployments") {
    const result = await fetchDeployments(sessionCookie, namespace);
    deployments = result.deployments ?? [];
    depError = result.error ?? "";
  }

  const activeError =
    tab === "namespaces" ? nsError ?? "" :
    tab === "pods" ? podError :
    depError;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cluster Resources</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          RBAC-filtered via Pinniped JWTAuthenticator
        </p>
      </div>

      {/* Tab switcher + namespace selector (client component) */}
      <Suspense>
        <ResourceControls
          activeTab={tab}
          activeNamespace={namespace}
          namespaces={namespaces}
        />
      </Suspense>

      {activeError && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
          {activeError}
        </div>
      )}

      {/* ── Namespaces ────────────────────────────────────────────────── */}
      {tab === "namespaces" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {namespaces.map((ns) => (
            <Card
              key={ns}
              className="border-border hover:border-wxops-purple/40 transition-colors"
            >
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4 text-purple-400" />
                  <CardTitle className="text-sm font-medium truncate">{ns}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <Badge variant="secondary" className="text-xs">
                  Active
                </Badge>
              </CardContent>
            </Card>
          ))}
          {namespaces.length === 0 && !nsError && (
            <p className="col-span-full text-sm text-muted-foreground">
              No namespaces found.
            </p>
          )}
        </div>
      )}

      {/* ── Pods ──────────────────────────────────────────────────────── */}
      {tab === "pods" && (
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Namespace</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Node</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pods.map((pod) => (
                <tr
                  key={`${pod.namespace}/${pod.name}`}
                  className="hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-2.5 font-mono text-xs">{pod.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{pod.namespace}</td>
                  <td className="px-4 py-2.5">
                    <Badge
                      variant={statusVariant[pod.status] ?? "outline"}
                      className="text-xs"
                    >
                      {pod.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">
                    {pod.node || "—"}
                  </td>
                </tr>
              ))}
              {pods.length === 0 && !podError && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    No pods found in{" "}
                    <span className="font-medium">{namespace}</span>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Deployments ───────────────────────────────────────────────── */}
      {tab === "deployments" && (
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Namespace</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Ready</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Desired</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {deployments.map((dep) => {
                const healthy = dep.ready === dep.desired && dep.desired > 0;
                return (
                  <tr
                    key={`${dep.namespace}/${dep.name}`}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-2.5 font-mono text-xs">{dep.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{dep.namespace}</td>
                    <td className="px-4 py-2.5">{dep.ready}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{dep.desired}</td>
                    <td className="px-4 py-2.5">
                      <Badge
                        variant={healthy ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {dep.desired === 0
                          ? "Scaled down"
                          : healthy
                          ? "Healthy"
                          : "Degraded"}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
              {deployments.length === 0 && !depError && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    No deployments found in{" "}
                    <span className="font-medium">{namespace}</span>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
