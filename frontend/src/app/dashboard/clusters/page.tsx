import { cookies } from "next/headers";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Server, ChevronRight, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

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

// Derive environment label and color from cluster id/name.
function envFromCluster(id: string, name: string): { label: string; color: string; dot: string } {
  const s = (id + " " + name).toLowerCase();
  if (s.includes("prod"))    return { label: "production", color: "text-wxops-green border-wxops-green/40 bg-wxops-green/10",  dot: "bg-wxops-green"  };
  if (s.includes("staging")) return { label: "staging",    color: "text-wxops-cyan border-wxops-cyan/40 bg-wxops-cyan/10",    dot: "bg-wxops-cyan"   };
  if (s.includes("dev"))     return { label: "dev",        color: "text-wxops-purple border-wxops-purple/40 bg-wxops-purple/10", dot: "bg-wxops-purple" };
  return                              { label: "cluster",   color: "text-muted-foreground border-border bg-muted/40",           dot: "bg-muted-foreground" };
}

export default async function ClustersPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get("wxops_session")?.value ?? "";

  const { clusters, error } = await fetchClusters(session);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clusters</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Spoke clusters accessible via your Pinniped session.
          </p>
        </div>
        {clusters.length > 0 && (
          <span className="text-sm text-muted-foreground tabular-nums shrink-0">
            {clusters.length} cluster{clusters.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Failed to load clusters: {error}
        </div>
      )}

      {clusters.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border bg-muted/50">
            <Server className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">No clusters available</p>
            <p className="text-xs text-muted-foreground mt-1">Ask a platform admin to grant your team cluster access.</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clusters.map((cl) => {
          const env = envFromCluster(cl.id, cl.name);
          return (
            <Link
              key={cl.id}
              href={`/dashboard/clusters/${cl.id}`}
              className="group flex flex-col rounded-xl border bg-card p-5 gap-4 transition-colors hover:bg-muted/30 hover:border-border/80"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
                    <Server className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm leading-tight truncate">{cl.name}</p>
                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5">/{cl.id}</p>
                  </div>
                </div>
                <Badge
                  className={cn(
                    "shrink-0 text-[11px] border rounded-full px-2.5 py-0.5 font-medium capitalize",
                    env.color
                  )}
                >
                  {env.label}
                </Badge>
              </div>

              {/* API server */}
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">API Server</p>
                <p className="text-xs font-mono text-foreground/80 truncate">{cl.api_server}</p>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between mt-auto pt-2 border-t border-border/50">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Circle className="h-2 w-2 fill-wxops-green text-wxops-green" />
                  <span>Pinniped SSO</span>
                </div>
                <span className={cn(
                  "flex items-center gap-1 text-xs font-medium transition-colors text-muted-foreground group-hover:text-foreground"
                )}>
                  View resources
                  <ChevronRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
