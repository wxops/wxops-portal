import { cookies } from "next/headers";
import Link from "next/link";
import {
  ArrowLeft, Mail, Tag, Box, Zap, BookOpen,
  Users, FileText, LayoutGrid, User,
} from "lucide-react";
import type { Entity } from "@/lib/types";
import { EntityNavBar } from "@/components/catalog/entity-nav-bar";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

async function fetchAll(cookie: string): Promise<Entity[]> {
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

function refName(ref: string): string {
  const afterColon = ref.includes(":") ? ref.split(":")[1] : ref;
  return afterColon.includes("/") ? afterColon.split("/").pop()! : afterColon;
}

function avatarGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const g = [
    "from-wxops-purple to-blue-500",
    "from-wxops-green to-wxops-cyan",
    "from-amber-400 to-rose-500",
    "from-wxops-cyan to-wxops-purple",
    "from-rose-400 to-wxops-purple",
    "from-blue-500 to-wxops-green",
  ];
  return g[Math.abs(hash) % g.length];
}

const DOC_TYPE_STYLE: Record<string, { badge: string; label: string }> = {
  rfc:           { badge: "text-violet-700 bg-violet-100 border-violet-200 dark:text-violet-400 dark:bg-violet-900/30 dark:border-violet-800/40", label: "RFC" },
  adr:           { badge: "text-blue-700 bg-blue-100 border-blue-200 dark:text-blue-400 dark:bg-blue-900/30 dark:border-blue-800/40", label: "ADR" },
  documentation: { badge: "text-emerald-700 bg-emerald-100 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-900/30 dark:border-emerald-800/40", label: "Doc" },
};

const DOC_STATUS_STYLE: Record<string, string> = {
  proposed:       "text-amber-600 dark:text-amber-400",
  "under-review": "text-blue-600 dark:text-blue-400",
  accepted:       "text-wxops-green",
  deprecated:     "text-muted-foreground",
  superseded:     "text-orange-500",
};

