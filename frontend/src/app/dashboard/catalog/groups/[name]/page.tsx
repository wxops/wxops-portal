import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft, Users } from "lucide-react";
import type { Entity } from "@/lib/types";
import { GroupPageClient } from "@/components/catalog/group-page-client";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

async function fetchAll(cookie: string): Promise<Entity[]> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/catalog/entities`, {
      headers: { Cookie: `wxops_session=${cookie}` },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.entities ?? [];
  } catch {
    return [];
  }
}

function refName(ref: string): string {
  const afterColon = ref.includes(":") ? ref.split(":")[1] : ref;
  return afterColon.includes("/") ? afterColon.split("/").pop()! : afterColon;
}

function groupGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const g = [
    "from-wxops-cyan to-wxops-purple",
    "from-wxops-green to-wxops-cyan",
    "from-wxops-purple to-blue-500",
    "from-amber-400 to-wxops-purple",
    "from-blue-500 to-wxops-green",
    "from-rose-400 to-amber-400",
  ];
  return g[Math.abs(hash) % g.length];
}

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name }    = await params;
  const cookieStore = await cookies();
  const session     = cookieStore.get("wxops_session")?.value ?? "";

  const entities = await fetchAll(session);
  const group    = entities.find((e) => e.kind === "Group" && e.metadata.name === name);

  if (!group) {
    return (
      <div className="space-y-4 max-w-lg">
        <Link
          href="/dashboard/catalog"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Catalog
        </Link>
        <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Users className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold">Group not found</p>
            <p className="text-xs text-muted-foreground mt-1">
              <code className="font-mono">{name}</code> is not registered in the catalog.
            </p>
          </div>
          <Link
            href="/dashboard/catalog"
            className="inline-flex items-center gap-1.5 rounded-lg bg-wxops-purple px-4 py-2 text-sm font-medium text-white hover:bg-wxops-purple/90 transition-colors"
          >
            Browse Catalog
          </Link>
        </div>
      </div>
    );
  }

  const memberNames   = new Set((group.spec.members ?? []).map(refName));
  const members       = entities.filter((e) => e.kind === "User" && memberNames.has(e.metadata.name));

  const ownedSystems    = entities.filter((e) => e.kind === "System"    && refName(e.spec.owner ?? "") === name);
  const ownedComponents = entities.filter((e) => e.kind === "Component" && refName(e.spec.owner ?? "") === name);
  const ownedAPIs       = entities.filter((e) => e.kind === "API"       && refName(e.spec.owner ?? "") === name);
  const ownedResources  = entities.filter((e) => e.kind === "Resource"  && refName(e.spec.owner ?? "") === name);
  const ownedDocs       = entities.filter((e) => e.kind === "Doc"       && refName(e.spec.owner ?? "") === name);

  const consumedApiNames = new Set<string>();
  for (const comp of ownedComponents) {
    for (const ref of comp.spec.consumesApis ?? []) consumedApiNames.add(refName(ref));
  }
  const ownedApiNames = new Set(ownedAPIs.map((a) => a.metadata.name));
  const consumedAPIs  = entities.filter(
    (e) => e.kind === "API" && consumedApiNames.has(e.metadata.name) && !ownedApiNames.has(e.metadata.name),
  );

  const parentName  = group.spec.parent ? refName(group.spec.parent) : null;

  return (
    <div className="space-y-1">
      <div className="mb-4">
        <Link
          href="/dashboard/catalog"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Catalog
        </Link>
      </div>

      <GroupPageClient
        group={group}
        members={members}
        ownedSystems={ownedSystems}
        ownedComponents={ownedComponents}
        ownedAPIs={ownedAPIs}
        ownedResources={ownedResources}
        consumedAPIs={consumedAPIs}
        ownedDocs={ownedDocs}
        displayName={group.metadata.title ?? group.metadata.name}
        gradient={groupGradient(name)}
        namespace={parentName ? `tenant-${parentName}` : null}
        tags={group.metadata.tags ?? []}
      />
    </div>
  );
}
