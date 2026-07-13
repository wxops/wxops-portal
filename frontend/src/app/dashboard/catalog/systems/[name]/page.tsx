import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { GraphPanel } from "@/components/catalog/graph-panel";
import { SectionTabs } from "@/components/catalog/section-tabs";
import type { SectionTab } from "@/components/catalog/section-tabs";
import { type DocTooltipData } from "@/components/catalog/mermaid-diagram";
import { EntityActions } from "@/components/catalog/entity-actions";
import { getSession } from "@/lib/session";
import type { Entity as SharedEntity } from "@/lib/types";
import { relatedToIncludesAny } from "@/lib/types";

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
  experimental: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  development:  "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  staging:      "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  production:   "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  deprecated:   "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const lifecycleBorderAccent: Record<string, string> = {
  experimental: "border-l-amber-400",
  development:  "border-l-blue-500",
  staging:      "border-l-violet-500",
  production:   "border-l-green-500",
  deprecated:   "border-l-red-400",
};

const docTypeBadge: Record<string, string> = {
  rfc:           "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  adr:           "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  documentation: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
};

const docTypeBorderAccent: Record<string, string> = {
  rfc:           "border-l-violet-500",
  adr:           "border-l-blue-500",
  documentation: "border-l-emerald-500",
};

const docStatusColors: Record<string, string> = {
  proposed:       "text-amber-600 dark:text-amber-400",
  "under-review": "text-blue-600 dark:text-blue-400",
  accepted:       "text-green-600 dark:text-green-400",
  deprecated:     "text-gray-500",
  superseded:     "text-orange-500",
};

// ── Cards ─────────────────────────────────────────────────────────────────────

