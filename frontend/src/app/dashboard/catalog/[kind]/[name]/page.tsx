import { cookies } from "next/headers";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OpenApiViewer } from "@/components/catalog/openapi-viewer";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

interface EntityLink {
  url: string;
  title?: string;
  icon?: string;
  type?: string;
}

interface Entity {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    title?: string;
    description?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    tags?: string[];
    links?: EntityLink[];
  };
  spec: {
    owner?: string;
    lifecycle?: string;
    type?: string;
    system?: string;
    domain?: string;
    dependsOn?: string[];
    providesApis?: string[];
    consumesApis?: string[];
    parent?: string;
    children?: string[];
    members?: string[];
    definition?: string;
  };
}

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
  production:   "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
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

export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ kind: string; name: string }>;
}) {
  const { kind, name } = await params;
  const cookieStore = await cookies();
  const session = cookieStore.get("wxops_session")?.value ?? "";

  const { entity, error } = await fetchEntity(session, kind, name);

  if (error || !entity) {
    return (
      <div className="space-y-4">
        <Link
          href="/dashboard/catalog"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Catalog
        </Link>
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {error ?? "Entity not found"}
        </div>
      </div>
    );
  }

  const lifecycle = entity.spec.lifecycle ?? "";
  const badgeClass = lifecycleBadge[lifecycle] ?? "bg-muted text-muted-foreground";
  const displayTitle = entity.metadata.title ?? entity.metadata.name;
  const tags = entity.metadata.tags ?? [];

  const allLinks = entity.metadata.links ?? [];
  const rfcLinks   = allLinks.filter((l) => l.type === "rfc");
  const adrLinks   = allLinks.filter((l) => l.type === "adr");
  const docLinks   = allLinks.filter((l) => l.type !== "rfc" && l.type !== "adr" && l.type !== "openapi");
  const hasLinks   = rfcLinks.length + adrLinks.length + docLinks.length > 0;

  const displayAnnotations = Object.entries(entity.metadata.annotations ?? {}).filter(
    ([k]) => !k.startsWith("kubectl.kubernetes.io"),
  );

  // Relationships
  const relationships = [
    ...(entity.spec.dependsOn    ?? []).map((r) => ({ label: "Depends on",    ref: r })),
    ...(entity.spec.providesApis ?? []).map((r) => ({ label: "Provides API",  ref: r })),
    ...(entity.spec.consumesApis ?? []).map((r) => ({ label: "Consumes API",  ref: r })),
    ...(entity.spec.members      ?? []).map((r) => ({ label: "Member",        ref: r })),
    ...(entity.spec.children     ?? []).map((r) => ({ label: "Child",         ref: r })),
  ];

  // OpenAPI spec
  const hasOpenapiLink = allLinks.some((l) => l.type === "openapi");
  const showApiRef = entity.kind === "API" && (!!entity.spec.definition || hasOpenapiLink);
  const apiSpecUrl = showApiRef && !entity.spec.definition
    ? `/api/v1/catalog/entities/${entity.kind}/${entity.metadata.name}/spec`
    : undefined;

  // Meta strip fields
  const metaFields = [
    entity.spec.owner  && { label: "Owner",  value: entity.spec.owner,  mono: true  },
    entity.spec.system && { label: "System", value: entity.spec.system, mono: true  },
    entity.spec.domain && { label: "Domain", value: entity.spec.domain, mono: false },
    entity.spec.parent && { label: "Parent", value: entity.spec.parent, mono: true  },
  ].filter(Boolean) as { label: string; value: string; mono: boolean }[];

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

      {/* ── Entity header card ───────────────────────────────────────────── */}
      <div className="rounded-lg border bg-card">
        {/* Identity block */}
        <div className="p-5">
          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Badge variant="secondary">{entity.kind}</Badge>
            {lifecycle && (
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClass}`}>
                {lifecycle}
              </span>
            )}
            {entity.spec.type && (
              <Badge variant="outline" className="text-xs">{entity.spec.type}</Badge>
            )}
          </div>

          {/* Title + subtitle */}
          <h1 className="text-xl font-bold leading-tight">{displayTitle}</h1>
          {entity.metadata.title && (
            <p className="text-xs font-mono text-muted-foreground mt-0.5">
              {entity.metadata.name}
            </p>
          )}

          {/* Description */}
          {entity.metadata.description && (
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              {entity.metadata.description}
            </p>
          )}

          {/* Tags */}
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

        {/* Meta strip — compact horizontal key-value row */}
        {metaFields.length > 0 && (
          <div className="border-t px-5 py-2.5 flex flex-wrap gap-x-6 gap-y-1">
            {metaFields.map((f) => (
              <MetaRow key={f.label} label={f.label} value={f.value} mono={f.mono} />
            ))}
          </div>
        )}
      </div>

      {/* ── OpenAPI spec (full width, dominant for API entities) ────────── */}
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

      {/* ── Details row — auto-fit, only renders sections with content ──── */}
      {(relationships.length > 0 || hasLinks || displayAnnotations.length > 0) && (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">

          {/* Relationships */}
          {relationships.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Relationships
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Group by type for cleaner reading */}
                <RefList items={entity.spec.dependsOn}    label="Depends On" />
                <RefList items={entity.spec.providesApis} label="Provides APIs" />
                <RefList items={entity.spec.consumesApis} label="Consumes APIs" />
                <RefList items={entity.spec.members}      label="Members" />
                <RefList items={entity.spec.children}     label="Children" />
              </CardContent>
            </Card>
          )}

          {/* Resources (docs + RFCs + ADRs in one card) */}
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

          {/* Annotations */}
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
