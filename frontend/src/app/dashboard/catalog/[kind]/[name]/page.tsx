import { Suspense } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { ExternalLink, FileText, Plus, Hammer, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OpenApiViewer } from "@/components/catalog/openapi-viewer";
import { EntityActions } from "@/components/catalog/entity-actions";
import { RuntimeStatusCard } from "@/components/catalog/runtime-status-card";
import { CIStatusCard } from "@/components/catalog/ci-status-card";
import { ReleasesCard } from "@/components/catalog/releases-card";
import { PackagesCard } from "@/components/catalog/packages-card";
import { getSession } from "@/lib/session";
import type { Entity } from "@/lib/types";
import { relatedToIncludes } from "@/lib/types";

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

async function fetchAllEntities(cookie: string): Promise<Entity[]> {
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

const docStatusBadge: Record<string, string> = {
  proposed:     "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  "under-review": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  accepted:     "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  deprecated:   "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  superseded:   "bg-gray-100 text-gray-600 dark:bg-gray-800/30 dark:text-gray-400",
};

const docTypeIcon: Record<string, string> = {
  rfc: "RFC",
  adr: "ADR",
  documentation: "Doc",
};

const lifecycleBadge: Record<string, string> = {
  production:   "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  development:  "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  experimental: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
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

function RefList({ items, label }: { items?: string[]; label: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((ref) => (
          <Badge key={ref} variant="outline" className="font-mono text-xs">
            {ref}
          </Badge>
        ))}
      </div>
    </div>
  );
}

// ── Streamed section: Related Documents ─────────────────────────────────
// This async server component fetches all entities to find related Docs.
// It streams independently behind a Suspense boundary so the entity header
// renders instantly without waiting for this (expensive) fetch.
async function RelatedDocsSection({
  entity,
  sessionCookie,
}: {
  entity: Entity;
  sessionCookie: string;
}) {
  const allEntities = await fetchAllEntities(sessionCookie);
  const entityRef = `${entity.kind.toLowerCase()}:${entity.metadata.namespace || "default"}/${entity.metadata.name}`;
  const relatedDocs = allEntities.filter(
    (e) => e.kind === "Doc" && relatedToIncludes(e.spec.relatedTo, entityRef),
  );

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-0.5">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Documents
        </h2>
        <Link
          href={`/dashboard/catalog/register?kind=Doc&relatedTo=${entityRef}`}
          className="flex items-center gap-1 text-xs font-medium text-wxops-purple hover:text-wxops-purple/80 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New Document
        </Link>
      </div>
      {relatedDocs.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {relatedDocs.map((doc) => {
            const statusClass = docStatusBadge[doc.spec.docStatus ?? ""] ?? "bg-muted text-muted-foreground";
            const typeLabel = docTypeIcon[doc.spec.docType ?? ""] ?? doc.spec.docType ?? "Doc";
            const isDraftDoc = doc.spec.draft === true;
            return (
              <Link
                key={doc.metadata.name}
                href={`/dashboard/catalog/Doc/${doc.metadata.name}`}
                className="group rounded-lg border border-border p-3 transition-all hover:border-wxops-purple/40 hover:bg-wxops-purple/5"
              >
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-semibold text-wxops-purple">{typeLabel}</span>
                  {isDraftDoc && (
                    <span className="text-[10px] rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 px-1.5 py-0.5 font-medium">
                      Draft
                    </span>
                  )}
                  {doc.spec.docStatus && (
                    <span className={`text-[10px] rounded-full px-1.5 py-0.5 font-medium ${statusClass}`}>
                      {doc.spec.docStatus}
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium group-hover:text-foreground leading-tight">
                  {doc.metadata.title ?? doc.metadata.name}
                </p>
                {doc.metadata.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {doc.metadata.description}
                  </p>
                )}
                {doc.spec.author && (
                  <p className="text-[10px] text-muted-foreground mt-1.5 font-mono">
                    {doc.spec.author}
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <FileText className="h-5 w-5 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No documents linked to this {entity.kind.toLowerCase()} yet.</p>
          <Link
            href={`/dashboard/catalog/register?kind=Doc&relatedTo=${entityRef}`}
            className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-wxops-purple hover:text-wxops-purple/80"
          >
            <Plus className="h-3 w-3" />
            Create an RFC, ADR, or Runbook
          </Link>
        </div>
      )}
    </section>
  );
}

function DocsSkeleton() {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-0.5">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Documents
        </h2>
      </div>
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading documents...
      </div>
    </section>
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

  const relationships = [
    ...(entity.spec.dependsOn    ?? []).map((r) => ({ label: "Depends on",    ref: r })),
    ...(entity.spec.providesApis ?? []).map((r) => ({ label: "Provides API",  ref: r })),
    ...(entity.spec.consumesApis ?? []).map((r) => ({ label: "Consumes API",  ref: r })),
    ...(entity.spec.relatedTo    ?? []).map((r) => ({ label: "Related to",    ref: r })),
    ...(entity.spec.members      ?? []).map((r) => ({ label: "Member",        ref: r })),
    ...(entity.spec.children     ?? []).map((r) => ({ label: "Child",         ref: r })),
  ];

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

  return (
    <div className="space-y-5 max-w-7xl">

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

      {/* ── Entity header card (renders instantly) ───────────────────────── */}
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
            <div className="ml-auto">
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

      {/* ── Runtime Status (scaffolded Components only) ──────────────── */}
      {hasScaffoldInfo && entity.kind === "Component" && (
        <RuntimeStatusCard
          appName={entity.metadata.name}
          team={entity.spec.owner?.includes(":") ? entity.spec.owner.split(":")[1] : entity.spec.owner ?? ""}
        />
      )}

      {/* ── CI, Releases, Packages — client components, self-loading ──── */}
      {hasSourceRepo && entity.kind === "Component" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <CIStatusCard entityKind={entity.kind} entityName={entity.metadata.name} />
          <ReleasesCard entityKind={entity.kind} entityName={entity.metadata.name} />
          <PackagesCard entityKind={entity.kind} entityName={entity.metadata.name} />
        </div>
      )}

      {/* ── OpenAPI spec ────────────────────────────────────────────────── */}
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

      {/* ── Documents — streams in via Suspense (needs allEntities fetch) */}
      {showDocs && (
        <Suspense fallback={<DocsSkeleton />}>
          <RelatedDocsSection entity={entity} sessionCookie={sessionCookie} />
        </Suspense>
      )}

      {/* ── Details row — renders instantly from entity data ────────────── */}
      {(relationships.length > 0 || hasLinks || displayAnnotations.length > 0 || hasScaffoldInfo) && (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">

          {hasScaffoldInfo && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <Hammer className="h-3.5 w-3.5" />
                  Scaffold Info
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
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
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                )}
                {scaffoldAnnotations["gitea/source-location"] && (
                  <div className="text-xs space-y-0.5">
                    <p className="text-muted-foreground">Source</p>
                    <p className="font-mono text-foreground">
                      {scaffoldAnnotations["gitea/source-location"]}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {relationships.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Relationships
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <RefList items={entity.spec.dependsOn}    label="Depends On" />
                <RefList items={entity.spec.providesApis} label="Provides APIs" />
                <RefList items={entity.spec.consumesApis} label="Consumes APIs" />
                <RefList items={entity.spec.relatedTo}    label="Related To" />
                <RefList items={entity.spec.members}      label="Members" />
                <RefList items={entity.spec.children}     label="Children" />
              </CardContent>
            </Card>
          )}

          {hasLinks && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Resources
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {docLinks.length > 0 && (
                  <div className="space-y-1.5">
                    {docLinks.map((l) => (
                      <a
                        key={l.url}
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-primary hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        {l.title ?? l.url}
                      </a>
                    ))}
                  </div>
                )}
                {rfcLinks.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">RFCs</p>
                    {rfcLinks.map((l) => (
                      <a
                        key={l.url}
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400 hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        {l.title ?? l.url}
                      </a>
                    ))}
                  </div>
                )}
                {adrLinks.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">ADRs</p>
                    {adrLinks.map((l) => (
                      <a
                        key={l.url}
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        {l.title ?? l.url}
                      </a>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {displayAnnotations.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Annotations
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {displayAnnotations.map(([key, value]) => (
                  <div key={key} className="text-xs space-y-0.5">
                    <p className="font-mono text-muted-foreground">{key}</p>
                    <p className="font-mono text-foreground break-all">{value}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

        </div>
      )}

    </div>
  );
}
