import { cookies } from "next/headers";
import Link from "next/link";
import { BookOpen, FileText, Layers, Users, Plus, Database, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getSession } from "@/lib/session";
import { CatalogSearchBar } from "@/components/catalog/catalog-search-bar";

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
  opts: {
    search?: string;
    owner?: string;
    kind?: string;
  } = {},
): Promise<{ entities: Entity[]; total?: number; error?: string }> {
  try {
    const params = new URLSearchParams();
    // limit=0 → backend returns all matching entities (serves from in-memory cache)
    if (opts.search) params.set("search", opts.search);
    if (opts.owner)  params.set("owner",  opts.owner);
    if (opts.kind)   params.set("kind",   opts.kind);
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

function entityHref(kind: string, name: string): string {
  if (kind === "System") return `/dashboard/catalog/systems/${name}`;
  if (kind === "Group") return `/dashboard/catalog/groups/${name}`;
  return `/dashboard/catalog/${kind}/${name}`;
}

function kindGlowClass(kind: string): string {
  switch (kind) {
    case "Component":
    case "API":
      return "hover-glow-purple group-hover:border-wxops-purple/40";
    case "Group":
      return "hover-glow-cyan group-hover:border-wxops-cyan/40";
    case "Doc":
      return "hover-glow-green group-hover:border-wxops-green/40";
    default:
      return "hover-glow-indigo group-hover:border-wxops-indigo/40";
  }
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
      <Card className="flex flex-col h-full transition-all duration-200 group-hover:bg-muted/30 hover-glow-indigo group-hover:border-wxops-indigo/40">
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
      <Card className="flex flex-col h-full transition-all duration-200 group-hover:bg-muted/30 hover-glow-cyan group-hover:border-wxops-cyan/40">
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
      <Card className="flex flex-col h-full transition-all duration-200 group-hover:bg-muted/30 hover-glow-green group-hover:border-wxops-green/40">
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
      <Card className="flex flex-col h-full transition-all duration-200 group-hover:bg-muted/30 hover-glow-purple group-hover:border-wxops-purple/40">
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
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            {c.spec.type && (
              <Badge variant="secondary" className="text-xs">{c.spec.type}</Badge>
            )}
            {c.spec.lifecycle && (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${LIFECYCLE_BADGE[c.spec.lifecycle] ?? "bg-muted text-muted-foreground"}`}>
                {c.spec.lifecycle}
              </span>
            )}
            {c.spec.owner && <span className="ml-auto">{c.spec.owner}</span>}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// Generic flat card — used when a kind filter is active.
function EntityCard({ entity }: { entity: Entity }) {
  return (
    <Link href={entityHref(entity.kind, entity.metadata.name)} className="block group">
      <Card className={cn("flex flex-col h-full transition-all duration-200 group-hover:bg-muted/30", kindGlowClass(entity.kind))}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base truncate">
              {entity.metadata.title ?? entity.metadata.name}
            </CardTitle>
            <Badge variant="outline" className="shrink-0 text-xs">{entity.kind}</Badge>
          </div>
          <p className="text-xs font-mono text-muted-foreground mt-0.5">
            {entity.metadata.name}
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {entity.metadata.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {entity.metadata.description}
            </p>
          )}
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            {entity.spec.type && (
              <Badge variant="secondary" className="text-xs">{entity.spec.type}</Badge>
            )}
            {entity.spec.lifecycle && (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${LIFECYCLE_BADGE[entity.spec.lifecycle] ?? "bg-muted text-muted-foreground"}`}>
                {entity.spec.lifecycle}
              </span>
            )}
            {entity.spec.owner && <span className="ml-auto">{entity.spec.owner}</span>}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// Ordered by promotion progression so the tab bar reads left-to-right
// in the natural lifecycle flow: Experimental → Development → Staging → Production → Deprecated
const LIFECYCLES = [
  { value: "experimental", label: "Experimental", color: "bg-amber-400" },
  { value: "development",  label: "Development",  color: "bg-blue-500"   },
  { value: "staging",      label: "Staging",      color: "bg-violet-500" },
  { value: "production",   label: "Production",   color: "bg-green-500"  },
  { value: "deprecated",   label: "Deprecated",   color: "bg-red-500"    },
];

const LIFECYCLE_BADGE: Record<string, string> = {
  experimental: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  development:  "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  staging:      "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  production:   "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  deprecated:   "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const KIND_FILTERS = [
  { value: "", label: "All" },
  { value: "System", label: "Systems" },
  { value: "Component", label: "Components" },
  { value: "API", label: "APIs" },
  { value: "Resource", label: "Resources" },
  { value: "Group", label: "Groups" },
  { value: "Doc", label: "Docs" },
];

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{
    lifecycle?: string;
    page?: string;
    search?: string;
    owner?: string;
    kind?: string;
  }>;
}) {
  const cookieStore = await cookies();
  const session = cookieStore.get("wxops_session")?.value ?? "";
  const params = await searchParams;
  const selectedLifecycle = params.lifecycle;
  const selectedKind = params.kind ?? "";
  const searchQuery = params.search ?? "";
  const ownerFilter = params.owner ?? "";

  // Fetch all matching entities (limit=0). The backend serves from its 5-min
  // in-memory cache over loopback, so returning the full set is fast. We keep
  // all entities in memory so lifecycle-tab counts and client-side lifecycle
  // filtering are both correct without a second round-trip.
  const [{ entities, error }, userSession] = await Promise.all([
    fetchAllEntities(session, {
      search: searchQuery || undefined,
      owner: ownerFilter || undefined,
      kind: selectedKind || undefined,
    }),
    getSession(),
  ]);

  const userGroups = userSession?.groups ?? [];
  const isPlatformTeam = userGroups.includes(PLATFORM_TEAM);

  // Lifecycle tab counts come from the full (unfiltered by lifecycle) result,
  // so the tab bar always shows accurate totals regardless of which tab is active.
  const lifecycleCounts: Record<string, number> = {};
  for (const e of entities) {
    if (e.spec.lifecycle) {
      lifecycleCounts[e.spec.lifecycle] = (lifecycleCounts[e.spec.lifecycle] ?? 0) + 1;
    }
  }
  const totalWithLifecycle = Object.values(lifecycleCounts).reduce((a, b) => a + b, 0);

  // Lifecycle filter runs in JS — instant, no extra fetch needed.
  const filtered = selectedLifecycle
    ? entities.filter((e) => e.spec.lifecycle === selectedLifecycle)
    : entities;

  function buildParams(overrides: Record<string, string | undefined>): string {
    const p = new URLSearchParams();
    const base: Record<string, string | undefined> = {
      lifecycle: selectedLifecycle,
      kind: selectedKind || undefined,
      search: searchQuery || undefined,
      owner: ownerFilter || undefined,
    };
    const merged = { ...base, ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v) p.set(k, v);
    }
    const qs = p.toString();
    return qs ? `?${qs}` : "";
  }

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

  // When a kind filter is selected, show a flat list instead of grouped sections.
  const flatList = selectedKind
    ? (isPlatformTeam ? filtered : filtered.filter(ownedFilter))
    : null;

  // When the "All" tab is active but a lifecycle filter is selected, show only the
  // lifecycle-bearing kinds (Component / API / Resource) in separate sections.
  // Systems, Groups, and Docs don't carry lifecycle so they're not shown here.
  const lifecycleView = !selectedKind && !!selectedLifecycle;
  const lcComponents = lifecycleView ? (isPlatformTeam ? allComponents : allComponents.filter(ownedFilter)) : [];
  const lcApis       = lifecycleView ? (isPlatformTeam ? allApis       : allApis.filter(ownedFilter))       : [];
  const lcResources  = lifecycleView ? (isPlatformTeam ? allResources  : allResources.filter(ownedFilter))  : [];

  const isEmpty = selectedKind
    ? (flatList?.length === 0)
    : lifecycleView
      ? (lcComponents.length === 0 && lcApis.length === 0 && lcResources.length === 0)
      : (
        visibleSystems.length === 0 &&
        !hasUngrouped &&
        visibleDocs.length === 0 &&
        visibleGroups.length === 0
      );

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

      {/* Search bar — client component, no Suspense needed (no useSearchParams) */}
      <CatalogSearchBar
        key={searchQuery}
        defaultValue={searchQuery}
        baseParams={{
          lifecycle: selectedLifecycle,
          kind: selectedKind || undefined,
          owner: ownerFilter || undefined,
        }}
      />

      {/* Kind filter pills */}
      <div className="flex items-center gap-1 flex-wrap">
        {KIND_FILTERS.map((kf) => {
          const active = selectedKind === kf.value;
          return (
            <Link
              key={kf.value || "all"}
              href={`/dashboard/catalog${buildParams({ kind: kf.value || undefined, page: undefined })}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {kf.label}
            </Link>
          );
        })}
      </div>

      {/* Lifecycle filter tabs — shown for Component / API / Resource (lifecycle is
          meaningful for these kinds) or when entities exist in any lifecycle state */}
      {(["Component", "API", "Resource"].includes(selectedKind) || (!selectedKind && totalWithLifecycle > 0)) && totalWithLifecycle > 0 && (
        <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1 overflow-x-auto">
          <Link
            href={`/dashboard/catalog${buildParams({ lifecycle: undefined, page: undefined })}`}
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
                href={`/dashboard/catalog${buildParams({ lifecycle: lc.value, page: undefined })}`}
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

      {searchQuery && !error && (
        <p className="text-sm text-muted-foreground">
          {filtered.length === 0
            ? `No results for "${searchQuery}"`
            : `${filtered.length} result${filtered.length !== 1 ? "s" : ""} for "${searchQuery}"`}
        </p>
      )}

      {!error && isEmpty && (
        <div className="rounded-md border border-dashed px-6 py-12 text-center text-muted-foreground">
          <BookOpen className="mx-auto h-8 w-8 mb-3 opacity-40" />
          {searchQuery ? (
            <p className="text-sm">No catalog entries match your search.</p>
          ) : isPlatformTeam ? (
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

      {/* Flat list — shown when a kind filter is active */}
      {!error && flatList && flatList.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {flatList.map((e) => (
            <EntityCard key={`${e.kind}/${e.metadata.name}`} entity={e} />
          ))}
        </div>
      )}

      {/* Lifecycle-filtered view — "All" tab + lifecycle tab selected.
          Only Component/API/Resource carry lifecycle; Systems/Groups/Docs are excluded. */}
      {!error && lifecycleView && !isEmpty && (
        <div className="space-y-8">
          {lcComponents.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Components
                </h2>
                <span className="text-xs text-muted-foreground">({lcComponents.length})</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {lcComponents.map((c) => <ComponentCard key={c.metadata.name} c={c} />)}
              </div>
            </section>
          )}
          {lcApis.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-1.5">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  APIs
                </h2>
                <span className="text-xs text-muted-foreground">({lcApis.length})</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {lcApis.map((a) => <EntityCard key={`API/${a.metadata.name}`} entity={a} />)}
              </div>
            </section>
          )}
          {lcResources.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-1.5">
                <Database className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Resources
                </h2>
                <span className="text-xs text-muted-foreground">({lcResources.length})</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {lcResources.map((r) => <EntityCard key={`Resource/${r.metadata.name}`} entity={r} />)}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Grouped layout — shown only when no kind filter AND no lifecycle filter */}
      {!selectedKind && !lifecycleView && (
        <>
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
                        <Card className="flex flex-col h-full transition-all duration-200 group-hover:bg-muted/30 hover-glow-indigo group-hover:border-wxops-indigo/40">
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
                        <Card className="flex flex-col h-full transition-all duration-200 group-hover:bg-muted/30 hover-glow-indigo group-hover:border-wxops-indigo/40">
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
        </>
      )}

    </div>
  );
}
