import { cookies } from "next/headers";
import Link from "next/link";
import { BookOpen, FileText, Layers, Users, Plus, Database, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/session";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

// Members of this group can see every entity regardless of owner.
const PLATFORM_TEAM = "platform-team";

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
    domain?: string;
    lifecycle?: string;
    type?: string;
    system?: string;
    members?: string[];
    // Doc
    docType?: string;
    docStatus?: string;
  };
}

async function fetchAllEntities(
  cookie: string,
  page = 0,
  limit = 0,
): Promise<{ entities: Entity[]; total?: number; error?: string }> {
  try {
    const params = new URLSearchParams();
    if (page > 0) params.set("page", String(page));
    if (limit > 0) params.set("limit", String(limit));
    const qs = params.toString();
    const res = await fetch(`${BACKEND_URL}/api/v1/catalog/entities${qs ? `?${qs}` : ""}`, {
      headers: { Cookie: `wxops_session=${cookie}` },
      cache: "no-store",
    });
    if (!res.ok) return { entities: [], error: await res.text() };
    return res.json();
  } catch {
    return { entities: [], error: "Backend unreachable" };
  }
}

// Returns true when spec.owner matches any of the user's OIDC group names.
// Pinniped Supervisor issues groups as bare names (e.g. "payments-team").
// Catalog spec.owner uses the "group:<name>" convention from Backstage schema.
function isOwnedByUser(owner: string | undefined, groups: string[]): boolean {
  if (!owner || groups.length === 0) return false;
  const name = owner.startsWith("group:") ? owner.slice(6) : owner;
  return groups.includes(name);
}

