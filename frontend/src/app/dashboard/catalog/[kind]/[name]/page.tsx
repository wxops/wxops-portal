import { cookies } from "next/headers";
import Link from "next/link";
import { ExternalLink, FileText, Hammer, Network } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { OpenApiViewer } from "@/components/catalog/openapi-viewer";
import { EntityActions } from "@/components/catalog/entity-actions";
import { DocsDrawer } from "@/components/catalog/docs-drawer";
import { RuntimeStatusCard } from "@/components/catalog/runtime-status-card";
import { CIStatusCard } from "@/components/catalog/ci-status-card";
import { ReleasesCard } from "@/components/catalog/releases-card";
import { PackagesCard } from "@/components/catalog/packages-card";
import { PromotionPanel } from "@/components/catalog/promotion-panel";
import { getSession } from "@/lib/session";
import type { Entity } from "@/lib/types";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

async function fetchEntity(
  cookie: string,
  kind: string,
  name: string,
): Promise<{ entity: Entity | null; error?: string }> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/v1/catalog/entities/${kind}/${name}`,
      {
        headers: { Cookie: `wxops_session=${cookie}` },
        cache: "no-store",
      },
    );
    if (res.status === 404) return { entity: null, error: "Entity not found" };
    if (!res.ok) return { entity: null, error: await res.text() };
    const entity = await res.json();
    return { entity };
  } catch {
    return { entity: null, error: "Backend unreachable" };
  }
}

const lifecycleBadge: Record<string, string> = {
  experimental: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  development:  "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  staging:      "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  production:   "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  deprecated:   "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

function MetaRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={mono ? "font-mono text-foreground" : "text-foreground"}>{value}</span>
    </div>
  );
}

export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ kind: string; name: string }>;
}) {
  const { kind, name } = await params;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("wxops_session")?.value ?? "";
  const userSession = await getSession();
  const userGroups = userSession?.groups ?? [];

  // Only fetch the entity itself — fast, single API call.
  // Heavy sections (Documents, CI, Releases, Packages) load independently via Suspense.
  const { entity, error } = await fetchEntity(sessionCookie, kind, name);

  if (error || !entity) {
    const isNotFound = !entity || error?.includes("not found");
    return (
      <div className="space-y-4 max-w-lg">
        <Link
          href="/dashboard/catalog"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Catalog
        </Link>
        {isNotFound ? (
          <div className="rounded-lg border border-border p-6 space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <FileText className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">
                {kind}/{name} not found
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                This entity may not exist yet. If you just scaffolded or registered
                it, the entity will appear after the PR is merged into gitops-infra.
              </p>
            </div>
            <div className="flex justify-center gap-3">
              <Link
                href="/dashboard/activity"
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50"
              >
                Check Activity
              </Link>
              <Link
                href="/dashboard/catalog"
                className="rounded-lg bg-wxops-purple px-4 py-2 text-sm font-medium text-white hover:bg-wxops-purple/90"
              >
                Browse Catalog
              </Link>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}
      </div>
    );
  }

  const lifecycle = entity.spec.lifecycle ?? "";
  const badgeClass = lifecycleBadge[lifecycle] ?? "bg-muted text-muted-foreground";
  const displayTitle = entity.metadata.title ?? entity.metadata.name;
  const tags = entity.metadata.tags ?? [];
  const isDraft = entity.kind === "Doc" && entity.spec.draft === true;

  const allLinks = entity.metadata.links ?? [];
  const rfcLinks   = allLinks.filter((l) => l.type === "rfc");
  const adrLinks   = allLinks.filter((l) => l.type === "adr");
  const docLinks   = allLinks.filter((l) => l.type !== "rfc" && l.type !== "adr" && l.type !== "openapi");
  const hasLinks   = rfcLinks.length + adrLinks.length + docLinks.length > 0;

  // Compute promotion permissions server-side so the client panel
  // knows immediately what actions to enable without an extra fetch.
  const ownerTeam = (entity.spec.owner ?? "").replace(/^group:/, "");
  const groupsLower = userGroups.map((g) => g.toLowerCase());
  const isPlatform = groupsLower.some((g) => g === "platform-team");
  const isManager  = groupsLower.some((g) => g === `${ownerTeam.toLowerCase()}:managers`);
  const isMember   = groupsLower.some((g) => g === ownerTeam.toLowerCase() || g === "platform-team");
  const canElevate = isPlatform || isManager;

  const scaffoldAnnotationKeys = new Set([
    "wxops.cloud/template-id",
    "wxops.cloud/scaffold-date",
    "gitea/source-location",
  ]);
  const scaffoldAnnotations = Object.fromEntries(
    Object.entries(entity.metadata.annotations ?? {}).filter(([k]) => scaffoldAnnotationKeys.has(k)),
  );
  const hasScaffoldInfo = !!scaffoldAnnotations["wxops.cloud/template-id"];
  const hasSourceRepo = !!scaffoldAnnotations["gitea/source-location"];

  const displayAnnotations = Object.entries(entity.metadata.annotations ?? {}).filter(
    ([k]) => !k.startsWith("kubectl.kubernetes.io") && !(hasScaffoldInfo && scaffoldAnnotationKeys.has(k)),
  );

  // Flat array kept for hasSidebar check; relGroups drives the new card
  const relationships = [
    ...(entity.spec.dependsOn    ?? []),
    ...(entity.spec.providesApis ?? []),
    ...(entity.spec.consumesApis ?? []),
    ...(entity.spec.relatedTo    ?? []),
    ...(entity.spec.members      ?? []),
    ...(entity.spec.children     ?? []),
  ];

  const relGroups = [
    { label: "Depends On",   refs: entity.spec.dependsOn    ?? [], dotCls: "bg-wxops-purple",  textCls: "text-wxops-purple"  },
    { label: "Provides API", refs: entity.spec.providesApis ?? [], dotCls: "bg-wxops-green",   textCls: "text-wxops-green"   },
    { label: "Consumes API", refs: entity.spec.consumesApis ?? [], dotCls: "bg-wxops-cyan",    textCls: "text-wxops-cyan"    },
    { label: "Related To",   refs: entity.spec.relatedTo    ?? [], dotCls: "bg-wxops-indigo",  textCls: "text-wxops-indigo"  },
    { label: "Members",      refs: entity.spec.members      ?? [], dotCls: "bg-amber-500",     textCls: "text-amber-500"     },
    { label: "Children",     refs: entity.spec.children     ?? [], dotCls: "bg-slate-400",     textCls: "text-slate-400"     },
  ].filter((g) => g.refs.length > 0);

  const entityRef = `${entity.kind.toLowerCase()}:${entity.metadata.namespace || "default"}/${entity.metadata.name}`;

  const hasOpenapiLink = allLinks.some((l) => l.type === "openapi");
  const showApiRef = entity.kind === "API" && (!!entity.spec.definition || hasOpenapiLink);
  const apiSpecUrl = showApiRef && !entity.spec.definition
    ? `/api/v1/catalog/entities/${entity.kind}/${entity.metadata.name}/spec`
    : undefined;

  const metaFields = [
    entity.spec.owner  && { label: "Owner",  value: entity.spec.owner,  mono: true  },
    entity.spec.system && { label: "System", value: entity.spec.system, mono: true  },
    entity.spec.domain && { label: "Domain", value: entity.spec.domain, mono: false },
    entity.spec.parent && { label: "Parent", value: entity.spec.parent, mono: true  },
    entity.spec.author && { label: "Author", value: entity.spec.author, mono: true  },
  ].filter(Boolean) as { label: string; value: string; mono: boolean }[];

  const showDocs = ["Component", "System", "Resource", "API"].includes(entity.kind);

  const hasSidebar = relationships.length > 0 || hasLinks || displayAnnotations.length > 0 || hasScaffoldInfo;

  return (
    <div className="space-y-5">

      {/* ── Breadcrumb ──────────────────────────────────────────────────── */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/dashboard/catalog" className="hover:text-foreground">
          Catalog
        </Link>
        {entity.spec.system && (
          <>
            <span>/</span>
            <Link
              href={`/dashboard/catalog/systems/${entity.spec.system}`}
              className="hover:text-foreground"
            >
              {entity.spec.system}
            </Link>
          </>
        )}
        <span>/</span>
        <span className="text-foreground font-medium">{entity.metadata.name}</span>
      </nav>

      {/* ── Entity header card (full width) ──────────────────────────────── */}
      <div className="rounded-lg border bg-card">
        <div className="p-5">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Badge variant="secondary">{entity.kind}</Badge>
            {isDraft && (
              <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                Draft
              </span>
            )}
            {lifecycle && (
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClass}`}>
                {lifecycle}
              </span>
            )}
            {entity.spec.type && (
              <Badge variant="outline" className="text-xs">{entity.spec.type}</Badge>
            )}
            {entity.spec.docType && (
              <Badge variant="outline" className="text-xs">{entity.spec.docType}</Badge>
            )}
            {entity.spec.docStatus && (
              <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                {entity.spec.docStatus}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {showDocs && <DocsDrawer entityRef={entityRef} />}
              <EntityActions entity={entity} userGroups={userGroups} />
            </div>
          </div>

          <h1 className="text-xl font-bold leading-tight">{displayTitle}</h1>
          {entity.metadata.title && (
            <p className="text-xs font-mono text-muted-foreground mt-0.5">
              {entity.metadata.name}
            </p>
          )}
          {entity.metadata.description && (
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              {entity.metadata.description}
            </p>
          )}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {metaFields.length > 0 && (
          <div className="border-t px-5 py-2.5 flex flex-wrap gap-x-6 gap-y-1">
            {metaFields.map((f) => (
              <MetaRow key={f.label} label={f.label} value={f.value} mono={f.mono} />
            ))}
          </div>
        )}
      </div>

      {/* ── Two-column body ───────────────────────────────────────────────── */}
      <div className={hasSidebar ? "grid grid-cols-1 lg:grid-cols-[1fr_272px] gap-5 items-start" : "space-y-4"}>

        {/* LEFT ── operational content ───────────────────────────────────── */}
        <div className="space-y-4 min-w-0">

          {/* Runtime Status */}
          {hasScaffoldInfo && entity.kind === "Component" && (
            <RuntimeStatusCard
              appName={entity.metadata.name}
              team={entity.spec.owner?.includes(":") ? entity.spec.owner.split(":")[1] : entity.spec.owner ?? ""}
            />
          )}

          {/* Promotion panel */}
          {hasSourceRepo && entity.kind === "Component" && (
            <PromotionPanel
              entityKind={entity.kind}
              entityName={entity.metadata.name}
              team={ownerTeam}
              canElevate={canElevate}
              isMember={isMember}
              ingressEnabled={entity.metadata.annotations?.["wxops.cloud/ingress"] === "true"}
              vaultEnabled={(entity.spec.dependsOn ?? []).some((d: string) => d.endsWith("-vault"))}
              databaseEnabled={(entity.spec.dependsOn ?? []).some((d: string) => {
                const r = (d as string).replace("resource:default/", "");
                return r.endsWith("-db");
              })}
              dbName={(entity.spec.dependsOn ?? []).find((d: string) => d.replace("resource:default/", "").endsWith("-db"))?.replace("resource:default/", "") ?? ""}
              certEnabled={entity.metadata.annotations?.["wxops.cloud/cert-manager"] === "true"}
            />
          )}

          {/* CI, Releases, Packages */}
          {hasSourceRepo && entity.kind === "Component" && (
            <div className="grid gap-4 lg:grid-cols-3">
              <CIStatusCard entityKind={entity.kind} entityName={entity.metadata.name} />
              <ReleasesCard entityKind={entity.kind} entityName={entity.metadata.name} />
              <PackagesCard entityKind={entity.kind} entityName={entity.metadata.name} />
            </div>
          )}

          {/* OpenAPI spec */}
          {showApiRef && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-0.5">
                API Reference
              </h2>
              <OpenApiViewer
                spec={entity.spec.definition || undefined}
                specUrl={apiSpecUrl}
              />
            </section>
          )}

        </div>

        {/* RIGHT ── entity details sidebar ──────────────────────────────── */}
        {hasSidebar && (
          <div className="space-y-3 lg:sticky lg:top-6">

            {/* Scaffold Info */}
            {hasScaffoldInfo && (
              <Card>
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                    <Hammer className="h-3 w-3" />
                    Scaffold
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3 pt-1 space-y-2.5">
                  {scaffoldAnnotations["wxops.cloud/template-id"] && (
                    <div className="text-xs space-y-0.5">
                      <p className="text-muted-foreground">Template</p>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {scaffoldAnnotations["wxops.cloud/template-id"]}
                      </Badge>
                    </div>
                  )}
                  {scaffoldAnnotations["wxops.cloud/scaffold-date"] && (
                    <div className="text-xs space-y-0.5">
                      <p className="text-muted-foreground">Created</p>
                      <p className="text-foreground">
                        {new Date(scaffoldAnnotations["wxops.cloud/scaffold-date"]).toLocaleDateString("en-US", {
                          year: "numeric", month: "short", day: "numeric",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </p>
                    </div>
                  )}
                  {scaffoldAnnotations["gitea/source-location"] && (
                    <div className="text-xs space-y-0.5">
                      <p className="text-muted-foreground">Source</p>
                      <p className="font-mono text-foreground break-all">
                        {scaffoldAnnotations["gitea/source-location"]}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Relationships */}
            {relGroups.length > 0 && (
              <Card>
                <CardHeader className="pb-2 pt-3 px-4">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                    <Network className="h-3 w-3" />
                    Relationships
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3 pt-0 space-y-3.5">
                  {relGroups.map(({ label, refs, dotCls, textCls }) => (
                    <div key={label} className="space-y-1.5">
                      {/* Group label */}
                      <div className="flex items-center gap-1.5">
                        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0 flex-none", dotCls)} />
                        <span className={cn("text-[10px] font-semibold uppercase tracking-wide leading-none", textCls)}>
                          {label}
                        </span>
                      </div>
                      {/* Ref chips */}
                      <div className="flex flex-wrap gap-1 pl-3">
                        {refs.map((ref) => {
                          const colonIdx = ref.indexOf(":");
                          const slashIdx = ref.lastIndexOf("/");
                          const kind = colonIdx !== -1 ? ref.slice(0, colonIdx) : "";
                          const name = slashIdx !== -1 ? ref.slice(slashIdx + 1) : ref;
                          const kindCap = kind ? kind[0].toUpperCase() + kind.slice(1) : "";
                          const href = kindCap ? `/dashboard/catalog/${kindCap}/${name}` : "#";
                          return (
                            <Link
                              key={ref}
                              href={href}
                              className="group/chip inline-flex items-baseline gap-0.5 rounded-md border border-border bg-muted/40 px-2 py-0.5 transition-colors hover:border-wxops-purple/40 hover:bg-wxops-purple/5"
                            >
                              {kind && (
                                <span className="font-mono text-[10px] text-muted-foreground/50 group-hover/chip:text-muted-foreground transition-colors">
                                  {kind}/
                                </span>
                              )}
                              <span className="font-mono text-[11px] font-medium text-foreground/80 group-hover/chip:text-wxops-purple transition-colors">
                                {name}
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Resources */}
            {hasLinks && (
              <Card>
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Resources
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3 pt-1 space-y-3">
                  {docLinks.length > 0 && (
                    <div className="space-y-1.5">
                      {docLinks.map((l) => (
                        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          <span className="truncate">{l.title ?? l.url}</span>
                        </a>
                      ))}
                    </div>
                  )}
                  {rfcLinks.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wide">RFCs</p>
                      {rfcLinks.map((l) => (
                        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-violet-600 dark:text-violet-400 hover:underline"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          <span className="truncate">{l.title ?? l.url}</span>
                        </a>
                      ))}
                    </div>
                  )}
                  {adrLinks.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">ADRs</p>
                      {adrLinks.map((l) => (
                        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          <span className="truncate">{l.title ?? l.url}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Annotations */}
            {displayAnnotations.length > 0 && (
              <Card>
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Annotations
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3 pt-1 space-y-2">
                  {displayAnnotations.map(([key, value]) => (
                    <div key={key} className="text-xs space-y-0.5">
                      <p className="font-mono text-[10px] text-muted-foreground break-all">{key}</p>
                      <p className="font-mono text-foreground break-all">{value}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

          </div>
        )}

      </div>

    </div>
  );
}
