import { cookies } from "next/headers";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

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

function LinkGroup({
  links,
  label,
  accent,
}: {
  links: EntityLink[];
  label: string;
  accent: string;
}) {
  if (links.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {links.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-2 text-sm hover:underline ${accent}`}
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            {link.title ?? link.url}
          </a>
        ))}
      </CardContent>
    </Card>
  );
}

const lifecycleBadge: Record<string, string> = {
  production:   "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  experimental: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  deprecated:   "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

function RefList({ items, label }: { items?: string[]; label: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
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
      <div className="space-y-6">
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
  const badgeClass =
    lifecycleBadge[lifecycle] ?? "bg-muted text-muted-foreground";

  // Extract notable annotations (non-internal ones worth showing).
  const displayAnnotations = Object.entries(entity.metadata.annotations ?? {}).filter(
    ([k]) => !k.startsWith("kubectl.kubernetes.io"),
  );

  const allLinks = entity.metadata.links ?? [];
  const rfcLinks  = allLinks.filter((l) => l.type === "rfc");
  const adrLinks  = allLinks.filter((l) => l.type === "adr");
  const otherLinks = allLinks.filter((l) => l.type !== "rfc" && l.type !== "adr");

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Breadcrumb — Catalog → System (if applicable) → Entity */}
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
        <span className="text-foreground font-medium">
          {entity.metadata.name}
        </span>
      </nav>

      {/* Header */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary">{entity.kind}</Badge>
            {lifecycle && (
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClass}`}
              >
                {lifecycle}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold mt-2">
            {entity.metadata.title ?? entity.metadata.name}
          </h1>
          {entity.metadata.title && (
            <p className="text-sm font-mono text-muted-foreground mt-0.5">
              {entity.metadata.name}
            </p>
          )}
          {entity.metadata.description && (
            <p className="text-muted-foreground mt-2 max-w-2xl">
              {entity.metadata.description}
            </p>
          )}
        </div>
      </div>

      {/* Tags */}
      {(entity.metadata.tags ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {entity.metadata.tags!.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Spec */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Specification
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {entity.spec.owner && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">
                  Owner
                </p>
                <p className="font-mono">{entity.spec.owner}</p>
              </div>
            )}
            {entity.spec.type && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">
                  Type
                </p>
                <p>{entity.spec.type}</p>
              </div>
            )}
            {entity.spec.system && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">
                  System
                </p>
                <p className="font-mono">{entity.spec.system}</p>
              </div>
            )}
            {entity.spec.domain && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">
                  Domain
                </p>
                <p>{entity.spec.domain}</p>
              </div>
            )}
            {entity.spec.parent && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">
                  Parent
                </p>
                <p className="font-mono">{entity.spec.parent}</p>
              </div>
            )}

            <Separator />

            <RefList items={entity.spec.dependsOn} label="Depends On" />
            <RefList items={entity.spec.providesApis} label="Provides APIs" />
            <RefList items={entity.spec.consumesApis} label="Consumes APIs" />
            <RefList items={entity.spec.members} label="Members" />
            <RefList items={entity.spec.children} label="Children" />
          </CardContent>
        </Card>

        {/* Links + Annotations */}
        <div className="space-y-6">
          {/* Links grouped by type */}
          {allLinks.length > 0 && (
            <div className="space-y-4">
              <LinkGroup links={rfcLinks}   label="RFCs"          accent="text-violet-600 dark:text-violet-400" />
              <LinkGroup links={adrLinks}   label="ADRs"          accent="text-blue-600 dark:text-blue-400" />
              <LinkGroup links={otherLinks} label="Documentation" accent="text-primary" />
            </div>
          )}

          {/* Annotations */}
          {displayAnnotations.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Annotations
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {displayAnnotations.map(([key, value]) => (
                  <div key={key} className="text-xs">
                    <p className="font-mono text-muted-foreground">{key}</p>
                    <p className="font-mono mt-0.5 break-all">{value}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