function SystemCard({
  sys,
  count,
}: {
  sys: Entity;
  count: number;
}) {

  return (
    <Link
      href={`/dashboard/catalog/systems/${sys.metadata.name}`}
      className="block group"
    >
      <Card className="flex flex-col h-full transition-colors group-hover:border-primary/50 group-hover:bg-muted/30">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
              <CardTitle className="text-base truncate">
                {sys.metadata.title ?? sys.metadata.name}
              </CardTitle>
            </div>
            {sys.spec.domain && (
              <Badge variant="outline" className="shrink-0 text-xs">
                {sys.spec.domain}
              </Badge>
            )}
          </div>
          <p className="text-xs font-mono text-muted-foreground mt-0.5">
            {sys.metadata.name}
          </p>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3">
          {sys.metadata.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {sys.metadata.description}
            </p>
          )}
          <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
            {sys.spec.owner && <span>{sys.spec.owner}</span>}
            <span className="ml-auto">
              {count} service{count !== 1 ? "s" : ""}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function GroupCard({ group }: { group: Entity }) {
  const memberCount = group.spec.members?.length ?? 0;
  return (
    <Link href={`/dashboard/catalog/groups/${group.metadata.name}`} className="block group">
      <Card className="flex flex-col h-full transition-colors group-hover:border-primary/50 group-hover:bg-muted/30">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
            <CardTitle className="text-base truncate">
              {group.metadata.title ?? group.metadata.name}
            </CardTitle>
          </div>
          <p className="text-xs font-mono text-muted-foreground mt-0.5">
            {group.metadata.name}
          </p>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3">
          {group.metadata.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {group.metadata.description}
            </p>
          )}
          <p className="mt-auto text-xs text-muted-foreground">
            {memberCount} member{memberCount !== 1 ? "s" : ""}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
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

function DocCard({ doc }: { doc: Entity }) {
  const docType   = doc.spec.docType ?? "documentation";
  const docStatus = doc.spec.docStatus;

  return (
    <Link
      href={`/dashboard/catalog/Doc/${doc.metadata.name}`}
      className="block group"
    >
      <Card className="flex flex-col h-full transition-colors group-hover:border-primary/50 group-hover:bg-muted/30">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm font-medium leading-snug">
              {doc.metadata.title ?? doc.metadata.name}
            </CardTitle>
            <span
              className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${docTypeBadge[docType] ?? "bg-muted text-muted-foreground"}`}
            >
              {docType}
            </span>
          </div>
          <p className="text-xs font-mono text-muted-foreground">
            {doc.metadata.name}
          </p>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-2">
          {doc.metadata.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {doc.metadata.description}
            </p>
          )}
          {docStatus && (
            <p className={`text-xs font-medium mt-auto ${docStatusColors[docStatus] ?? "text-muted-foreground"}`}>
              {docStatus}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function ComponentCard({ c }: { c: Entity }) {
  return (
    <Link
      href={`/dashboard/catalog/Component/${c.metadata.name}`}
      className="block group"
    >
      <Card className="flex flex-col h-full transition-colors group-hover:border-primary/50 group-hover:bg-muted/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {c.metadata.title ?? c.metadata.name}
          </CardTitle>
          <p className="text-xs font-mono text-muted-foreground">
            {c.metadata.name}
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {c.metadata.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {c.metadata.description}
            </p>
          )}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {c.spec.type && (
              <Badge variant="secondary" className="text-xs">
                {c.spec.type}
              </Badge>
            )}
            {c.spec.owner && <span>{c.spec.owner}</span>}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

const LIFECYCLES = [
  { value: "production", label: "Production", color: "bg-green-500" },
  { value: "development", label: "Development", color: "bg-blue-500" },
  { value: "experimental", label: "Experimental", color: "bg-amber-500" },
  { value: "deprecated", label: "Deprecated", color: "bg-red-500" },
];

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ lifecycle?: string; page?: string }>;
}) {
  const cookieStore = await cookies();
  const session = cookieStore.get("wxops_session")?.value ?? "";
  const params = await searchParams;
  const selectedLifecycle = params.lifecycle;
  const currentPage = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const pageSize = 30;

  const [{ entities, total: entityTotal, error }, userSession] = await Promise.all([
    fetchAllEntities(session, currentPage, pageSize),
    getSession(),
  ]);
  const totalPages = entityTotal ? Math.ceil(entityTotal / pageSize) : 1;

  const userGroups = userSession?.groups ?? [];
  const isPlatformTeam = userGroups.includes(PLATFORM_TEAM);

  // Lifecycle stats (computed before filtering)
  const lifecycleCounts: Record<string, number> = {};
  for (const e of entities) {
    if (e.spec.lifecycle) {
      lifecycleCounts[e.spec.lifecycle] = (lifecycleCounts[e.spec.lifecycle] ?? 0) + 1;
    }
  }
  const totalWithLifecycle = Object.values(lifecycleCounts).reduce((a, b) => a + b, 0);

  // Apply lifecycle filter
  const filtered = selectedLifecycle
    ? entities.filter((e) => !e.spec.lifecycle || e.spec.lifecycle === selectedLifecycle)
    : entities;

  const allSystems    = filtered.filter((e) => e.kind === "System");
  const allComponents = filtered.filter((e) => e.kind === "Component");
  const allResources  = filtered.filter((e) => e.kind === "Resource");
  const allApis       = filtered.filter((e) => e.kind === "API");
  const allDocs       = filtered.filter((e) => e.kind === "Doc");
  const allGroups     = filtered.filter((e) => e.kind === "Group");

  // platform-team sees everything; tenant teams see only their own entities.
  const ownedFilter = (e: Entity) => isOwnedByUser(e.spec.owner, userGroups);
  const visibleSystems = isPlatformTeam ? allSystems : allSystems.filter(ownedFilter);
  const visibleDocs = isPlatformTeam ? allDocs : allDocs.filter(ownedFilter);
  const visibleGroups = isPlatformTeam
    ? allGroups
    : allGroups.filter((g) => userGroups.includes(g.metadata.name));

  // Ungrouped: entities without a system
  const ungroupedFilter = (e: Entity) =>
    !e.spec.system && (isPlatformTeam || isOwnedByUser(e.spec.owner, userGroups));
  const ungroupedComponents = allComponents.filter(ungroupedFilter);
  const ungroupedResources  = allResources.filter(ungroupedFilter);
  const ungroupedApis       = allApis.filter(ungroupedFilter);
  const hasUngrouped = ungroupedComponents.length + ungroupedResources.length + ungroupedApis.length > 0;

  const componentCount: Record<string, number> = {};
  for (const c of allComponents) {
    const sys = c.spec.system ?? "__ungrouped__";
    componentCount[sys] = (componentCount[sys] ?? 0) + 1;
  }

  const isEmpty =
    visibleSystems.length === 0 &&
    !hasUngrouped &&
    visibleDocs.length === 0 &&
    visibleGroups.length === 0;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Service Catalog</h1>
          <p className="text-muted-foreground mt-1">
            {isPlatformTeam
              ? "All registered services across every team."
              : "Services registered for your team."}
          </p>
        </div>
        <Link
          href="/dashboard/catalog/register"
          className="flex items-center gap-1.5 shrink-0 rounded-lg bg-wxops-purple px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-wxops-purple/90"
        >
          <Plus className="h-4 w-4" />
          Register
        </Link>
      </div>

      {/* Lifecycle filter tabs */}
      {totalWithLifecycle > 0 && (
        <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1 overflow-x-auto">
          <Link
            href="/dashboard/catalog"
            className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              !selectedLifecycle
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All
            <span className="ml-1 text-muted-foreground">({entities.length})</span>
          </Link>
          {LIFECYCLES.map((lc) => {
            const count = lifecycleCounts[lc.value] ?? 0;
            if (count === 0) return null;
            const active = selectedLifecycle === lc.value;
            return (
              <Link
                key={lc.value}
                href={`/dashboard/catalog?lifecycle=${lc.value}`}
                className={`shrink-0 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${lc.color}`} />
                {lc.label}
                <span className="text-muted-foreground">({count})</span>
              </Link>
            );
          })}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {error.includes("GITEA_URL") || error.includes("configured") ? (
            <>
              Catalog source not configured.{" "}
              <span className="font-medium">
                Set CATALOG_LOCAL_DIR for local testing, or GITEA_URL +
                GITEA_TOKEN + GITEA_CATALOG_OWNER + GITEA_CATALOG_REPO for
                production.
              </span>
            </>
          ) : (
            <>Failed to load catalog: {error}</>
          )}
        </div>
      )}

      {!error && isEmpty && (
        <div className="rounded-md border border-dashed px-6 py-12 text-center text-muted-foreground">
          <BookOpen className="mx-auto h-8 w-8 mb-3 opacity-40" />
          {isPlatformTeam ? (
            <>
              <p className="text-sm">No catalog entries yet.</p>
              <p className="text-xs mt-1">
                Add YAML files to{" "}
                <code className="bg-muted px-1 py-0.5 rounded">
                  service-catalog/&lt;team&gt;/systems/
                </code>
              </p>
            </>
          ) : (
            <>
              <p className="text-sm">No services registered for your team yet.</p>
              <p className="text-xs mt-1">
                Contact your platform team to add entries under{" "}
                <code className="bg-muted px-1 py-0.5 rounded">
                  service-catalog/&lt;your-team&gt;/systems/
                </code>
              </p>
            </>
          )}
        </div>
      )}

      {visibleSystems.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleSystems.map((sys) => (
            <SystemCard
              key={sys.metadata.name}
              sys={sys}
              count={componentCount[sys.metadata.name] ?? 0}
            />
          ))}
        </div>
      )}

      {hasUngrouped && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Ungrouped Entities
          </h2>
          {ungroupedComponents.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-medium text-muted-foreground">Components ({ungroupedComponents.length})</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {ungroupedComponents.map((c) => (
                  <ComponentCard key={c.metadata.name} c={c} />
                ))}
              </div>
            </div>
          )}
          {ungroupedResources.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Database className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-medium text-muted-foreground">Resources ({ungroupedResources.length})</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {ungroupedResources.map((r) => (
                  <Link
                    key={r.metadata.name}
                    href={`/dashboard/catalog/Resource/${r.metadata.name}`}
                    className="block group"
                  >
                    <Card className="flex flex-col h-full transition-colors group-hover:border-primary/50 group-hover:bg-muted/30">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">{r.metadata.title ?? r.metadata.name}</CardTitle>
                        <p className="text-xs font-mono text-muted-foreground">{r.metadata.name}</p>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {r.metadata.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">{r.metadata.description}</p>
                        )}
                        {r.spec.type && <Badge variant="secondary" className="text-xs">{r.spec.type}</Badge>}
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {ungroupedApis.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-medium text-muted-foreground">APIs ({ungroupedApis.length})</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {ungroupedApis.map((a) => (
                  <Link
                    key={a.metadata.name}
                    href={`/dashboard/catalog/API/${a.metadata.name}`}
                    className="block group"
                  >
                    <Card className="flex flex-col h-full transition-colors group-hover:border-primary/50 group-hover:bg-muted/30">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">{a.metadata.title ?? a.metadata.name}</CardTitle>
                        <p className="text-xs font-mono text-muted-foreground">{a.metadata.name}</p>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {a.metadata.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">{a.metadata.description}</p>
                        )}
                        {a.spec.type && <Badge variant="secondary" className="text-xs">{a.spec.type}</Badge>}
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {visibleGroups.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Teams
            </h2>
            <span className="text-xs text-muted-foreground">({visibleGroups.length})</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleGroups.map((g) => (
              <GroupCard key={g.metadata.name} group={g} />
            ))}
          </div>
        </section>
      )}

      {visibleDocs.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Decision Documents
            </h2>
            <span className="text-xs text-muted-foreground">({visibleDocs.length})</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleDocs.map((d) => (
              <DocCard key={d.metadata.name} doc={d} />
            ))}
          </div>
        </section>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-4">
          {currentPage > 1 ? (
            <Link
              href={`/dashboard/catalog?page=${currentPage - 1}${selectedLifecycle ? `&lifecycle=${selectedLifecycle}` : ""}`}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted/50 transition-colors"
            >
              Previous
            </Link>
          ) : (
            <span className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground/50">
              Previous
            </span>
          )}
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          {currentPage < totalPages ? (
            <Link
              href={`/dashboard/catalog?page=${currentPage + 1}${selectedLifecycle ? `&lifecycle=${selectedLifecycle}` : ""}`}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted/50 transition-colors"
            >
              Next
            </Link>
          ) : (
            <span className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground/50">
              Next
            </span>
          )}
        </div>
      )}
    </div>
  );
}
