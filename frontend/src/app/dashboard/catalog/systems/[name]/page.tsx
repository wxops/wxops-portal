import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GraphPanel } from "@/components/catalog/graph-panel";
import { type DocTooltipData } from "@/components/catalog/mermaid-diagram";

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
    // Doc-specific
    docType?: string;
    docStatus?: string;
    supersededBy?: string;
    relatedTo?: string[];
    contentUrl?: string;
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

const docTypeBadge: Record<string, string> = {
  rfc:           "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  adr:           "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  documentation: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
};

const docStatusColors: Record<string, string> = {
  proposed:      "text-amber-600 dark:text-amber-400",
  "under-review":"text-blue-600 dark:text-blue-400",
  accepted:      "text-green-600 dark:text-green-400",
  deprecated:    "text-gray-500",
  superseded:    "text-orange-500",
};

function EntityCard({ entity }: { entity: Entity }) {
  const lifecycle  = entity.spec.lifecycle ?? "";
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

function DocCard({ doc }: { doc: Entity }) {
  const docType   = doc.spec.docType ?? "documentation";
  const docStatus = doc.spec.docStatus ?? "proposed";

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
              className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${docTypeBadge[docType] ?? "bg-muted text-muted-foreground"}`}
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
          <div className="mt-auto flex items-center justify-between">
            <span className={`text-xs font-medium ${docStatusColors[docStatus] ?? "text-muted-foreground"}`}>
              {docStatus}
            </span>
            {doc.metadata.tags?.slice(0, 2).map((tag) => (
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

function Section({ title, entities }: { title: string; entities: Entity[] }) {
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

function refName(ref: string): string {
  const afterColon = ref.includes(":") ? ref.split(":")[1] : ref;
  return afterColon.includes("/") ? afterColon.split("/").pop()! : afterColon;
}

function nodeId(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_");
}

function roleLabel(kind: string, type?: string): string {
  if (kind === "Component") {
    const m: Record<string, string> = {
      service: "SERVICE", website: "WEBSITE", library: "LIBRARY", pipeline: "PIPELINE",
    };
    return m[(type ?? "service").toLowerCase()] ?? (type ?? "service").toUpperCase();
  }
  if (kind === "API") {
    const m: Record<string, string> = {
      openapi: "REST", grpc: "gRPC", asyncapi: "EVENT", graphql: "GRAPHQL",
    };
    return m[(type ?? "").toLowerCase()] ?? "API";
  }
  if (kind === "Resource") {
    const m: Record<string, string> = {
      database: "DATABASE", vault: "VAULT", repository: "REPO",
      queue: "QUEUE", cache: "CACHE", s3: "STORAGE",
    };
    return m[(type ?? "").toLowerCase()] ?? "RESOURCE";
  }
  return kind.toUpperCase();
}

function buildDiagram(members: Entity[]): string {
  if (members.length === 0) return "";

  const memberNames = new Set(members.map((e) => e.metadata.name));
  const lines: string[] = [
    '%%{init: {"theme": "dark", "themeVariables": {"lineColor": "#4b5563", "edgeLabelBackground": "#13111f"}, "flowchart": {"nodeSpacing": 40, "rankSpacing": 60, "padding": 18, "curve": "basis"}}}%%',
    "flowchart LR",
  ];

  // Brand-aligned node classes — dark canvas, role-color per kind
  lines.push("  classDef serviceNode fill:#1e1347,stroke:#8b5cf6,color:#c4b5fd,stroke-width:1.5px");
  lines.push("  classDef apiNode fill:#0c3547,stroke:#22d3ee,color:#a5f3fc,stroke-width:1.5px");
  lines.push("  classDef resourceNode fill:#161550,stroke:#818cf8,color:#c7d2fe,stroke-width:1.5px");
  lines.push("  classDef rfcNode fill:#1e1347,stroke:#a78bfa,color:#ddd6fe,stroke-width:1.5px,stroke-dasharray:6 3");
  lines.push("  classDef adrNode fill:#0c1f4a,stroke:#60a5fa,color:#bfdbfe,stroke-width:1.5px");
  lines.push("  classDef docNode fill:#082a18,stroke:#34d399,color:#6ee7b7,stroke-width:1.5px");

  // Node declarations ordered: Components → APIs → Resources → Docs
  const ordered = [
    ...members.filter((e) => e.kind === "Component"),
    ...members.filter((e) => e.kind === "API"),
    ...members.filter((e) => e.kind === "Resource"),
    ...members.filter((e) => e.kind === "Doc"),
  ];

  for (const e of ordered) {
    const id    = nodeId(e.metadata.name);
    const label = e.metadata.title ?? e.metadata.name;
    const role  = roleLabel(e.kind, e.spec.type);

    switch (e.kind) {
      case "Component":
        lines.push(`  ${id}["${role}: ${label}"]`);
        lines.push(`  class ${id} serviceNode`);
        break;
      case "API":
        lines.push(`  ${id}(["${role}: ${label}"])`);
        lines.push(`  class ${id} apiNode`);
        break;
      case "Resource":
        lines.push(`  ${id}[("${role}: ${label}")]`);
        lines.push(`  class ${id} resourceNode`);
        break;
      case "Doc": {
        const dt = e.spec.docType ?? "documentation";
        if (dt === "rfc") {
          lines.push(`  ${id}{{"RFC: ${label}"}}`);
          lines.push(`  class ${id} rfcNode`);
        } else if (dt === "adr") {
          lines.push(`  ${id}[/"ADR: ${label}"\\]`);
          lines.push(`  class ${id} adrNode`);
        } else {
          lines.push(`  ${id}>"DOC: ${label}"]`);
          lines.push(`  class ${id} docNode`);
        }
        // Click navigates to Doc detail page
        lines.push(`  click ${id} "/dashboard/catalog/Doc/${e.metadata.name}"`);
        break;
      }
    }
  }

  // Component → API / Resource / dependency edges
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

  // Doc → supersededBy (RFC → ADR decision chain)
  for (const e of members) {
    if (e.kind !== "Doc") continue;
    const src = nodeId(e.metadata.name);

    if (e.spec.supersededBy) {
      const n = refName(e.spec.supersededBy);
      if (memberNames.has(n))
        lines.push(`  ${src} -->|"→ ADR"| ${nodeId(n)}`);
    }

    // Doc → related components/resources (dotted)
    for (const ref of e.spec.relatedTo ?? []) {
      const n = refName(ref);
      if (memberNames.has(n))
        lines.push(`  ${src} -.->|"relates to"| ${nodeId(n)}`);
    }
  }

  return lines.join("\n");
}

function buildDocTooltips(docs: Entity[]): Record<string, DocTooltipData> {
  const tooltips: Record<string, DocTooltipData> = {};
  for (const d of docs) {
    tooltips[nodeId(d.metadata.name)] = {
      title:       d.metadata.title ?? d.metadata.name,
      docType:     d.spec.docType ?? "documentation",
      status:      d.spec.docStatus ?? "proposed",
      description: d.metadata.description,
    };
  }
  return tooltips;
}

// ─────────────────────────────────────────────────────────────────────────────

export default async function SystemDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name }     = await params;
  const cookieStore  = await cookies();
  const session      = cookieStore.get("wxops_session")?.value ?? "";

  const { entities, error } = await fetchEntities(session);

  const system = entities.find(
    (e) => e.kind === "System" && e.metadata.name === name,
  );

  const members = entities.filter(
    (e) => e.kind !== "System" && e.spec.system === name,
  );

  const components = members.filter((e) => e.kind === "Component");
  const apis       = members.filter((e) => e.kind === "API");
  const resources  = members.filter((e) => e.kind === "Resource");
  const docs       = members.filter((e) => e.kind === "Doc");

  const rfcs           = docs.filter((d) => d.spec.docType === "rfc");
  const adrs           = docs.filter((d) => d.spec.docType === "adr");
  const documentation  = docs.filter((d) => !d.spec.docType || d.spec.docType === "documentation");

  const displayName    = system?.metadata.title ?? system?.metadata.name ?? name;
  const diagramBase    = buildDiagram(members.filter((e) => e.kind !== "Doc"));
  const diagramFull    = buildDiagram(members);
  const docTooltips    = buildDocTooltips(docs);

  return (
    <div className="space-y-8 max-w-7xl">

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
            <span className="font-medium">Owner:</span>{" "}
            <Link
              href={`/dashboard/catalog/groups/${refName(system.spec.owner)}`}
              className="font-mono text-primary hover:underline"
            >
              {system.spec.owner}
            </Link>
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

      {/* Decision & Service Graph */}
      {(diagramBase || diagramFull) && (
        <GraphPanel
          chartBase={diagramBase}
          chartWithDocs={docs.length > 0 ? diagramFull : undefined}
          docTooltips={Object.keys(docTooltips).length > 0 ? docTooltips : undefined}
          docsCount={docs.length}
        />
      )}

      {/* Member entities */}
      <Section title="Services"   entities={components} />
      <Section title="APIs"       entities={apis} />
      <Section title="Resources"  entities={resources} />

      {/* Decision Documents */}
      {docs.length > 0 && (
        <div className="space-y-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Decision Documents
          </h2>

          {rfcs.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-violet-700 dark:text-violet-400 uppercase tracking-wider">
                  RFCs
                </span>
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
                <span className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider">
                  ADRs
                </span>
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
                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                  Documentation
                </span>
                <span className="text-xs text-muted-foreground">({documentation.length})</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {documentation.map((d) => <DocCard key={d.metadata.name} doc={d} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
