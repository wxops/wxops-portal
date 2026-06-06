import { cookies } from "next/headers";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import {
  Server,
  Users,
  BookOpen,
  FileText,
  Layers,
  ArrowRight,
  Shield,
} from "lucide-react";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

const PLATFORM_TEAM = "platform-team";

interface CatalogEntity {
  kind: string;
  metadata: { name: string };
  spec?: { owner?: string };
}

interface CatalogStats {
  services: number;
  teams: number;
  docs: number;
  systems: number;
}

function ownerGroupName(owner: string | undefined): string {
  if (!owner) return "";
  const withoutKind = owner.startsWith("group:") ? owner.slice(6) : owner;
  return withoutKind.includes("/") ? withoutKind.split("/").pop()! : withoutKind;
}

async function fetchCatalogStats(
  cookie: string,
  userGroups: string[],
  isPlatformTeam: boolean,
): Promise<CatalogStats> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/catalog/entities`, {
      headers: { Cookie: `wxops_session=${cookie}` },
      cache: "no-store",
    });
    if (!res.ok) return { services: 0, teams: 0, docs: 0, systems: 0 };
    const data = await res.json();
    const entities: CatalogEntity[] = data.entities ?? [];

    const isOwned = (e: CatalogEntity) =>
      isPlatformTeam || userGroups.includes(ownerGroupName(e.spec?.owner));

    const isMyGroup = (e: CatalogEntity) =>
      isPlatformTeam || userGroups.includes(e.metadata.name);

    return {
      services: entities.filter((e) => e.kind === "Component" && isOwned(e)).length,
      teams:    entities.filter((e) => e.kind === "Group"     && isMyGroup(e)).length,
      docs:     entities.filter((e) => e.kind === "Doc"       && isOwned(e)).length,
      systems:  entities.filter((e) => e.kind === "System"    && isOwned(e)).length,
    };
  } catch {
    return { services: 0, teams: 0, docs: 0, systems: 0 };
  }
}

async function fetchClusterCount(cookie: string): Promise<number> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/clusters`, {
      headers: { Cookie: `wxops_session=${cookie}` },
      cache: "no-store",
    });
    if (!res.ok) return 0;
    const data = await res.json();
    return (data.clusters ?? []).length;
  } catch {
    return 0;
  }
}

