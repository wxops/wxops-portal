import { cookies } from "next/headers";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { CountUpNumber } from "@/components/ui/count-up-number";
import {
  Server,
  Users,
  BookOpen,
  FileText,
  Layers,
  ArrowRight,
  Shield,
  Rocket,
  Activity,
  Lightbulb,
  Terminal,
  Download,
  ExternalLink,
} from "lucide-react";
import { PermissionsModal } from "@/components/dashboard/permissions-modal";

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

function groupMemberships(groups: string[]): { org: string; teams: string[] }[] {
  const map = new Map<string, string[]>();
  for (const g of groups) {
    const idx = g.indexOf(":");
    if (idx === -1) {
      if (!map.has(g)) map.set(g, []);
    } else {
      const org = g.slice(0, idx);
      const team = g.slice(idx + 1);
      if (!map.has(org)) map.set(org, []);
      map.get(org)!.push(team);
    }
  }
  return Array.from(map.entries()).map(([org, teams]) => ({ org, teams }));
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

async function fetchCLIVersion(cookie: string): Promise<string> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/cli/version`, {
      headers: { Cookie: `wxops_session=${cookie}` },
      cache: "no-store",
    });
    if (!res.ok) return "unknown";
    const data = await res.json();
    return data.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export default async function DashboardPage() {
  const session     = await requireSession();
  const cookieStore = await cookies();
  const rawCookie   = cookieStore.get("wxops_session")?.value ?? "";

  const groups        = session.groups ?? [];
  const isPlatformTeam = groups.includes(PLATFORM_TEAM);

  const [catalog, clusterCount, cliVersion] = await Promise.all([
    fetchCatalogStats(rawCookie, groups, isPlatformTeam),
    fetchClusterCount(rawCookie),
    fetchCLIVersion(rawCookie),
  ]);

  const statCards = [
    {
      label:       "Services",
      value:       catalog.services,
      sub:         `across ${catalog.systems} system${catalog.systems !== 1 ? "s" : ""}`,
      icon:        Layers,
      color:       "text-wxops-purple",
      bg:          "bg-wxops-purple/10",
      href:        "/dashboard/catalog?kind=Component",
      glowClass:   "hover-glow-purple",
      hoverBorder: "group-hover:border-wxops-purple/40",
    },
    {
      label:       "Teams",
      value:       catalog.teams,
      sub:         "in catalog",
      icon:        Users,
      color:       "text-wxops-cyan",
      bg:          "bg-wxops-cyan/10",
      href:        "/dashboard/catalog?kind=Group",
      glowClass:   "hover-glow-cyan",
      hoverBorder: "group-hover:border-wxops-cyan/40",
    },
    {
      label:       "Documents",
      value:       catalog.docs,
      sub:         "RFCs, ADRs & runbooks",
      icon:        FileText,
      color:       "text-wxops-green",
      bg:          "bg-wxops-green/10",
      href:        "/dashboard/catalog?kind=Doc",
      glowClass:   "hover-glow-green",
      hoverBorder: "group-hover:border-wxops-green/40",
    },
    {
      label:       "Clusters",
      value:       clusterCount,
      sub:         "Kubernetes",
      icon:        Server,
      color:       "text-wxops-indigo",
      bg:          "bg-wxops-indigo/10",
      href:        "/dashboard/clusters",
      glowClass:   "hover-glow-indigo",
      hoverBorder: "group-hover:border-wxops-indigo/40",
    },
  ];

  const quickActions = [
    {
      step:        "01",
      href:        "/dashboard/scaffold",
      icon:        Rocket,
      iconColor:   "text-wxops-purple",
      iconBg:      "bg-wxops-purple/10",
      title:       "Scaffold a service",
      description: "Generate a production-ready service with GitOps, CI/CD, and secrets pre-wired — zero boilerplate.",
      glowClass:   "hover-glow-purple",
      hoverBorder: "group-hover:border-wxops-purple/40",
    },
    {
      step:        "02",
      href:        "/dashboard/catalog",
      icon:        BookOpen,
      iconColor:   "text-wxops-cyan",
      iconBg:      "bg-wxops-cyan/10",
      title:       "Browse the catalog",
      description: "Discover every service, team, API, and architectural decision document owned across the platform.",
      glowClass:   "hover-glow-cyan",
      hoverBorder: "group-hover:border-wxops-cyan/40",
    },
    {
      step:        "03",
      href:        "/dashboard/clusters",
      icon:        Server,
      iconColor:   "text-wxops-green",
      iconBg:      "bg-wxops-green/10",
      title:       "Inspect clusters",
      description: "Check pod health, deployments, and resource status across your Kubernetes clusters in real time.",
      glowClass:   "hover-glow-green",
      hoverBorder: "group-hover:border-wxops-green/40",
    },
    {
      step:        "04",
      href:        "/dashboard/activity",
      icon:        Activity,
      iconColor:   "text-wxops-indigo",
      iconBg:      "bg-wxops-indigo/10",
      title:       "Track activity",
      description: "Follow recent PRs, lifecycle promotions, and platform events from your team.",
      glowClass:   "hover-glow-indigo",
      hoverBorder: "group-hover:border-wxops-indigo/40",
    },
  ];

  return (
    <div className="hero-glow grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-10 items-start">

      {/* ══ Left column — hero, stats, quick start ═══════════════════ */}
      <div className="space-y-10 min-w-0">

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div className="space-y-4 pt-2">
        {/* Platform status pill */}
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-wxops-green/30 bg-wxops-green/10 px-3 py-1 text-xs font-medium text-wxops-green">
            <span className="h-1.5 w-1.5 rounded-full bg-wxops-green animate-status" />
            Platform online
          </span>
        </div>

        <h1 className="text-5xl font-bold tracking-tight leading-tight sm:text-6xl">
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
            <div className={cn(
              "rounded-xl border bg-card p-5 h-full transition-all duration-200",
              s.hoverBorder,
              s.glowClass,
            )}>
              <div className={cn("inline-flex rounded-lg p-2 mb-4", s.bg)}>
                <s.icon className={cn("h-5 w-5", s.color)} />
              </div>
              <p className="text-3xl font-bold tracking-tight tabular-nums">
                <CountUpNumber value={s.value} />
              </p>
              <p className="text-sm font-medium mt-0.5">{s.label}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.sub}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* ── Quick start ──────────────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          Quick start
        </h2>

        {/* Golden path callout */}
        <div className="flex items-start gap-3 rounded-xl border border-wxops-purple/25 bg-wxops-purple/5 px-4 py-3.5">
          <Lightbulb className="h-4 w-4 text-wxops-purple shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <p className="text-sm font-medium">How the platform works</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="text-wxops-purple font-medium">Scaffold</span> a service
              {" → "}
              <span className="text-wxops-cyan font-medium">GitOps PR</span> auto-opens
              {" → "}
              <span className="text-wxops-green font-medium">dev cluster</span> deploys automatically
              {" → "}
              <span className="text-wxops-indigo font-medium">promote</span> to staging then production.
              The portal manages the PRs; ArgoCD handles the sync.
            </p>
          </div>
        </div>

        {/* Action tiles */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {quickActions.map((a) => (
            <Link key={a.href} href={a.href} className="group block">
              <div className={cn(
                "rounded-xl border bg-card p-5 h-full transition-all duration-200",
                a.hoverBorder,
                a.glowClass,
              )}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-mono font-bold text-muted-foreground/40 tracking-widest">
                    {a.step}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                </div>
                <div className={cn("inline-flex rounded-lg p-2 mb-3", a.iconBg)}>
                  <a.icon className={cn("h-4 w-4", a.iconColor)} />
                </div>
                <p className="text-sm font-semibold mb-1.5">{a.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{a.description}</p>
              </div>
            </Link>
          ))}
        </div>

        {/* Platform Docs guide-book */}
        <a
          href="https://docs.wxops.cloud"
          target="_blank"
          rel="noopener noreferrer"
          className="group block"
        >
          <div className="rounded-xl border bg-card px-5 py-4 flex items-center gap-4 transition-all duration-200 hover:border-wxops-purple/40 hover-glow-purple">
            <div className="inline-flex rounded-lg p-2.5 bg-wxops-purple/10 shrink-0">
              <BookOpen className="h-5 w-5 text-wxops-purple" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug">Platform Docs</p>
              <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                Architecture, CLI reference, golden-path guides, and Darlane walkthroughs.
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-wxops-purple shrink-0 transition-all duration-200 group-hover:gap-1.5">
              Read the docs <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </a>
      </div>

      </div>{/* ← end left column */}

      {/* ══ Right column — identity panel (sticky) ═══════════════════ */}
      <div className="lg:sticky lg:top-6 space-y-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          Your Identity
        </h2>

        <div className="rounded-xl border bg-card overflow-hidden">

          {/* Gradient banner */}
          <div className="bg-gradient-to-br from-wxops-purple/25 via-wxops-cyan/8 to-transparent h-24 relative">
            {/* subtle inner glow */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_80%,oklch(0.606_0.259_293/18%)_0%,transparent_70%)]" />
          </div>

          {/* Floating avatar — sits on the banner/body boundary */}
          <div className="flex justify-center -mt-9 relative z-10 mb-3">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-wxops-purple/30 blur-lg scale-110" />
              <div className="relative h-[4.5rem] w-[4.5rem] flex items-center justify-center rounded-full bg-gradient-to-br from-wxops-purple to-wxops-indigo text-2xl font-bold text-white ring-[3px] ring-card">
                {session.username.slice(0, 2).toUpperCase()}
              </div>
            </div>
          </div>

          {/* Identity content */}
          <div className="px-5 pb-5 space-y-4">

            {/* Name + sub */}
            <div className="text-center">
              <p className="font-semibold text-base leading-snug">{session.username}</p>
              <p className="text-[11px] font-mono text-muted-foreground truncate mt-0.5">
                {session.sub}
              </p>
            </div>

            {/* Auth pills */}
            <div className="flex flex-col gap-1.5">
              <span className="inline-flex items-center gap-2 rounded-lg border border-wxops-green/20 bg-wxops-green/5 px-3 py-1.5 text-xs text-muted-foreground">
                <Shield className="h-3 w-3 text-wxops-green shrink-0" />
                OIDC via Pinniped
              </span>
              <span className="inline-flex items-center gap-2 rounded-lg border border-wxops-cyan/20 bg-wxops-cyan/5 px-3 py-1.5 text-xs text-muted-foreground">
                <Server className="h-3 w-3 text-wxops-cyan shrink-0" />
                Kubernetes RBAC enforced
              </span>
            </div>

            <div className="border-t" />

            {/* Groups */}
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider mb-2">
                Team (Tenant) Membership
              </p>
              {groups.length > 0 ? (
                <div className="rounded-lg border border-border/60 overflow-hidden">
                  {groupMemberships(groups).map(({ org, teams }, i) => (
                    <div
                      key={org}
                      className={cn(
                        "flex items-start gap-0 transition-colors hover:bg-muted/25",
                        i > 0 && "border-t border-border/50",
                      )}
                    >
                      {/* Org accent bar */}
                      <span className="w-0.5 self-stretch bg-wxops-indigo/40 shrink-0" />

                      <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2 min-w-0">
                        <Link
                          href={`/dashboard/catalog/groups/${org}`}
                          className="text-[10px] font-mono font-semibold text-muted-foreground/50 hover:text-wxops-indigo hover:underline leading-none shrink-0 transition-colors"
                        >
                          {org}
                        </Link>
                        {teams.length > 0 && (
                          <>
                            <span className="text-border/60 text-[10px] leading-none shrink-0 select-none">/</span>
                            {teams.map((t) => (
                              <Link key={t} href={`/dashboard/catalog/groups/${org}:${t}`}>
                                <Badge
                                  variant="secondary"
                                  className="bg-wxops-purple/10 text-wxops-purple border-wxops-purple/20 hover:bg-wxops-purple/20 transition-colors cursor-pointer text-[10px] font-medium px-1.5 py-0 h-[18px] leading-none"
                                >
                                  {t}
                                </Badge>
                              </Link>
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No groups assigned</p>
              )}
            </div>

            {/* Permissions button */}
            <PermissionsModal groups={groups} username={session.username} />
          </div>
        </div>

        {/* ── CLI download card ─────────────────────────────────── */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b bg-wxops-indigo/[0.04]">
            <div className="inline-flex rounded-md p-1.5 bg-wxops-indigo/10 shrink-0">
              <Terminal className="h-3.5 w-3.5 text-wxops-indigo" />
            </div>
            <span className="text-xs font-semibold flex-1">wxops CLI</span>
            <span className="text-[10px] font-mono font-semibold text-wxops-indigo bg-wxops-indigo/10 border border-wxops-indigo/20 rounded-full px-1.5 py-0.5">
              {cliVersion}
            </span>
            <a
              href="https://docs.wxops.cloud/docs/cli/overview"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-wxops-indigo transition-colors"
            >
              Docs <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>

          <div className="px-4 py-3 space-y-2">
            {[
              { label: "Linux",  os: "linux",  arch: "amd64", platform: "linux-amd64" },
              { label: "Linux",  os: "linux",  arch: "arm64", platform: "linux-arm64" },
              { label: "macOS",  os: "darwin", arch: "arm64", platform: "darwin-arm64" },
              { label: "macOS",  os: "darwin", arch: "amd64", platform: "darwin-amd64" },
            ].map((p) => (
              <a
                key={p.platform}
                href={`/api/v1/cli/download/${p.platform}`}
                className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs transition-colors hover:bg-muted/50 hover:border-wxops-indigo/30"
              >
                <Download className="h-3 w-3 text-wxops-indigo shrink-0" />
                <span className="font-medium">{p.label}</span>
                <span className="ml-auto font-mono text-muted-foreground">{p.arch}</span>
              </a>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
}
