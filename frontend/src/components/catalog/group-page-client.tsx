"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Users, Box, Zap, Database, BookOpen,
  FileText, Network, Tag, Search, ArrowDownUp,
  LayoutGrid, CheckCircle2, Circle, ChevronDown, ChevronUp,
  Copy, Check, Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entity } from "@/lib/types";
import { EntityNavBar } from "@/components/catalog/entity-nav-bar";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GroupPageData {
  group:             Entity;
  members:           Entity[];
  ownedSystems:      Entity[];
  ownedComponents:   Entity[];
  ownedAPIs:         Entity[];
  ownedResources:    Entity[];
  consumedAPIs:      Entity[];
  ownedDocs:         Entity[];
  displayName:       string;
  gradient:          string;
  namespace:         string | null;
  tags:              string[];
}

type Tab = "members" | "services" | "docs";

// ── Style maps ────────────────────────────────────────────────────────────────

const LIFECYCLE_STYLE: Record<string, string> = {
  experimental: "text-amber-700 bg-amber-100 border-amber-200 dark:text-amber-400 dark:bg-amber-900/30 dark:border-amber-800/40",
  development:  "text-blue-700 bg-blue-100 border-blue-200 dark:text-blue-400 dark:bg-blue-900/30 dark:border-blue-800/40",
  staging:      "text-violet-700 bg-violet-100 border-violet-200 dark:text-violet-400 dark:bg-violet-900/30 dark:border-violet-800/40",
  production:   "text-green-700 bg-green-100 border-green-200 dark:text-green-400 dark:bg-green-900/30 dark:border-green-800/40",
  deprecated:   "text-red-700 bg-red-100 border-red-200 dark:text-red-400 dark:bg-red-900/30 dark:border-red-800/40",
};

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function refName(ref: string): string {
  const afterColon = ref.includes(":") ? ref.split(":")[1] : ref;
  return afterColon.includes("/") ? afterColon.split("/").pop()! : afterColon;
}

function memberGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const g = [
    "from-wxops-purple to-wxops-indigo",
    "from-wxops-cyan to-blue-500",
    "from-amber-400 to-rose-400",
    "from-wxops-green to-wxops-cyan",
    "from-rose-400 to-wxops-purple",
    "from-blue-500 to-wxops-purple",
  ];
  return g[Math.abs(hash) % g.length];
}