export default async function DashboardPage() {
  const session     = await requireSession();
  const cookieStore = await cookies();
  const rawCookie   = cookieStore.get("wxops_session")?.value ?? "";

  const groups        = session.groups ?? [];
  const isPlatformTeam = groups.includes(PLATFORM_TEAM);

  const [catalog, clusterCount] = await Promise.all([
    fetchCatalogStats(rawCookie, groups, isPlatformTeam),
    fetchClusterCount(rawCookie),
  ]);

  const statCards = [
    {
      label:    "Services",
      value:    catalog.services,
      sub:      `across ${catalog.systems} system${catalog.systems !== 1 ? "s" : ""}`,
      icon:     Layers,
      color:    "text-wxops-purple",
      bg:       "bg-wxops-purple/10",
      href:     "/dashboard/catalog",
    },
    {
      label:    "Teams",
      value:    catalog.teams,
      sub:      "in catalog",
      icon:     Users,
      color:    "text-wxops-cyan",
      bg:       "bg-wxops-cyan/10",
      href:     "/dashboard/catalog",
    },
    {
      label:    "Documents",
      value:    catalog.docs,
      sub:      "RFCs, ADRs & runbooks",
      icon:     FileText,
      color:    "text-wxops-green",
      bg:       "bg-wxops-green/10",
      href:     "/dashboard/catalog",
    },
    {
      label:    "Clusters",
      value:    clusterCount,
      sub:      "Kubernetes",
      icon:     Server,
      color:    "text-wxops-indigo",
      bg:       "bg-wxops-indigo/10",
      href:     "/dashboard/clusters",
    },
  ];

  const platformCards = [
    {
      href:        "/dashboard/catalog",
      icon:        BookOpen,
      iconColor:   "text-wxops-purple",
      iconBg:      "bg-wxops-purple/10",
      title:       "Service Catalog",
      description: "Browse services, teams, APIs, and decision documents. Understand who owns what and why architectural choices were made.",
    },
    {
      href:        "/dashboard/clusters",
      icon:        Server,
      iconColor:   "text-wxops-cyan",
      iconBg:      "bg-wxops-cyan/10",
      title:       "Clusters",
      description: "Kubernetes cluster visibility and workload management. Inspect namespaces, deployments, and resource health.",
    },
  ];

  return (
    <div className="space-y-10 max-w-5xl hero-glow">

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div className="space-y-4 pt-2">
        {/* Platform status pill */}
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-wxops-green/30 bg-wxops-green/10 px-3 py-1 text-xs font-medium text-wxops-green">
            <span className="h-1.5 w-1.5 rounded-full bg-wxops-green animate-status" />
            Platform online
          </span>
        </div>

        <h1 className="text-4xl font-bold tracking-tight leading-tight sm:text-5xl">
          Welcome back,{" "}
          <span className="text-gradient">{session.username}</span>
        </h1>

        <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">
          Your internal developer platform — services, teams, and decisions in one place.
          Zero boilerplate, zero ops tickets.
        </p>
      </div>

      {/* ── Stats row ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((s) => (
          <Link key={s.label} href={s.href} className="group block">
            <div className="rounded-xl border bg-card p-5 h-full transition-all duration-200 group-hover:border-wxops-purple/40 group-hover:shadow-sm">
              <div className={`inline-flex rounded-lg p-2 mb-4 ${s.bg}`}>
                <s.icon className={`h-5 w-5 ${s.color}`} />
              </div>
              <p className="text-3xl font-bold tracking-tight">{s.value}</p>
              <p className="text-sm font-medium mt-0.5">{s.label}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.sub}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* ── Platform navigation cards ────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          Platform
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {platformCards.map((c) => (
            <Link key={c.href} href={c.href} className="group block">
              <div className="card-gradient-border rounded-xl p-6 h-full transition-all duration-200 group-hover:shadow-md">
                <div className="flex items-start justify-between mb-4">
                  <div className={`inline-flex rounded-lg p-2.5 ${c.iconBg}`}>
                    <c.icon className={`h-5 w-5 ${c.iconColor}`} />
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-1 group-hover:text-foreground mt-1" />
                </div>
                <h3 className="text-base font-semibold mb-1.5">{c.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {c.description}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Identity card ────────────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          Your Identity
        </h2>
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-wxops-purple/15 text-sm font-bold text-wxops-purple border border-wxops-purple/20">
              {session.username.slice(0, 2).toUpperCase()}
            </div>

            {/* Identity details */}
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <p className="font-semibold text-base">{session.username}</p>
                <p className="text-xs font-mono text-muted-foreground truncate mt-0.5">
                  {session.sub}
                </p>
              </div>

              {/* Auth info */}
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1">
                  <Shield className="h-3 w-3 text-wxops-green" />
                  OIDC via Pinniped
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1">
                  <Server className="h-3 w-3 text-wxops-cyan" />
                  Kubernetes RBAC enforced
                </span>
              </div>

              {/* Groups */}
              <div>
                <p className="text-xs text-muted-foreground mb-2">Group memberships</p>
                <div className="flex flex-wrap gap-2">
                  {groups.length > 0 ? (
                    groups.map((g) => (
                      <Link key={g} href={`/dashboard/catalog/groups/${g}`}>
                        <Badge
                          variant="secondary"
                          className="bg-wxops-purple/10 text-wxops-purple border-wxops-purple/25 hover:bg-wxops-purple/20 transition-colors cursor-pointer text-xs"
                        >
                          {g}
                        </Badge>
                      </Link>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">No groups assigned</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