const LIFECYCLE_STYLE: Record<string, string> = {
  experimental: "text-amber-700 bg-amber-100 border-amber-200 dark:text-amber-400 dark:bg-amber-900/30 dark:border-amber-800/40",
  development:  "text-blue-700 bg-blue-100 border-blue-200 dark:text-blue-400 dark:bg-blue-900/30 dark:border-blue-800/40",
  staging:      "text-violet-700 bg-violet-100 border-violet-200 dark:text-violet-400 dark:bg-violet-900/30 dark:border-violet-800/40",
  production:   "text-green-700 bg-green-100 border-green-200 dark:text-green-400 dark:bg-green-900/30 dark:border-green-800/40",
  deprecated:   "text-red-700 bg-red-100 border-red-200 dark:text-red-400 dark:bg-red-900/30 dark:border-red-800/40",
};

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name }    = await params;
  const cookieStore = await cookies();
  const session     = cookieStore.get("wxops_session")?.value ?? "";

  const entities = await fetchAll(session);
  const user     = entities.find((e) => e.kind === "User" && e.metadata.name === name);

  const memberOfNames = (user?.spec.memberOf ?? []).map(refName);
  const groups = entities.filter(
    (e) => e.kind === "Group" && memberOfNames.includes(e.metadata.name),
  );

  const ownedComponents = entities.filter(
    (e) => e.kind === "Component" && refName(e.spec.owner ?? "") === name,
  );
  const ownedApis = entities.filter(
    (e) => e.kind === "API" && refName(e.spec.owner ?? "") === name,
  );
  const authoredDocs = entities.filter(
    (e) => e.kind === "Doc" && e.spec.author === `user:${name}`,
  );

  const displayName = user?.metadata.title ?? user?.metadata.name ?? name;
  const initials    = displayName
    .split(/[\s._-]+/)
    .map((w: string) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || name.slice(0, 2).toUpperCase();
  const gradient = avatarGradient(name);
  const tags     = user?.metadata.tags ?? [];
  const email    = user?.spec.email as string | undefined;

  if (!user) {
    return (
      <div className="space-y-4 max-w-lg">
        <Link href="/dashboard/catalog" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> Catalog
        </Link>
        <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <User className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold">User not found</p>
            <p className="text-xs text-muted-foreground mt-1">
              <code className="font-mono">@{name}</code> is not registered in the catalog.
            </p>
          </div>
          <Link href="/dashboard/catalog" className="inline-flex items-center gap-1.5 rounded-lg bg-wxops-purple px-4 py-2 text-sm font-medium text-white hover:bg-wxops-purple/90 transition-colors">
            Browse Catalog
          </Link>
        </div>
      </div>
    );
  }

  const hasOwned = ownedComponents.length > 0 || ownedApis.length > 0 || authoredDocs.length > 0;

  return (
    <div className="space-y-4">

      <Link href="/dashboard/catalog" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3.5 w-3.5" /> Catalog
      </Link>

      {/* ── Profile header — horizontal ───────────────────────────────────── */}
      <div className="rounded-xl border bg-card px-6 py-5">
        <div className="flex items-start gap-5">
          {/* Avatar */}
          <div className={`shrink-0 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${gradient} text-xl font-bold text-white shadow-sm`}>
            {initials}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h1 className="text-xl font-bold leading-tight">{displayName}</h1>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  <p className="text-xs font-mono text-muted-foreground">@{name}</p>
                  {email && (
                    <a href={`mailto:${email}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                      <Mail className="h-3 w-3" />{email}
                    </a>
                  )}
                </div>
              </div>
              <EntityNavBar
                kind="User"
                name={name}
                title={displayName}
                description={user.metadata.description ?? ""}
                lifecycle=""
              />
            </div>
            {user.metadata.description && (
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{user.metadata.description}</p>
            )}
            {tags.length > 0 && (
              <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                <Tag className="h-3 w-3 text-muted-foreground shrink-0" />
                {tags.map((t) => (
                  <span key={t} className="rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs font-mono text-muted-foreground">{t}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Two-column body ───────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-[1fr_288px] items-start">

        {/* ── Left: owned content ──────────────────────────────────────────── */}
        <div className="space-y-6">
          {!hasOwned && (
            <div className="rounded-xl border border-dashed px-6 py-10 text-center">
              <LayoutGrid className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                {displayName} doesn&apos;t own any services, APIs, or documents yet.
              </p>
            </div>
          )}

          {ownedComponents.length > 0 && (
            <section className="space-y-3">
              <SectionHeader icon={Box} label="Services" count={ownedComponents.length} />
              <div className="space-y-2">
                {ownedComponents.map((c) => (
                  <EntityRow key={c.metadata.name} entity={c} kind="component" />
                ))}
              </div>
            </section>
          )}

          {ownedApis.length > 0 && (
            <section className="space-y-3">
              <SectionHeader icon={Zap} label="APIs" count={ownedApis.length} />
              <div className="space-y-2">
                {ownedApis.map((a) => (
                  <EntityRow key={a.metadata.name} entity={a} kind="API" />
                ))}
              </div>
            </section>
          )}

          {authoredDocs.length > 0 && (
            <section className="space-y-3">
              <SectionHeader icon={BookOpen} label="Documents" count={authoredDocs.length} />
              <div className="space-y-2">
                {authoredDocs.map((d) => {
                  const docType  = d.spec.docType ?? "documentation";
                  const docStatus = d.spec.docStatus ?? "proposed";
                  const typeConf  = DOC_TYPE_STYLE[docType] ?? DOC_TYPE_STYLE.documentation;
                  return (
                    <Link
                      key={d.metadata.name}
                      href={`/dashboard/catalog/Doc/${d.metadata.name}`}
                      className="flex items-start justify-between gap-3 rounded-xl border bg-card px-4 py-3 hover:bg-muted/30 transition-colors group"
                    >
                      <div className="min-w-0 flex items-start gap-2.5">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate group-hover:text-foreground">
                            {d.metadata.title ?? d.metadata.name}
                          </p>
                          {d.metadata.description && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">{d.metadata.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`text-[10px] font-semibold rounded-full border px-2 py-0.5 ${typeConf.badge}`}>
                          {typeConf.label}
                        </span>
                        <span className={`text-[10px] font-medium ${DOC_STATUS_STYLE[docStatus] ?? "text-muted-foreground"}`}>
                          {docStatus}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {/* ── Right: identity info panel ───────────────────────────────────── */}
        <aside className="sticky top-6">
          <div className="rounded-xl border bg-card divide-y divide-border/60">

            {/* Handle */}
            <div className="px-4 py-3 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <User className="h-3 w-3" /> Identity
              </p>
              <InfoField label="Handle">
                <span className="font-mono text-sm text-foreground">@{name}</span>
              </InfoField>
            </div>

            {/* Groups */}
            {groups.length > 0 && (
              <div className="px-4 py-3 space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <Users className="h-3 w-3" /> Member of
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {groups.map((g) => (
                    <Link
                      key={g.metadata.name}
                      href={`/dashboard/catalog/groups/${g.metadata.name}`}
                      className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-xs font-medium hover:bg-muted hover:text-foreground transition-colors"
                    >
                      {g.metadata.title ?? g.metadata.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Contributions at a glance */}
            {hasOwned && (
              <div className="px-4 py-3 space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Contributions
                </p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <StatCell count={ownedComponents.length} label="services" />
                  <StatCell count={ownedApis.length}       label="APIs" />
                  <StatCell count={authoredDocs.length}    label="docs" />
                </div>
              </div>
            )}

          </div>
        </aside>

      </div>
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon, label, count,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-xs text-muted-foreground tabular-nums">({count})</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function InfoField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] text-muted-foreground/70">{label}</p>
      {children}
    </div>
  );
}

function StatCell({ count, label }: { count: number; label: string }) {
  return (
    <div>
      <p className="text-base font-bold tabular-nums">{count}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function EntityRow({ entity, kind }: { entity: Entity; kind: string }) {
  return (
    <Link
      href={`/dashboard/catalog/${kind}/${entity.metadata.name}`}
      className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 hover:bg-muted/30 transition-colors group"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium truncate group-hover:text-foreground">
          {entity.metadata.title ?? entity.metadata.name}
        </p>
        {entity.metadata.description && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{entity.metadata.description}</p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {entity.spec.type && (
          <span className="text-[10px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">
            {entity.spec.type}
          </span>
        )}
        {entity.spec.lifecycle && (
          <span className={`text-[10px] font-semibold rounded-full border px-2 py-0.5 ${LIFECYCLE_STYLE[entity.spec.lifecycle] ?? "text-muted-foreground bg-muted border-border"}`}>
            {entity.spec.lifecycle}
          </span>
        )}
      </div>
    </Link>
  );
}
