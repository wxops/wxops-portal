import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

interface Entity {
  kind: string;
  metadata: {
    name: string;
    title?: string;
    description?: string;
    tags?: string[];
  };
  spec: {
    owner?: string;
    system?: string;
    type?: string;
    lifecycle?: string;
    members?: string[];
    memberOf?: string[];
    email?: string;
    docType?: string;
    docStatus?: string;
    author?: string;
    consumesApis?: string[];
    providesApis?: string[];
  };
}

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

function ownerName(owner: string): string {
  return refName(owner);
}

const docTypeBadge: Record<string, string> = {
  rfc:           "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  adr:           "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  documentation: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
};

const docStatusColors: Record<string, string> = {
  proposed:      "text-amber-600",
  "under-review":"text-blue-600",
  accepted:      "text-green-600",
  deprecated:    "text-gray-500",
  superseded:    "text-orange-500",
};

const lifecycleBadge: Record<string, string> = {
  experimental: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  development:  "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  staging:      "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  production:   "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  deprecated:   "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

function MemberCard({ user }: { user: Entity }) {
  const displayName = user.metadata.title ?? user.metadata.name;
  const initials = displayName
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Link href={`/dashboard/catalog/users/${user.metadata.name}`} className="block group">
      <Card className="relative flex flex-col items-center text-center px-4 py-5 overflow-hidden transition-all duration-200 group-hover:bg-muted/30 hover-glow-cyan group-hover:border-wxops-cyan/40">

        {/* Subtle top gradient accent */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-wxops-cyan/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        {/* Avatar */}
        <div className="relative mb-3 shrink-0">
          <div className="absolute inset-0 rounded-full bg-wxops-purple/20 blur-md scale-110" />
          <div className="relative h-14 w-14 flex items-center justify-center rounded-full bg-gradient-to-br from-wxops-purple to-wxops-indigo text-lg font-bold text-white ring-2 ring-wxops-purple/20">
            {initials}
          </div>
        </div>

        {/* Name */}
        <p className="text-sm font-semibold leading-tight w-full truncate">{displayName}</p>

        {/* Handle */}
        <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
          @{user.metadata.name}
        </p>

        {/* Optional role / description */}
        {user.metadata.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mt-2 leading-relaxed">
            {user.metadata.description}
          </p>
        )}
      </Card>
    </Link>
  );
}