function EntityCard({ entity }: { entity: Entity }) {
  const lifecycle   = entity.spec.lifecycle ?? "";
  const badgeClass  = lifecycleBadge[lifecycle] ?? "bg-muted text-muted-foreground";
  const borderClass = lifecycleBorderAccent[lifecycle] ?? "border-l-border";

  return (
    <Link href={`/dashboard/catalog/${entity.kind}/${entity.metadata.name}`} className="block group">
      <Card className={cn(
        "flex flex-col h-full border-l-[3px] transition-all duration-200",
        "group-hover:shadow-md group-hover:border-primary/30 group-hover:-translate-y-0.5",
        borderClass,
      )}>
        <CardHeader className="pb-2 pt-3.5 px-4">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm font-semibold leading-snug text-foreground">
              {entity.metadata.title ?? entity.metadata.name}
            </CardTitle>
            {lifecycle && (
              <span className={cn("shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium", badgeClass)}>
                {lifecycle}
              </span>
            )}
          </div>
          <p className="text-xs font-mono text-muted-foreground mt-0.5 truncate">
            {entity.metadata.name}
          </p>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-2 px-4 pb-3.5">
          {entity.metadata.description && (
            <p className="text-xs text-muted-foreground/90 line-clamp-2 leading-relaxed">
              {entity.metadata.description}
            </p>
          )}
          {(entity.spec.type || (entity.metadata.tags ?? []).length > 0) && (
            <div className="flex flex-wrap gap-1 mt-auto pt-1">
              {entity.spec.type && (
                <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                  {entity.spec.type}
                </Badge>
              )}
              {entity.metadata.tags?.slice(0, 3).map((tag) => (
                <Badge key={tag} variant="outline" className="text-[10px] h-5 px-1.5">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function DocCard({ doc }: { doc: Entity }) {
  const docType    = doc.spec.docType ?? "documentation";
  const docStatus  = doc.spec.docStatus ?? "proposed";
  const borderClass = docTypeBorderAccent[docType] ?? "border-l-border";

  return (
    <Link href={`/dashboard/catalog/Doc/${doc.metadata.name}`} className="block group">
      <Card className={cn(
        "flex flex-col h-full border-l-[3px] transition-all duration-200",
        "group-hover:shadow-md group-hover:border-primary/30 group-hover:-translate-y-0.5",
        borderClass,
      )}>
        <CardHeader className="pb-2 pt-3.5 px-4">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm font-semibold leading-snug">
              {doc.metadata.title ?? doc.metadata.name}
            </CardTitle>
            <span className={cn(
              "shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
              docTypeBadge[docType] ?? "bg-muted text-muted-foreground",
            )}>
              {docType}
            </span>
          </div>
          <p className="text-[11px] font-mono text-muted-foreground mt-0.5 truncate">
            {doc.metadata.name}
          </p>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-2 px-4 pb-3.5">
          {doc.metadata.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
              {doc.metadata.description}
            </p>
          )}
          <div className="mt-auto pt-1 flex items-center justify-between gap-2">
            <span className={cn("text-[11px] font-medium", docStatusColors[docStatus] ?? "text-muted-foreground")}>
              {docStatus}
            </span>
            {doc.metadata.tags?.slice(0, 2).map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px] h-5 px-1.5">
                {tag}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}


// ── Diagram helpers ───────────────────────────────────────────────────────────

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

const THEME_COLORS = {
  dark: {
    init: '%%{init: {"theme": "dark", "themeVariables": {"lineColor": "#4b5563", "edgeLabelBackground": "#13111f"}, "flowchart": {"nodeSpacing": 40, "rankSpacing": 60, "padding": 18, "curve": "basis"}}}%%',
    service:  "fill:#1e1347,stroke:#8b5cf6,color:#c4b5fd,stroke-width:1.5px",
    api:      "fill:#0c3547,stroke:#22d3ee,color:#a5f3fc,stroke-width:1.5px",
    resource: "fill:#161550,stroke:#818cf8,color:#c7d2fe,stroke-width:1.5px",
    rfc:      "fill:#1e1347,stroke:#a78bfa,color:#ddd6fe,stroke-width:1.5px,stroke-dasharray:6 3",
    adr:      "fill:#0c1f4a,stroke:#60a5fa,color:#bfdbfe,stroke-width:1.5px",
    doc:      "fill:#082a18,stroke:#34d399,color:#6ee7b7,stroke-width:1.5px",
  },
  light: {
    init: '%%{init: {"theme": "default", "themeVariables": {"lineColor": "#94a3b8", "edgeLabelBackground": "#ffffff"}, "flowchart": {"nodeSpacing": 40, "rankSpacing": 60, "padding": 18, "curve": "basis"}}}%%',
    service:  "fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:1.5px",
    api:      "fill:#e0f2fe,stroke:#0891b2,color:#164e63,stroke-width:1.5px",
    resource: "fill:#e0e7ff,stroke:#6366f1,color:#312e81,stroke-width:1.5px",
    rfc:      "fill:#ede9fe,stroke:#8b5cf6,color:#4c1d95,stroke-width:1.5px,stroke-dasharray:6 3",
    adr:      "fill:#dbeafe,stroke:#3b82f6,color:#1e3a5f,stroke-width:1.5px",
    doc:      "fill:#d1fae5,stroke:#10b981,color:#064e3b,stroke-width:1.5px",
  },
};

function buildDiagram(members: Entity[], theme: "dark" | "light" = "dark"): string {
  if (members.length === 0) return "";

  const colors      = THEME_COLORS[theme];
  const memberNames = new Set(members.map((e) => e.metadata.name));
  const lines: string[] = [colors.init, "flowchart LR"];

  lines.push(`  classDef serviceNode ${colors.service}`);
  lines.push(`  classDef apiNode ${colors.api}`);
  lines.push(`  classDef resourceNode ${colors.resource}`);
  lines.push(`  classDef rfcNode ${colors.rfc}`);
  lines.push(`  classDef adrNode ${colors.adr}`);
  lines.push(`  classDef docNode ${colors.doc}`);

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
        lines.push(`  click ${id} "/dashboard/catalog/Doc/${e.metadata.name}"`);
        break;
      }
    }
  }

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

  for (const e of members) {
    if (e.kind !== "Doc") continue;
    const src = nodeId(e.metadata.name);
    if (e.spec.supersededBy) {
      const n = refName(e.spec.supersededBy);
      if (memberNames.has(n)) lines.push(`  ${src} -->|"→ ADR"| ${nodeId(n)}`);
    }
    for (const ref of e.spec.relatedTo ?? []) {
      const n = refName(ref);
      if (memberNames.has(n)) lines.push(`  ${src} -.->|"relates to"| ${nodeId(n)}`);
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function SystemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { name }    = await params;
  const { tab: tabParam } = await searchParams;
  const cookieStore = await cookies();
  const session     = cookieStore.get("wxops_session")?.value ?? "";

  const [{ entities, error }, userSession] = await Promise.all([
    fetchEntities(session),
    getSession(),
  ]);
  const userGroups = userSession?.groups ?? [];

  const system = entities.find(
    (e) => e.kind === "System" && e.metadata.name === name,
  );

  const directMembers = entities.filter(
    (e) => e.kind !== "System" && e.kind !== "Doc" && e.spec.system === name,
  );

  const memberRefs = new Set<string>();
  memberRefs.add(`system:default/${name}`);
  for (const m of directMembers) {
    const ns = m.metadata.namespace || "default";
    memberRefs.add(`${m.kind.toLowerCase()}:${ns}/${m.metadata.name}`);
  }

  const relatedDocs = entities.filter(
    (e) => e.kind === "Doc" && relatedToIncludesAny(e.spec.relatedTo, memberRefs),
  );

  const members    = [...directMembers, ...relatedDocs];
  const components = directMembers.filter((e) => e.kind === "Component");
  const apis       = directMembers.filter((e) => e.kind === "API");
  const resources  = directMembers.filter((e) => e.kind === "Resource");
  const docs       = relatedDocs;

  const rfcs          = docs.filter((d) => d.spec.docType === "rfc");
  const adrs          = docs.filter((d) => d.spec.docType === "adr");
  const documentation = docs.filter((d) => !d.spec.docType || d.spec.docType === "documentation");

  const displayName     = system?.metadata.title ?? system?.metadata.name ?? name;
  const baseMembers     = members.filter((e) => e.kind !== "Doc");
  const diagramBase     = buildDiagram(baseMembers, "dark");
  const diagramFull     = buildDiagram(members, "dark");
  const diagramBaseLight  = buildDiagram(baseMembers, "light");
  const diagramFullLight  = buildDiagram(members, "light");
  const docTooltips       = buildDocTooltips(docs);

  const hasGraph = !!(diagramBase || diagramFull);

  return (
    <div className="space-y-4 w-full">

      {/* Breadcrumb — sits above the hero card */}
      <Link
        href="/dashboard/catalog"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Catalog
      </Link>

      {/* ── Hero card ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-gradient-to-br from-background to-muted/20 overflow-hidden">
        <div className="h-px bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-500" />

        <div className="px-5 py-4">
          {/* Title row: name + kind badge + domain + actions */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <Badge variant="secondary" className="text-[10px] font-medium shrink-0">System</Badge>
                {system?.spec.domain && (
                  <Badge variant="outline" className="text-[10px] shrink-0">{system.spec.domain}</Badge>
                )}
              </div>
              <h1 className="text-xl font-bold leading-snug">{displayName}</h1>
              {system?.metadata.name && system.metadata.name !== displayName && (
                <p className="text-xs font-mono text-muted-foreground mt-0.5">{system.metadata.name}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 mt-0.5">
              {hasGraph && (
                <GraphPanel
                  chartBase={diagramBase}
                  chartWithDocs={docs.length > 0 ? diagramFull : undefined}
                  chartBaseLight={diagramBaseLight}
                  chartWithDocsLight={docs.length > 0 ? diagramFullLight : undefined}
                  docTooltips={Object.keys(docTooltips).length > 0 ? docTooltips : undefined}
                  docsCount={docs.length}
                />
              )}
              {system && (
                <EntityActions entity={system as unknown as SharedEntity} userGroups={userGroups} />
              )}
            </div>
          </div>

          {/* Description + meta on one compact strip */}
          {(system?.metadata.description || system?.spec.owner || (system?.metadata.links ?? []).length > 0) && (
            <div className="mt-3 space-y-2">
              {system?.metadata.description && (
                <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
                  {system.metadata.description}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {system?.spec.owner && (
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    <Link
                      href={`/dashboard/catalog/groups/${refName(system.spec.owner)}`}
                      className="font-mono hover:text-primary transition-colors"
                    >
                      {system.spec.owner}
                    </Link>
                  </span>
                )}
                {(system?.metadata.links ?? []).map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {link.title ?? link.url}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Stats strip */}
          {(components.length > 0 || apis.length > 0 || resources.length > 0 || docs.length > 0) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground border-t border-border/40 pt-3">
              {components.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-violet-500" />
                  {components.length} Service{components.length !== 1 ? "s" : ""}
                </span>
              )}
              {apis.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-cyan-500" />
                  {apis.length} API{apis.length !== 1 ? "s" : ""}
                </span>
              )}
              {resources.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-indigo-500" />
                  {resources.length} Resource{resources.length !== 1 ? "s" : ""}
                </span>
              )}
              {docs.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  {docs.length} Doc{docs.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Error / empty states ──────────────────────────────────────────── */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          Failed to load catalog: {error}
        </div>
      )}

      {!error && members.length === 0 && (
        <div className="rounded-xl border border-dashed px-6 py-12 text-center text-muted-foreground text-sm">
          No services, APIs, or resources registered under this system yet.
        </div>
      )}

      {/* ── Member entities — horizontal tabs ────────────────────────────── */}
      {members.length > 0 && (() => {
        const tabs: SectionTab[] = [
          ...(components.length > 0 ? [{
            kind: "services" as const,
            count: components.length,
            children: (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {components.map((e) => <EntityCard key={`${e.kind}/${e.metadata.name}`} entity={e} />)}
              </div>
            ),
          }] : []),
          ...(apis.length > 0 ? [{
            kind: "apis" as const,
            count: apis.length,
            children: (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {apis.map((e) => <EntityCard key={`${e.kind}/${e.metadata.name}`} entity={e} />)}
              </div>
            ),
          }] : []),
          ...(resources.length > 0 ? [{
            kind: "resources" as const,
            count: resources.length,
            children: (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {resources.map((e) => <EntityCard key={`${e.kind}/${e.metadata.name}`} entity={e} />)}
              </div>
            ),
          }] : []),
          ...(docs.length > 0 ? [{
            kind: "docs" as const,
            count: docs.length,
            children: (
              <div className="space-y-5">
                {rfcs.length > 0 && (
                  <div className="space-y-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-400">
                      RFCs <span className="text-muted-foreground font-normal normal-case">({rfcs.length})</span>
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {rfcs.map((d) => <DocCard key={d.metadata.name} doc={d} />)}
                    </div>
                  </div>
                )}
                {adrs.length > 0 && (
                  <div className="space-y-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-600 dark:text-blue-400">
                      ADRs <span className="text-muted-foreground font-normal normal-case">({adrs.length})</span>
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {adrs.map((d) => <DocCard key={d.metadata.name} doc={d} />)}
                    </div>
                  </div>
                )}
                {documentation.length > 0 && (
                  <div className="space-y-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                      Documentation <span className="text-muted-foreground font-normal normal-case">({documentation.length})</span>
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {documentation.map((d) => <DocCard key={d.metadata.name} doc={d} />)}
                    </div>
                  </div>
                )}
              </div>
            ),
          }] : []),
        ];
        return <SectionTabs tabs={tabs} defaultKind={(tabParam as import("@/components/catalog/section-tabs").SectionKind | undefined) ?? "services"} />;
      })()}
    </div>
  );
}
