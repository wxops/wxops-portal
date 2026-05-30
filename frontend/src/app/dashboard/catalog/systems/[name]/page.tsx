import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MermaidDiagram } from "@/components/catalog/mermaid-diagram";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

interface Entity {
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    title?: string;
    description?: string;
    tags?: string[];
    links?: { url: string; title?: string }[];
    annotations?: Record<string, string>;
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
  };
}

async function fetchEntities(
  cookie: string,
): Promise<{ entities: Entity[]; error?: string }> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/catalog/entities`, {
      headers: { Cookie: `wxops_session=${cookie}` },
      cache: "no-store",
    });
    if (!res.ok) return { entities: [], error: await res.text() };
    return res.json();
  } catch {
    return { entities: [], error: "Backend unreachable" };
  }
}

const lifecycleBadge: Record<string, string> = {
  production:   "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  experimental: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  deprecated:   "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

function EntityCard({ entity }: { entity: Entity }) {
  const lifecycle = entity.spec.lifecycle ?? "";
  const badgeClass = lifecycleBadge[lifecycle] ?? "bg-muted text-muted-foreground";

  return (
    <Link
      href={`/dashboard/catalog/${entity.kind}/${entity.metadata.name}`}
      className="block group"
    >
      <Card className="flex flex-col h-full transition-colors group-hover:border-primary/50 group-hover:bg-muted/30">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm font-medium leading-snug">
              {entity.metadata.title ?? entity.metadata.name}
            </CardTitle>
            {lifecycle && (
              <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
                {lifecycle}
              </span>
            )}
          </div>
          <p className="text-xs font-mono text-muted-foreground">
            {entity.metadata.name}
          </p>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-2">
          {entity.metadata.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {entity.metadata.description}
            </p>
          )}
          <div className="flex flex-wrap gap-1 mt-auto">
            {entity.spec.type && (
              <Badge variant="secondary" className="text-xs">
                {entity.spec.type}
              </Badge>
            )}
            {entity.metadata.tags?.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Section({
  title,
  entities,
}: {
  title: string;
  entities: Entity[];
}) {
  if (entities.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          {title}
        </h2>
        <span className="text-xs text-muted-foreground">({entities.length})</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entities.map((e) => (
          <EntityCard key={`${e.kind}/${e.metadata.name}`} entity={e} />
        ))}
      </div>
    </section>
  );
}

// ── Diagram builder ───────────────────────────────────────────────────────────

// Parses "kind:namespace/name" or "kind:name" → the name segment.
function refName(ref: string): string {
  const afterColon = ref.includes(":") ? ref.split(":")[1] : ref;
  return afterColon.includes("/") ? afterColon.split("/").pop()! : afterColon;
}

// Sanitises a name into a valid Mermaid node ID (no hyphens, dots, spaces).
function nodeId(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_");
}

function buildDiagram(members: Entity[]): string {
  if (members.length === 0) return "";

  const memberNames = new Set(members.map((e) => e.metadata.name));
  const lines: string[] = ["flowchart LR"];

  // Node declarations — shape encodes kind
  for (const e of members) {
    const id    = nodeId(e.metadata.name);
    const label = e.metadata.title ?? e.metadata.name;
    switch (e.kind) {
      case "Component":
        lines.push(`  ${id}["${label}"]`);
        break;
      case "API":
        lines.push(`  ${id}(["${label}"])`);
        break;
      case "Resource":
        lines.push(`  ${id}[("${label}")]`);
        break;
    }
  }

  // Edges — only draw when both ends are inside this system
  for (const e of members) {
    if (e.kind !== "Component") continue;
    const src = nodeId(e.metadata.name);

    for (const ref of e.spec.providesApis ?? []) {
      const n = refName(ref);
      if (memberNames.has(n)) lines.push(`  ${src} -->|provides| ${nodeId(n)}`);
    }

    for (const ref of e.spec.consumesApis ?? []) {
      const n = refName(ref);
      if (memberNames.has(n)) lines.push(`  ${nodeId(n)} -->|consumed by| ${src}`);
    }

    for (const ref of e.spec.dependsOn ?? []) {
      const n = refName(ref);
      if (memberNames.has(n)) lines.push(`  ${src} --> ${nodeId(n)}`);
    }
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────

export default async function SystemDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const cookieStore = await cookies();
  const session = cookieStore.get("wxops_session")?.value ?? "";

  const { entities, error } = await fetchEntities(session);

  // Find the System entity itself for metadata
  const system = entities.find(
    (e) => e.kind === "System" && e.metadata.name === name,
  );

  // All entities that belong to this system
  const members = entities.filter(
    (e) => e.kind !== "System" && e.spec.system === name,
  );

  const components = members.filter((e) => e.kind === "Component");
  const apis       = members.filter((e) => e.kind === "API");
  const resources  = members.filter((e) => e.kind === "Resource");

  const displayName = system?.metadata.title ?? system?.metadata.name ?? name;
  const diagram = buildDiagram(members);

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Breadcrumb */}
      <Link
        href="/dashboard/catalog"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Catalog
      </Link>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary">System</Badge>
          {system?.spec.domain && (
            <Badge variant="outline">{system.spec.domain}</Badge>
          )}
        </div>
        <h1 className="text-2xl font-bold">{displayName}</h1>
        {system?.metadata.name && system.metadata.name !== displayName && (
          <p className="text-sm font-mono text-muted-foreground">
            {system.metadata.name}
          </p>
        )}
        {system?.metadata.description && (
          <p className="text-muted-foreground max-w-2xl">
            {system.metadata.description}
          </p>
        )}
        {system?.spec.owner && (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">Owner:</span> {system.spec.owner}
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          Failed to load catalog: {error}
        </div>
      )}

      {!error && members.length === 0 && (
        <div className="rounded-md border border-dashed px-6 py-10 text-center text-muted-foreground text-sm">
          No services, APIs, or resources registered under this system yet.
        </div>
      )}

      {/* System links */}
      {(system?.metadata.links ?? []).length > 0 && (
        <div className="flex flex-wrap gap-3">
          {system!.metadata.links!.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {link.title ?? link.url}
            </a>
          ))}
        </div>
      )}

      {/* Relationship diagram */}
      {diagram && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Service Graph
          </h2>
          <div className="rounded-md border bg-muted/20 p-4">
            <MermaidDiagram chart={diagram} />
          </div>
        </section>
      )}

      {/* Member entities grouped by kind */}
      <Section title="Services"  entities={components} />
      <Section title="APIs"      entities={apis} />
      <Section title="Resources" entities={resources} />
    </div>
  );
}