function DocCard({ doc }: { doc: Entity }) {
  const docType   = doc.spec.docType ?? "documentation";
  const docStatus = doc.spec.docStatus ?? "proposed";
  return (
    <Link href={`/dashboard/catalog/Doc/${doc.metadata.name}`} className="block group">
      <Card className="flex flex-col h-full transition-colors group-hover:border-primary/50 group-hover:bg-muted/30">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm font-medium leading-snug">
              {doc.metadata.title ?? doc.metadata.name}
            </CardTitle>
            <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${docTypeBadge[docType] ?? "bg-muted text-muted-foreground"}`}>
              {docType}
            </span>
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-1.5">
          {doc.metadata.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">{doc.metadata.description}</p>
          )}
          <div className="mt-auto flex items-center justify-between">
            <span className={`text-xs font-medium ${docStatusColors[docStatus] ?? "text-muted-foreground"}`}>
              {docStatus}
            </span>
            {doc.spec.author && (
              <span className="text-xs text-muted-foreground">
                @{refName(doc.spec.author)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function ServiceCard({ entity }: { entity: Entity }) {
  const lifecycle  = entity.spec.lifecycle ?? "";
  const badgeClass = lifecycleBadge[lifecycle] ?? "bg-muted text-muted-foreground";
  return (
    <Link href={`/dashboard/catalog/${entity.kind}/${entity.metadata.name}`} className="block group">
      <Card className="flex flex-col h-full transition-colors group-hover:border-primary/50 group-hover:bg-muted/30">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm font-medium">{entity.metadata.title ?? entity.metadata.name}</CardTitle>
            {lifecycle && (
              <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
                {lifecycle}
              </span>
            )}
          </div>
          <p className="text-xs font-mono text-muted-foreground">{entity.metadata.name}</p>
        </CardHeader>
        {entity.metadata.description && (
          <CardContent>
            <p className="text-xs text-muted-foreground line-clamp-2">{entity.metadata.description}</p>
          </CardContent>
        )}
      </Card>
    </Link>
  );
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

  const group = entities.find(
    (e) => e.kind === "Group" && e.metadata.name === name,
  );

  const memberNames = new Set(
    (group?.spec.members ?? []).map(refName),
  );

  const members = entities.filter(
    (e) => e.kind === "User" && memberNames.has(e.metadata.name),
  );

  const ownerRef = `group:${name}`;
  const ownedDocs = entities.filter(
    (e) => e.kind === "Doc" && ownerName(e.spec.owner ?? "") === name,
  );
  const ownedSystems = entities.filter(
    (e) => e.kind === "System" && ownerName(e.spec.owner ?? "") === name,
  );
  const ownedComponents = entities.filter(
    (e) => e.kind === "Component" && ownerName(e.spec.owner ?? "") === name,
  );
  const ownedAPIs = entities.filter(
    (e) => e.kind === "API" && ownerName(e.spec.owner ?? "") === name,
  );
  const ownedResources = entities.filter(
    (e) => e.kind === "Resource" && ownerName(e.spec.owner ?? "") === name,
  );

  // Consumed APIs: union of consumesApis refs from all owned components.
  const consumedApiNames = new Set<string>();
  for (const comp of ownedComponents) {
    for (const ref of comp.spec.consumesApis ?? []) {
      consumedApiNames.add(refName(ref));
    }
  }
  const consumedAPIs = entities.filter(
    (e) => e.kind === "API" && consumedApiNames.has(e.metadata.name),
  );

  const rfcs          = ownedDocs.filter((d) => d.spec.docType === "rfc");
  const adrs          = ownedDocs.filter((d) => d.spec.docType === "adr");
  const documentation = ownedDocs.filter((d) => !d.spec.docType || d.spec.docType === "documentation");

  const displayName = group?.metadata.title ?? group?.metadata.name ?? name;

  void ownerRef;

  return (
    <div className="space-y-8 max-w-5xl">

      <Link
        href="/dashboard/catalog"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Catalog
      </Link>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Group</Badge>
          {group?.spec.type && (
            <Badge variant="outline">{group.spec.type}</Badge>
          )}
        </div>
        <h1 className="text-2xl font-bold">{displayName}</h1>
        {group?.metadata.description && (
          <p className="text-muted-foreground max-w-2xl">{group.metadata.description}</p>
        )}
        {(group?.metadata.tags ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {group!.metadata.tags!.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
            ))}
          </div>
        )}
      </div>

      {/* Members */}
      {members.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Members
            </h2>
            <span className="text-xs text-muted-foreground">({members.length})</span>
          </div>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {members.map((u) => (
              <MemberCard key={u.metadata.name} user={u} />
            ))}
          </div>
        </section>
      )}

      {/* Owned Systems */}
      {ownedSystems.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Systems
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ownedSystems.map((s) => (
              <Link
                key={s.metadata.name}
                href={`/dashboard/catalog/systems/${s.metadata.name}`}
                className="block group"
              >
                <Card className="transition-colors group-hover:border-primary/50 group-hover:bg-muted/30 p-4">
                  <p className="text-sm font-medium">{s.metadata.title ?? s.metadata.name}</p>
                  {s.metadata.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{s.metadata.description}</p>
                  )}
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Owned Components */}
      {ownedComponents.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Services
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ownedComponents.map((c) => (
              <ServiceCard key={c.metadata.name} entity={c} />
            ))}
          </div>
        </section>
      )}

      {/* Owned APIs */}
      {ownedAPIs.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            APIs <span className="font-normal normal-case">({ownedAPIs.length})</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ownedAPIs.map((a) => <ServiceCard key={a.metadata.name} entity={a} />)}
          </div>
        </section>
      )}

      {/* Owned Resources */}
      {ownedResources.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Resources <span className="font-normal normal-case">({ownedResources.length})</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ownedResources.map((r) => <ServiceCard key={r.metadata.name} entity={r} />)}
          </div>
        </section>
      )}

      {/* Consumed APIs */}
      {consumedAPIs.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Consumes <span className="font-normal normal-case">({consumedAPIs.length} external API{consumedAPIs.length !== 1 ? "s" : ""})</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {consumedAPIs.map((a) => <ServiceCard key={a.metadata.name} entity={a} />)}
          </div>
        </section>
      )}

      {/* Decision Documents */}
      {ownedDocs.length > 0 && (
        <div className="space-y-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Decision Documents
          </h2>

          {rfcs.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-violet-700 dark:text-violet-400 uppercase tracking-wider">RFCs</span>
                <span className="text-xs text-muted-foreground">({rfcs.length})</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rfcs.map((d) => <DocCard key={d.metadata.name} doc={d} />)}
              </div>
            </section>
          )}

          {adrs.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider">ADRs</span>
                <span className="text-xs text-muted-foreground">({adrs.length})</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {adrs.map((d) => <DocCard key={d.metadata.name} doc={d} />)}
              </div>
            </section>
          )}

          {documentation.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Documentation</span>
                <span className="text-xs text-muted-foreground">({documentation.length})</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {documentation.map((d) => <DocCard key={d.metadata.name} doc={d} />)}
              </div>
            </section>
          )}
        </div>
      )}

      {!group && (
        <div className="rounded-md border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          Group <code className="font-mono">{name}</code> not found in catalog.
        </div>
      )}
    </div>
  );
}
