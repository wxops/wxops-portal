import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft, ExternalLink, FileText, Hammer, Network, Tag, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { OpenApiViewer } from "@/components/catalog/openapi-viewer";
import { EntityActions } from "@/components/catalog/entity-actions";
import { EntityNavBar } from "@/components/catalog/entity-nav-bar";
import { DocsDrawer } from "@/components/catalog/docs-drawer";
import { RuntimeStatusCard } from "@/components/catalog/runtime-status-card";
import { AlertsCard } from "@/components/catalog/alerts-card";
import { CIStatusCard } from "@/components/catalog/ci-status-card";
import { ReleasesCard } from "@/components/catalog/releases-card";
import { DependenciesCard } from "@/components/catalog/dependencies-card";
import { PromotionPanel } from "@/components/catalog/promotion-panel";
import { EntityTabs } from "@/components/catalog/entity-tabs";
import type { EntityTab } from "@/components/catalog/entity-tabs";
import { ComponentOverview } from "@/components/catalog/component-overview";
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

interface PackagesResponse {
  manifests: {
    ecosystem: string;
    file: string;
    packages: { ecosystem: string; name: string; version: string; direct: boolean; dev: boolean }[];
    truncated: boolean;
    total: number;
  }[];
  templateId: string;
}

// Server-side fetch, same shape as fetchEntity — deliberately not the
// "use client" + useEffect + spinner pattern the other pipeline-tab cards
// use, so the Dependencies card's default view renders with the rest of the
// page instead of popping in after a client round-trip.
async function fetchPackages(
  cookie: string,
  kind: string,
  name: string,
): Promise<PackagesResponse> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/v1/catalog/entities/${kind}/${name}/packages`,
      {
        headers: { Cookie: `wxops_session=${cookie}` },
        cache: "no-store",
      },
    );
    if (!res.ok) return { manifests: [], templateId: "" };
    return await res.json();
  } catch {
    return { manifests: [], templateId: "" };
  }
}

const lifecycleBadge: Record<string, string> = {
  experimental: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  development:  "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  staging:      "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  production:   "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  deprecated:   "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

// Score bands, not exact-match like lifecycleBadge — completeness is a ratio,
// not a fixed enum.
function completenessBadgeClass(score: number, max: number): string {
  if (max === 0) return "bg-muted text-muted-foreground";
  const ratio = score / max;
  if (ratio >= 0.8) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
  if (ratio >= 0.5) return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
  return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
}

export default async function EntityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; name: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { kind, name } = await params;
  const { tab: tabParam } = await searchParams;

  // These kinds have richer dedicated pages — redirect immediately so there
  // is exactly one canonical URL per kind and no dead generic paths.
  const DEDICATED: Record<string, string> = {
    User:   "users",
    Group:  "groups",
    System: "systems",
    Doc:    "Doc",
  };
  if (DEDICATED[kind]) {
    redirect(`/dashboard/catalog/${DEDICATED[kind]}/${name}`);
  }

  const cookieStore    = await cookies();
  const sessionCookie  = cookieStore.get("wxops_session")?.value ?? "";
  const userSession    = await getSession();
  const userGroups     = userSession?.groups ?? [];

  // Fired alongside fetchEntity, not after it — packages only need kind/name,
  // not the entity itself. Whether the result is actually used (hasSourceRepo)
  // isn't known until the entity resolves, but starting the request early
  // avoids stacking two sequential Gitea round trips on the page's critical path.
  const packagesPromise: Promise<PackagesResponse> =
    kind === "Component"
      ? fetchPackages(sessionCookie, kind, name)
      : Promise.resolve({ manifests: [], templateId: "" });

  const [{ entity, error }, packagesResult] = await Promise.all([
    fetchEntity(sessionCookie, kind, name),
    packagesPromise,
  ]);

  if (error || !entity) {
    const isNotFound = !entity || error?.includes("not found");
    return (
      <div className="space-y-4 max-w-lg">
        <Link
          href="/dashboard/catalog"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Catalog
        </Link>
        {isNotFound ? (
          <div className="rounded-xl border p-8 space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <FileText className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-base font-semibold">{kind}/{name} not found</h2>
              <p className="text-sm text-muted-foreground mt-1">
                This entity may not exist yet. If you just scaffolded or registered
                it, the entity will appear after the PR is merged into gitops-infra.
              </p>
            </div>
            <div className="flex justify-center gap-3">
              <Link href="/dashboard/activity" className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50">
                Check Activity
              </Link>
              <Link href="/dashboard/catalog" className="rounded-lg bg-wxops-purple px-4 py-2 text-sm font-medium text-white hover:bg-wxops-purple/90">
                Browse Catalog
              </Link>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}
      </div>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const lifecycle    = entity.spec.lifecycle ?? "";
  const badgeClass   = lifecycleBadge[lifecycle] ?? "bg-muted text-muted-foreground";
  const displayTitle = entity.metadata.title ?? entity.metadata.name;
  const tags         = entity.metadata.tags ?? [];
  const isDraft      = entity.kind === "Doc" && entity.spec.draft === true;

  const allLinks  = entity.metadata.links ?? [];
  const rfcLinks  = allLinks.filter((l) => l.type === "rfc");
  const adrLinks  = allLinks.filter((l) => l.type === "adr");
  const docLinks  = allLinks.filter((l) => l.type !== "rfc" && l.type !== "adr" && l.type !== "openapi");
  const hasLinks  = rfcLinks.length + adrLinks.length + docLinks.length > 0;

  const ownerTeam  = (entity.spec.owner ?? "").replace(/^group:/, "");
  const groupsLower = userGroups.map((g) => g.toLowerCase());
  const isPlatform  = groupsLower.some((g) => g === "platform-team");
  const isManager   = groupsLower.some((g) => g === `${ownerTeam.toLowerCase()}:managers`);
  const isMember    = groupsLower.some((g) => g === ownerTeam.toLowerCase() || g === "platform-team");
  const canElevate  = isPlatform || isManager;

  const scaffoldAnnotationKeys = new Set([
    "wxops.cloud/template-id",
    "wxops.cloud/scaffold-date",
    "gitea/source-location",
  ]);
  const scaffoldAnnotations = Object.fromEntries(
    Object.entries(entity.metadata.annotations ?? {}).filter(([k]) => scaffoldAnnotationKeys.has(k)),
  );
  const hasScaffoldInfo = !!scaffoldAnnotations["wxops.cloud/template-id"];
  const hasSourceRepo   = !!scaffoldAnnotations["gitea/source-location"];

  const displayAnnotations = Object.entries(entity.metadata.annotations ?? {}).filter(
    ([k]) => !k.startsWith("kubectl.kubernetes.io") && !(hasScaffoldInfo && scaffoldAnnotationKeys.has(k)),
  );

  const relGroups = [
    { label: "Depends On",   refs: entity.spec.dependsOn    ?? [], dotCls: "bg-wxops-purple", textCls: "text-wxops-purple" },
    { label: "Provides API", refs: entity.spec.providesApis ?? [], dotCls: "bg-wxops-green",  textCls: "text-wxops-green"  },
    { label: "Consumes API", refs: entity.spec.consumesApis ?? [], dotCls: "bg-wxops-cyan",   textCls: "text-wxops-cyan"   },
    { label: "Related To",   refs: entity.spec.relatedTo    ?? [], dotCls: "bg-wxops-indigo", textCls: "text-wxops-indigo" },
    { label: "Members",      refs: entity.spec.members      ?? [], dotCls: "bg-amber-500",    textCls: "text-amber-500"    },
    { label: "Children",     refs: entity.spec.children     ?? [], dotCls: "bg-slate-400",    textCls: "text-slate-400"    },
  ].filter((g) => g.refs.length > 0);

  const entityRef      = `${entity.kind.toLowerCase()}:${entity.metadata.namespace || "default"}/${entity.metadata.name}`;
  const hasOpenapiLink = allLinks.some((l) => l.type === "openapi");
  const showApiRef     = entity.kind === "API" && (!!entity.spec.definition || hasOpenapiLink);
  const apiSpecUrl     = showApiRef && !entity.spec.definition
    ? `/api/v1/catalog/entities/${entity.kind}/${entity.metadata.name}/spec`
    : undefined;
  const showDocs = ["Component", "System", "Resource", "API"].includes(entity.kind);

  const hasDetails = relGroups.length > 0 || hasLinks || displayAnnotations.length > 0 || hasScaffoldInfo;

  const metaItems = [
    entity.spec.owner  && { Icon: Users,   label: entity.spec.owner,  href: `/dashboard/catalog/groups/${ownerTeam.split(":")[1] ?? ownerTeam}` },
    entity.spec.system && { Icon: Network, label: entity.spec.system, href: `/dashboard/catalog/systems/${entity.spec.system}` },
  ].filter(Boolean) as { Icon: React.ComponentType<{ className?: string }>; label: string; href: string }[];

  // ── Helper for relationship ref chips (shared between Component overview and Details tab) ──

  function RefChips({ refs }: { refs: string[] }) {
    return (
      <div className="flex flex-wrap gap-1">
        {refs.map((ref) => {
          const colonIdx = ref.indexOf(":");
          const slashIdx = ref.lastIndexOf("/");
          const k = colonIdx !== -1 ? ref.slice(0, colonIdx) : "";
          const n = slashIdx !== -1 ? ref.slice(slashIdx + 1) : ref;
          const kCap = k ? k[0].toUpperCase() + k.slice(1) : "";
          const href = kCap ? `/dashboard/catalog/${kCap}/${n}` : "#";
          return (
            <Link
              key={ref}
              href={href}
              className="group/chip inline-flex items-baseline gap-0.5 rounded-md border border-border bg-background px-2 py-0.5 transition-colors hover:border-wxops-purple/40 hover:bg-wxops-purple/5"
            >
              {k && (
                <span className="font-mono text-[10px] text-muted-foreground/50 group-hover/chip:text-muted-foreground transition-colors">
                  {k}/
                </span>
              )}
              <span className="font-mono text-[11px] font-medium text-foreground/80 group-hover/chip:text-wxops-purple transition-colors">
                {n}
              </span>
            </Link>
          );
        })}
      </div>
    );
  }

  // ── Component overview "About" slot — card-based 2-col layout ───────────────

  const componentDetailsSlot = entity.kind === "Component" && hasDetails ? (
    <div className="grid gap-4 sm:grid-cols-2">

      {/* Repository card */}
      {hasScaffoldInfo && (
        <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
          <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <Hammer className="h-3 w-3" />
            Repository
          </h3>
          <div className="space-y-3">
            {scaffoldAnnotations["gitea/source-location"] && (
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground">Source</p>
                <a
                  href={scaffoldAnnotations["gitea/source-location"]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline break-all leading-relaxed"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  {scaffoldAnnotations["gitea/source-location"]}
                </a>
              </div>
            )}
            {scaffoldAnnotations["wxops.cloud/template-id"] && (
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground">Template</p>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {scaffoldAnnotations["wxops.cloud/template-id"]}
                </Badge>
              </div>
            )}
            {scaffoldAnnotations["wxops.cloud/scaffold-date"] && (
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground">Scaffolded</p>
                <p className="text-xs text-foreground">
                  {new Date(scaffoldAnnotations["wxops.cloud/scaffold-date"]).toLocaleDateString("en-US", {
                    year: "numeric", month: "short", day: "numeric",
                  })}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Relationships card */}
      {relGroups.length > 0 && (
        <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
          <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <Network className="h-3 w-3" />
            Relationships
          </h3>
          <div className="space-y-3">
            {relGroups.map(({ label, refs, dotCls, textCls }) => (
              <div key={label} className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotCls)} />
                  <span className={cn("text-[10px] font-semibold uppercase tracking-wide", textCls)}>
                    {label}
                  </span>
                </div>
                <div className="pl-3">
                  <RefChips refs={refs} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Resources & Links card */}
      {hasLinks && (
        <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Resources & Links
          </h3>
          <div className="space-y-2.5">
            {docLinks.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="truncate">{l.title ?? l.url}</span>
              </a>
            ))}
            {rfcLinks.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-widest">RFCs</p>
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
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-widest">ADRs</p>
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
          </div>
        </div>
      )}

      {/* Annotations card */}
      {displayAnnotations.length > 0 && (
        <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Annotations
          </h3>
          <div className="space-y-2">
            {displayAnnotations.map(([key, value]) => (
              <div key={key} className="space-y-0.5">
                <p className="font-mono text-[10px] text-muted-foreground break-all">{key}</p>
                <p className="font-mono text-xs text-foreground break-all">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  ) : null;

  // ── Details tab content for non-Component entities (API, Resource, Doc, etc.) ──

  const detailsContent = hasDetails ? (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">

      {/* Scaffold */}
      {hasScaffoldInfo && (
        <div className="space-y-3">
          <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <Hammer className="h-3 w-3" />
            Scaffold
          </h3>
          <div className="space-y-2.5">
            {scaffoldAnnotations["wxops.cloud/template-id"] && (
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground">Template</p>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {scaffoldAnnotations["wxops.cloud/template-id"]}
                </Badge>
              </div>
            )}
            {scaffoldAnnotations["wxops.cloud/scaffold-date"] && (
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground">Created</p>
                <p className="text-xs text-foreground">
                  {new Date(scaffoldAnnotations["wxops.cloud/scaffold-date"]).toLocaleDateString("en-US", {
                    year: "numeric", month: "short", day: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </p>
              </div>
            )}
            {scaffoldAnnotations["gitea/source-location"] && (
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground">Source</p>
                <p className="font-mono text-[10px] text-foreground break-all leading-relaxed">
                  {scaffoldAnnotations["gitea/source-location"]}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Relationships */}
      {relGroups.length > 0 && (
        <div className="space-y-3">
          <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <Network className="h-3 w-3" />
            Relationships
          </h3>
          <div className="space-y-3">
            {relGroups.map(({ label, refs, dotCls, textCls }) => (
              <div key={label} className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotCls)} />
                  <span className={cn("text-[10px] font-semibold uppercase tracking-wide", textCls)}>
                    {label}
                  </span>
                </div>
                <div className="pl-3">
                  <RefChips refs={refs} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Links & resources */}
      {hasLinks && (
        <div className="space-y-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Resources
          </h3>
          <div className="space-y-2.5">
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
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-widest">RFCs</p>
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
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-widest">ADRs</p>
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
          </div>
        </div>
      )}

      {/* Annotations */}
      {displayAnnotations.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Annotations
          </h3>
          <div className="space-y-2">
            {displayAnnotations.map(([key, value]) => (
              <div key={key} className="space-y-0.5">
                <p className="font-mono text-[10px] text-muted-foreground break-all">{key}</p>
                <p className="font-mono text-xs text-foreground break-all">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  ) : null;

  const packagesData = hasSourceRepo && entity.kind === "Component"
    ? packagesResult
    : { manifests: [], templateId: "" };

  // ── Build tab list ────────────────────────────────────────────────────────

  const tabs: EntityTab[] = [
    // Overview — lifecycle + environments + merged About section (Components only)
    ...(entity.kind === "Component" ? [{
      id: "overview" as const,
      children: (
        <ComponentOverview
          entityKind={entity.kind}
          entityName={entity.metadata.name}
          lifecycle={lifecycle}
          hasSourceRepo={hasSourceRepo}
          detailsSlot={componentDetailsSlot}
        />
      ),
    }] : []),

    // Runtime — full ArgoCD/K8s deployment detail
    ...(hasScaffoldInfo && entity.kind === "Component" ? [{
      id: "runtime" as const,
      children: (
        <div className="space-y-4">
          {/* Alerts first: "is this broken right now?" outranks "what is deployed?" */}
          <AlertsCard entityKind={entity.kind} entityName={entity.metadata.name} />
          <RuntimeStatusCard entityKind={entity.kind} entityName={entity.metadata.name} />
        </div>
      ),
    }] : []),

    // Pipeline — CI · Releases · Packages
    ...(hasSourceRepo && entity.kind === "Component" ? [{
      id: "pipeline" as const,
      children: (
        <div className="grid gap-4 sm:grid-cols-3">
          <CIStatusCard entityKind={entity.kind} entityName={entity.metadata.name} />
          <ReleasesCard entityKind={entity.kind} entityName={entity.metadata.name} />
          <DependenciesCard
            entityKind={entity.kind}
            entityName={entity.metadata.name}
            manifests={packagesData.manifests}
            templateId={packagesData.templateId}
          />
        </div>
      ),
    }] : []),

    // Promote — lifecycle promotion wizard
    ...(hasSourceRepo && entity.kind === "Component" ? [{
      id: "promote" as const,
      children: (
        <PromotionPanel
          entityKind={entity.kind}
          entityName={entity.metadata.name}
          team={ownerTeam}
          canElevate={canElevate}
          isMember={isMember}
          ingressEnabled={entity.metadata.annotations?.["wxops.cloud/ingress"] === "true"}
          vaultEnabled={(entity.spec.dependsOn ?? []).some((d: string) => d.endsWith("-vault"))}
          databaseEnabled={(entity.spec.dependsOn ?? []).some((d: string) =>
            d.replace("resource:default/", "").endsWith("-db"),
          )}
          dbName={(entity.spec.dependsOn ?? []).find((d: string) =>
            d.replace("resource:default/", "").endsWith("-db"),
          )?.replace("resource:default/", "") ?? ""}
          certEnabled={entity.metadata.annotations?.["wxops.cloud/cert-manager"] === "true"}
        />
      ),
    }] : []),

    // API Spec
    ...(showApiRef ? [{
      id: "spec" as const,
      padding: "none" as const,
      children: (
        <OpenApiViewer
          spec={entity.spec.definition || undefined}
          specUrl={apiSpecUrl}
        />
      ),
    }] : []),

    // Details tab — only for non-Component entities (Components merge this into Overview)
    ...(hasDetails && entity.kind !== "Component" ? [{
      id: "details" as const,
      children: detailsContent,
    }] : []),
  ];

  const defaultTab = (tabParam as import("@/components/catalog/entity-tabs").EntityTabId | undefined) ?? tabs[0]?.id;

  return (
    <div className="space-y-4 w-full">

      {/* ── Breadcrumb ────────────────────────────────────────────────────── */}
      <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link
          href="/dashboard/catalog"
          className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Catalog
        </Link>
        {entity.spec.system && (
          <>
            <span className="text-muted-foreground/40">/</span>
            <Link
              href={`/dashboard/catalog/systems/${entity.spec.system}`}
              className="hover:text-foreground transition-colors"
            >
              {entity.spec.system}
            </Link>
          </>
        )}
        <span className="text-muted-foreground/40">/</span>
        <span className="text-foreground font-medium">{entity.metadata.name}</span>
      </nav>

      {/* ── Hero card ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-gradient-to-br from-background to-muted/20 overflow-hidden">
        <div className="h-px bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-500" />
        <div className="px-5 py-4">

          {/* Badges + actions */}
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="text-[10px] font-medium shrink-0">
                {entity.kind}
              </Badge>
              {isDraft && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                  Draft
                </span>
              )}
              {lifecycle && (
                <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium", badgeClass)}>
                  {lifecycle}
                </span>
              )}
              {entity.completenessScore && (
                <span
                  title={`Completeness: ${Object.entries(entity.completenessScore.checks)
                    .map(([k, ok]) => `${ok ? "✓" : "✗"} ${k}`)
                    .join(", ")}`}
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                    completenessBadgeClass(entity.completenessScore.score, entity.completenessScore.max),
                  )}
                >
                  {entity.completenessScore.score}/{entity.completenessScore.max} complete
                </span>
              )}
              {entity.spec.type && (
                <Badge variant="outline" className="text-[10px] shrink-0">{entity.spec.type}</Badge>
              )}
              {entity.spec.docType && (
                <Badge variant="outline" className="text-[10px] shrink-0">{entity.spec.docType}</Badge>
              )}
              {entity.spec.docStatus && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
                  {entity.spec.docStatus}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 mt-0.5">
              <EntityNavBar
                kind={entity.kind}
                name={entity.metadata.name}
                title={displayTitle}
                description={entity.metadata.description ?? ""}
                lifecycle={lifecycle}
              />
              {showDocs && <DocsDrawer entityRef={entityRef} />}
              <EntityActions entity={entity} userGroups={userGroups} />
            </div>
          </div>

          {/* Title */}
          <h1 className="text-xl font-bold leading-snug">{displayTitle}</h1>
          {entity.metadata.title && entity.metadata.name !== displayTitle && (
            <p className="text-xs font-mono text-muted-foreground mt-0.5">{entity.metadata.name}</p>
          )}

          {/* Description */}
          {entity.metadata.description && (
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed max-w-2xl">
              {entity.metadata.description}
            </p>
          )}

          {/* Meta + tags strip */}
          {(metaItems.length > 0 || tags.length > 0 || entity.spec.domain) && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {metaItems.map(({ Icon, label, href }) => (
                <Link key={label} href={href} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                  <Icon className="h-3 w-3" />
                  <span className="font-mono">{label}</span>
                </Link>
              ))}
              {entity.spec.domain && (
                <span className="inline-flex items-center gap-1">
                  <Tag className="h-3 w-3" />
                  <span>{entity.spec.domain}</span>
                </span>
              )}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[10px] h-5 px-1.5">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Horizontal tabs ───────────────────────────────────────────────── */}
      {tabs.length > 0 && (
        <EntityTabs tabs={tabs} defaultTab={defaultTab} />
      )}

    </div>
  );
}
