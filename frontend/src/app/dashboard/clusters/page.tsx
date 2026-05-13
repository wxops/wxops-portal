import { cookies } from "next/headers";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Server } from "lucide-react";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

interface ClusterInfo {
  id: string;
  name: string;
  api_server: string;
}

async function fetchClusters(cookie: string): Promise<{ clusters: ClusterInfo[]; error?: string }> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/clusters`, {
      headers: { Cookie: `wxops_session=${cookie}` },
      cache: "no-store",
    });
    if (!res.ok) return { clusters: [], error: await res.text() };
    return res.json();
  } catch {
    return { clusters: [], error: "Backend unreachable" };
  }
}

export default async function ClustersPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get("wxops_session")?.value ?? "";

  const { clusters, error } = await fetchClusters(session);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Clusters</h1>
        <p className="text-muted-foreground mt-1">
          Select a cluster and connect to view its resources.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          Failed to load clusters: {error}
        </div>
      )}

      {clusters.length === 0 && !error && (
        <div className="rounded-md border border-dashed px-6 py-12 text-center text-muted-foreground">
          No clusters available. Ask an admin to grant you access.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clusters.map((cl) => (
          <Card key={cl.id} className="flex flex-col">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">{cl.name}</CardTitle>
                </div>
                <Badge variant="secondary" className="shrink-0 text-xs">
                  Pinniped
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">API Server</p>
                <p className="truncate text-sm font-mono">{cl.api_server}</p>
              </div>
              <div className="mt-auto flex gap-2">
                <Link
                  href={`/dashboard/clusters/${cl.id}`}
                  className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90"
                >
                  View Resources
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