function memberInitials(e: Entity): string {
  const name = e.metadata.title ?? e.metadata.name;
  return (
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || name.slice(0, 2).toUpperCase()
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

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
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {entity.metadata.description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {entity.spec.type && (
          <span className="text-[10px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">
            {entity.spec.type}
          </span>
        )}
        {entity.spec.lifecycle && (
          <span className={cn(
            "text-[10px] font-semibold rounded-full border px-2 py-0.5",
            LIFECYCLE_STYLE[entity.spec.lifecycle] ?? "text-muted-foreground bg-muted border-border",
          )}>
            {entity.spec.lifecycle}
          </span>
        )}
      </div>
    </Link>
  );
}

// ── Tab content ───────────────────────────────────────────────────────────────

function MembersTab({ members }: { members: Entity[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      const name  = (m.metadata.title ?? m.metadata.name).toLowerCase();
      const handle = m.metadata.name.toLowerCase();
      return name.includes(q) || handle.includes(q);
    });
  }, [members, query]);

  if (members.length === 0) {
    return (
      <EmptyState icon={Users} message="No members registered for this group." />
    );
  }

  return (
    <div className="space-y-4">
      {/* Search — only shown when there's something to filter */}
      {members.length > 6 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            placeholder={`Filter ${members.length} members…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-lg border border-border bg-muted/30 py-2 pl-9 pr-4 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-wxops-purple/40"
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No members match &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((u) => {
            const dispName = u.metadata.title ?? u.metadata.name;
            const grad     = memberGradient(u.metadata.name);
            const inits    = memberInitials(u);
            return (
              <Link
                key={u.metadata.name}
                href={`/dashboard/catalog/users/${u.metadata.name}`}
                className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 hover:bg-muted/30 transition-colors group"
              >
                <div className={cn(
                  "h-9 w-9 shrink-0 flex items-center justify-center rounded-full",
                  "bg-gradient-to-br text-sm font-bold text-white",
                  grad,
                )}>
                  {inits}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate group-hover:text-foreground">{dispName}</p>
                  <p className="text-xs font-mono text-muted-foreground">@{u.metadata.name}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ServicesTab({
  ownedSystems,
  ownedComponents,
  ownedAPIs,
  ownedResources,
  consumedAPIs,
}: Pick<GroupPageData, "ownedSystems" | "ownedComponents" | "ownedAPIs" | "ownedResources" | "consumedAPIs">) {
  const totalOwned = ownedSystems.length + ownedComponents.length + ownedAPIs.length + ownedResources.length;

  if (totalOwned === 0 && consumedAPIs.length === 0) {
    return <EmptyState icon={Box} message="This group hasn't registered any owned services yet." />;
  }

  return (
    <div className="space-y-6">
      {/* Systems */}
      {ownedSystems.length > 0 && (
        <section className="space-y-3">
          <SectionHeader icon={Network} label="Systems" count={ownedSystems.length} />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ownedSystems.map((s) => (
              <Link
                key={s.metadata.name}
                href={`/dashboard/catalog/systems/${s.metadata.name}`}
                className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 hover:bg-muted/30 transition-colors group"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-wxops-purple/30 bg-wxops-purple/10">
                  <Network className="h-4 w-4 text-wxops-purple" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate group-hover:text-foreground">
                    {s.metadata.title ?? s.metadata.name}
                  </p>
                  {s.metadata.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{s.metadata.description}</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Services + APIs side by side */}
      {(ownedComponents.length > 0 || ownedAPIs.length > 0 || ownedResources.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
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

          <div className="space-y-6">
            {ownedAPIs.length > 0 && (
              <section className="space-y-3">
                <SectionHeader icon={Zap} label="APIs" count={ownedAPIs.length} />
                <div className="space-y-2">
                  {ownedAPIs.map((a) => (
                    <EntityRow key={a.metadata.name} entity={a} kind="API" />
                  ))}
                </div>
              </section>
            )}

            {ownedResources.length > 0 && (
              <section className="space-y-3">
                <SectionHeader icon={Database} label="Resources" count={ownedResources.length} />
                <div className="space-y-2">
                  {ownedResources.map((r) => (
                    <EntityRow key={r.metadata.name} entity={r} kind="Resource" />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      {/* External dependencies */}
      {consumedAPIs.length > 0 && (
        <section className="space-y-3">
          <SectionHeader icon={ArrowDownUp} label="External Dependencies" count={consumedAPIs.length} />
          <div className="rounded-xl border border-dashed divide-y divide-border/60">
            {consumedAPIs.map((a) => {
              const owner = a.spec.owner ? refName(a.spec.owner) : null;
              return (
                <Link
                  key={a.metadata.name}
                  href={`/dashboard/catalog/API/${a.metadata.name}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/20 transition-colors group first:rounded-t-xl last:rounded-b-xl"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Zap className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate group-hover:text-foreground">
                        {a.metadata.title ?? a.metadata.name}
                      </p>
                      {a.metadata.description && (
                        <p className="text-xs text-muted-foreground truncate">{a.metadata.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {owner && (
                      <span className="text-[10px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">
                        {owner}
                      </span>
                    )}
                    {a.spec.type && (
                      <span className="text-[10px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">
                        {a.spec.type}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function DocsTab({ ownedDocs }: { ownedDocs: Entity[] }) {
  if (ownedDocs.length === 0) {
    return <EmptyState icon={BookOpen} message="No documents registered for this group." />;
  }

  return (
    <div className="space-y-2">
      {ownedDocs.map((d) => {
        const docType   = d.spec.docType ?? "documentation";
        const docStatus = d.spec.docStatus ?? "proposed";
        const typeConf  = DOC_TYPE_STYLE[docType] ?? DOC_TYPE_STYLE.documentation;
        const author    = d.spec.author ? refName(d.spec.author) : null;
        return (
          <Link
            key={d.metadata.name}
            href={`/dashboard/catalog/Doc/${d.metadata.name}`}
            className="flex items-start justify-between gap-3 rounded-xl border bg-card px-4 py-3 hover:bg-muted/30 transition-colors group"
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate group-hover:text-foreground">
                  {d.metadata.title ?? d.metadata.name}
                </p>
                {d.metadata.description && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{d.metadata.description}</p>
                )}
                {author && (
                  <p className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">@{author}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className={cn("text-[10px] font-semibold rounded-full border px-2 py-0.5", typeConf.badge)}>
                {typeConf.label}
              </span>
              <span className={cn("text-[10px] font-medium", DOC_STATUS_STYLE[docStatus] ?? "text-muted-foreground")}>
                {docStatus}
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function EmptyState({ icon: Icon, message }: { icon: React.ComponentType<{ className?: string }>; message: string }) {
  return (
    <div className="rounded-xl border border-dashed px-6 py-12 text-center">
      <Icon className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

// ── Team health checklist ─────────────────────────────────────────────────────

interface CheckItem {
  label:   string;
  hint:    string;
  done:    boolean;
}

function TeamHealthChecklist({ items }: { items: CheckItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const done  = items.filter((i) => i.done).length;
  const total = items.length;
  const allDone = done === total;

  if (allDone) return null; // disappears once team is fully onboarded

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold">Team Onboarding</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {done}/{total} complete
          </span>
          {/* Progress bar */}
          <div className="hidden sm:flex h-1.5 w-24 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-wxops-purple transition-all"
              style={{ width: `${(done / total) * 100}%` }}
            />
          </div>
        </div>
        {expanded
          ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        }
      </button>

      {expanded && (
        <div className="border-t divide-y divide-border/60">
          {items.map((item) => (
            <div key={item.label} className="flex items-start gap-3 px-4 py-2.5">
              {item.done
                ? <CheckCircle2 className="h-4 w-4 text-wxops-green shrink-0 mt-0.5" />
                : <Circle       className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5" />
              }
              <div className="min-w-0">
                <p className={cn(
                  "text-sm",
                  item.done ? "text-muted-foreground line-through" : "text-foreground font-medium",
                )}>
                  {item.label}
                </p>
                {!item.done && (
                  <p className="text-xs text-muted-foreground mt-0.5">{item.hint}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main client component ─────────────────────────────────────────────────────

export function GroupPageClient(data: GroupPageData) {
  const {
    group, members, ownedSystems, ownedComponents,
    ownedAPIs, ownedResources, consumedAPIs, ownedDocs,
    displayName, gradient, namespace, tags,
  } = data;

  const [activeTab, setActiveTab] = useState<Tab>("members");
  const [copiedRbac, setCopiedRbac] = useState(false);

  const parentName   = namespace?.slice("tenant-".length) ?? null;
  const rbacSubject  = parentName ? `${parentName}:${group.metadata.name}` : null;

  function copyRbac() {
    if (!rbacSubject) return;
    navigator.clipboard.writeText(rbacSubject).then(() => {
      setCopiedRbac(true);
      setTimeout(() => setCopiedRbac(false), 1500);
    });
  }

  // ── Checklist ───────────────────────────────────────────────────────────────
  const hasDevOrAbove  = ownedComponents.some((c) =>
    c.spec.lifecycle && c.spec.lifecycle !== "experimental",
  );
  const hasStagingOrAbove = ownedComponents.some((c) =>
    c.spec.lifecycle === "staging" || c.spec.lifecycle === "production",
  );
  const hasRunbook = ownedDocs.some((d) => d.spec.docType === "runbook");
  const hasADR     = ownedDocs.some((d) => d.spec.docType === "adr");

  const checklistItems: CheckItem[] = [
    {
      label: "Add team members",
      hint:  "Add members via the catalog Group entity so the portal knows who's on this team.",
      done:  members.length > 0,
    },
    {
      label: "Scaffold a service",
      hint:  "Use the scaffold wizard to create your first golden-path service.",
      done:  ownedComponents.length > 0,
    },
    {
      label: "Deploy to development",
      hint:  "Promote a service from experimental → development by creating the first overlay PR.",
      done:  hasDevOrAbove,
    },
    {
      label: "Document an API",
      hint:  "Register an API entity so consumers can discover and use your service contract.",
      done:  ownedAPIs.length > 0,
    },
    {
      label: "Reach staging",
      hint:  "Promote a service to staging — requires a team manager or platform-team approval.",
      done:  hasStagingOrAbove,
    },
    {
      label: "Write a runbook",
      hint:  "Create a runbook Doc entity so on-call engineers know what to do when things go wrong.",
      done:  hasRunbook,
    },
    {
      label: "Write an ADR",
      hint:  "Document key architecture decisions so the team's reasoning is preserved over time.",
      done:  hasADR,
    },
  ];

  const totalServices =
    ownedSystems.length + ownedComponents.length + ownedAPIs.length + ownedResources.length + consumedAPIs.length;

  const tabs: { id: Tab; label: string; count: number; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "members",  label: "Members",  count: members.length,  icon: Users },
    { id: "services", label: "Services", count: totalServices,   icon: Box },
    { id: "docs",     label: "Docs",     count: ownedDocs.length, icon: BookOpen },
  ];

  return (
    <div className="space-y-4">

      {/* ── Team identity header — horizontal ────────────────────────────── */}
      <div className="rounded-xl border bg-card px-6 py-5">
        <div className="flex items-start gap-5">
          {/* Team icon */}
          <div
            className={`shrink-0 flex items-center justify-center rounded-2xl bg-gradient-to-br ${gradient} shadow-sm`}
            style={{ height: "4rem", width: "4rem" }}
          >
            <Users className="h-7 w-7 text-white" />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold leading-tight">{displayName}</h1>
                  {group.spec.type && (
                    <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs font-mono text-muted-foreground">
                      {group.spec.type}
                    </span>
                  )}
                </div>
                <p className="text-xs font-mono text-muted-foreground mt-0.5">@{group.metadata.name}</p>
              </div>
              <EntityNavBar
                kind={group.kind}
                name={group.metadata.name}
                title={displayName}
                description={group.metadata.description ?? ""}
                lifecycle=""
              />
            </div>
            {group.metadata.description && (
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{group.metadata.description}</p>
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

        {/* ── Left: checklist + tabs ──────────────────────────────────────── */}
        <div className="space-y-4">
          <TeamHealthChecklist items={checklistItems} />

          {/* Tab bar */}
          <div className="flex items-center gap-1 rounded-xl border bg-card p-1">
            {tabs.map(({ id, label, count, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  activeTab === id
                    ? "bg-wxops-purple/10 text-wxops-purple shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{label}</span>
                <span className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums font-semibold",
                  activeTab === id
                    ? "bg-wxops-purple/15 text-wxops-purple"
                    : "bg-muted text-muted-foreground",
                )}>
                  {count}
                </span>
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === "members" && <MembersTab members={members} />}
          {activeTab === "services" && (
            <ServicesTab
              ownedSystems={ownedSystems}
              ownedComponents={ownedComponents}
              ownedAPIs={ownedAPIs}
              ownedResources={ownedResources}
              consumedAPIs={consumedAPIs}
            />
          )}
          {activeTab === "docs" && <DocsTab ownedDocs={ownedDocs} />}

          {members.length === 0 && totalServices === 0 && ownedDocs.length === 0 && (
            <EmptyState icon={LayoutGrid} message="This group has no members, owned entities, or documents yet." />
          )}
        </div>

        {/* ── Right: org identity panel (sticky) ──────────────────────────── */}
        <aside className="sticky top-6 space-y-4">
          <div className="rounded-xl border bg-card divide-y divide-border/60">

            {/* Org Identity */}
            <div className="px-4 py-3 space-y-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <Building2 className="h-3 w-3" /> Org Identity
              </p>

              <InfoField label="Handle">
                <span className="font-mono text-sm text-foreground">@{group.metadata.name}</span>
              </InfoField>

              {group.spec.type && (
                <InfoField label="Type">
                  <span className="inline-block rounded-md border border-border bg-muted/50 px-2 py-0.5 font-mono text-xs text-muted-foreground">
                    {group.spec.type}
                  </span>
                </InfoField>
              )}

              {namespace && (
                <InfoField label="Namespace">
                  <code className="rounded-md border border-wxops-cyan/30 bg-wxops-cyan/5 px-2 py-0.5 text-xs font-mono text-wxops-cyan">
                    {namespace}
                  </code>
                </InfoField>
              )}

              {rbacSubject && (
                <InfoField label="RBAC Subject">
                  <div className="flex items-center gap-1.5">
                    <code className="flex-1 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs font-mono text-foreground break-all">
                      {rbacSubject}
                    </code>
                    <button
                      type="button"
                      onClick={copyRbac}
                      title="Copy RBAC subject"
                      className={cn(
                        "shrink-0 flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
                        copiedRbac
                          ? "border-wxops-green/40 bg-wxops-green/10 text-wxops-green"
                          : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50",
                      )}
                    >
                      {copiedRbac
                        ? <Check className="h-3.5 w-3.5" />
                        : <Copy  className="h-3.5 w-3.5" />
                      }
                    </button>
                  </div>
                </InfoField>
              )}
            </div>

            {/* Parent org */}
            {parentName && (
              <div className="px-4 py-3 space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <Network className="h-3 w-3" /> Parent Org
                </p>
                <span className="font-mono text-sm text-foreground">{parentName}</span>
              </div>
            )}

            {/* Stats */}
            <div className="px-4 py-3 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                At a Glance
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <button
                  type="button"
                  onClick={() => setActiveTab("members")}
                  className="rounded-lg border border-border/50 bg-muted/20 py-2 hover:bg-muted/50 transition-colors"
                >
                  <p className="text-base font-bold tabular-nums">{members.length}</p>
                  <p className="text-[10px] text-muted-foreground">members</p>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("services")}
                  className="rounded-lg border border-border/50 bg-muted/20 py-2 hover:bg-muted/50 transition-colors"
                >
                  <p className="text-base font-bold tabular-nums">{totalServices}</p>
                  <p className="text-[10px] text-muted-foreground">services</p>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("docs")}
                  className="rounded-lg border border-border/50 bg-muted/20 py-2 hover:bg-muted/50 transition-colors"
                >
                  <p className="text-base font-bold tabular-nums">{ownedDocs.length}</p>
                  <p className="text-[10px] text-muted-foreground">docs</p>
                </button>
              </div>
            </div>

          </div>
        </aside>

      </div>
    </div>
  );
}

// ── InfoField helper (right panel) ────────────────────────────────────────────

function InfoField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] text-muted-foreground/70">{label}</p>
      {children}
    </div>
  );
}
