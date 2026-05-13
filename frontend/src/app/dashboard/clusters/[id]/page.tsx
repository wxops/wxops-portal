import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ClusterDetail } from "@/components/clusters/cluster-detail";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

interface ClusterInfo {
  id: string;
  name: string;
}

async function fetchClusterInfo(
  cookie: string,
  id: string,
): Promise<ClusterInfo | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/clusters/${id}`, {
      headers: { Cookie: `wxops_session=${cookie}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json() as Promise<ClusterInfo>;
  } catch {
    return null;
  }
}

export default async function ClusterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const session = cookieStore.get("wxops_session")?.value ?? "";

  const cluster = await fetchClusterInfo(session, id);
  const clusterName = cluster?.name ?? id;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/clusters"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          All Clusters
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold">{clusterName}</h1>
      </div>

      <ClusterDetail
        clusterId={id}
        clusterName={clusterName}
      />
    </div>
  );
}
