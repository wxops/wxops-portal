"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  ShieldCheck,
  X,
  Check,
  Minus,
  BookOpen,
  GitPullRequest,
  Bug,
  Rocket,
  Server,
  Terminal,
  Users,
  MessageSquare,
  Lock,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type CellValue = boolean | string; // string = allowed with a caveat label

interface PermRow {
  action: string;
  dev: CellValue;
  manager: CellValue;
  platform: CellValue;
}

interface PermSection {
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  rows: PermRow[];
}

// ── Permission data ───────────────────────────────────────────────────────────

const SECTIONS: PermSection[] = [
  {
    title: "Service Catalog",
    Icon: BookOpen,
    rows: [
      { action: "Browse catalog & view entity details",      dev: true,            manager: true,        platform: true  },
      { action: "Register & edit entities",                  dev: "own team",      manager: true,        platform: true  },
      { action: "Delete entities",                           dev: false,           manager: false,       platform: true  },
      { action: "Update Vault secrets",                      dev: "own team",      manager: true,        platform: true  },
      { action: "Edit XTenantApp config via PR",             dev: "own team",      manager: true,        platform: true  },
      { action: "Import repo into catalog",                  dev: "own team",      manager: true,        platform: true  },
      { action: "View activity feed",                        dev: "own PRs",       manager: "own PRs",   platform: true  },
    ],
  },
  {
    title: "Lifecycle & Merge Requests",
    Icon: GitPullRequest,
    rows: [
      { action: "Create dev overlay PR",                     dev: true,            manager: true,        platform: true  },
      { action: "Confirm dev lifecycle",                     dev: true,            manager: true,        platform: true  },
      { action: "Create staging overlay PR",                 dev: false,           manager: true,        platform: true  },
      { action: "Confirm staging lifecycle",                 dev: false,           manager: true,        platform: true  },
      { action: "Create production overlay PR",              dev: false,           manager: true,        platform: true  },
      { action: "Confirm production lifecycle",              dev: false,           manager: true,        platform: true  },
      { action: "Deprecate entity (opens removal PR)",       dev: false,           manager: true,        platform: true  },
    ],
  },
  {
    title: "Darlane Debug Pods",
    Icon: Bug,
    rows: [
      { action: "Enable Darlane on dev (direct commit)",     dev: "own team",      manager: true,        platform: true  },
      { action: "Enable Darlane on staging / prod (PR)",     dev: false,           manager: true,        platform: true  },
      { action: "darlane sync",                              dev: true,            manager: true,        platform: true  },
      { action: "darlane exec / port-forward",               dev: true,            manager: true,        platform: true  },
    ],
  },
  {
    title: "Golden-Path Scaffolding",
    Icon: Rocket,
    rows: [
      { action: "Scaffold a new service",                    dev: "own team",      manager: true,        platform: true  },
      { action: "Scaffold for another team",                 dev: false,           manager: false,       platform: true  },
    ],
  },
  {
    title: "Kubernetes Cluster Views",
    Icon: Server,
    rows: [
      { action: "View own namespace (pods, deployments)",    dev: true,            manager: true,        platform: true  },
      { action: "View all namespaces",                       dev: false,           manager: false,       platform: true  },
      { action: "Download kubeconfig",                       dev: true,            manager: true,        platform: true  },
      { action: "Write to cluster (scale, apply, delete)",   dev: false,           manager: false,       platform: false },
    ],
  },
  {
    title: "CLI (wxops)",
    Icon: Terminal,
    rows: [
      { action: "catalog list / get",                        dev: true,            manager: true,        platform: true  },
      { action: "debug (read-only)",                         dev: true,            manager: true,        platform: true  },
      { action: "darlane sync (own team pod)",               dev: "own team pod",  manager: true,        platform: true  },
    ],
  },
];

// ── Role derivation ───────────────────────────────────────────────────────────

type Role = "platform" | "manager" | "developer";

function deriveRole(groups: string[]): Role {
  if (groups.includes("platform-team")) return "platform";
  if (groups.some((g) => g.includes(":") && g.split(":")[1] === "Managers")) return "manager";
  return "developer";
}

const ROLE_META: Record<
  Role,
  { label: string; color: string; border: string; bg: string; headerBg: string; cellBg: string; dot: string }
> = {
  platform: {
    label:     "Platform Team",
    color:     "text-wxops-green",
    border:    "border-wxops-green/40",
    bg:        "bg-wxops-green/10",
    headerBg:  "bg-wxops-green/20",
    cellBg:    "bg-wxops-green/8",
    dot:       "bg-wxops-green",
  },
  manager: {
    label:     "Manager",
    color:     "text-wxops-cyan",
    border:    "border-wxops-cyan/40",
    bg:        "bg-wxops-cyan/10",
    headerBg:  "bg-wxops-cyan/20",
    cellBg:    "bg-wxops-cyan/8",
    dot:       "bg-wxops-cyan",
  },
  developer: {
    label:     "Developer",
    color:     "text-wxops-purple",
    border:    "border-wxops-purple/40",
    bg:        "bg-wxops-purple/10",
    headerBg:  "bg-wxops-purple/20",
    cellBg:    "bg-wxops-purple/8",
    dot:       "bg-wxops-purple",
  },
};

// ── Main component ────────────────────────────────────────────────────────────

interface PermissionsModalProps {
  groups: string[];
  username: string;
}

export function PermissionsModal({ groups, username }: PermissionsModalProps) {
  const [open, setOpen] = useState(false);
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  const role = deriveRole(groups);
  const meta = ROLE_META[role];

  const grantingGroups =
    role === "platform"
      ? groups.filter((g) => g === "platform-team")
      : role === "manager"
      ? groups.filter((g) => g.includes(":") && g.split(":")[1] === "Managers")
      : groups.filter((g) => g !== "platform-team" && (!g.includes(":") || g.split(":")[1] !== "Managers"));

  const orgs = [...new Set(
    groups
      .filter((g) => g.includes(":") && g.split(":")[1] !== "Managers")
      .map((g) => g.split(":")[0])
  )];

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // PermRow uses "dev" but Role uses "developer"
  const rowKey: Record<Role, keyof Omit<PermRow, "action">> = {
    developer: "dev",
    manager:   "manager",
    platform:  "platform",
  };

  const COLS: { key: Role; label: string }[] = [
    { key: "developer", label: "Dev" },
    { key: "manager",   label: "Manager" },
    { key: "platform",  label: "Platform" },
  ];

  // Count total allowed actions for the user's role
  const totalAllowed = SECTIONS.flatMap((s) => s.rows).filter((r) => r[rowKey[role]] !== false).length;
  const totalActions = SECTIONS.flatMap((s) => s.rows).length;

  return (
    <>
      {/* ── Trigger ──────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "w-full flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
          meta.border, meta.bg, meta.color,
          "hover:opacity-80"
        )}
      >
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
        What can I do?
      </button>

      {/* ── Modal ────────────────────────────────────────────────────────── */}
      {mounted && open && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          {/* Panel — wide two-column layout */}
          <div className="relative z-10 flex flex-col w-full max-w-5xl max-h-[92vh] rounded-2xl border bg-card shadow-2xl overflow-hidden">

            {/* ── Top bar ───────────────────────────────────────────────── */}
            <div className="shrink-0 flex items-center gap-3 px-6 py-4 border-b">
              <div className={cn("inline-flex rounded-xl p-2 shrink-0", meta.bg)}>
                <ShieldCheck className={cn("h-5 w-5", meta.color)} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold leading-none">My Permissions</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Access matrix for <span className="font-mono">{username}</span>
                </p>
              </div>
              <div className={cn(
                "hidden sm:flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold shrink-0",
                meta.bg, meta.border, meta.color
              )}>
                <span className={cn("h-2 w-2 rounded-full shrink-0", meta.dot)} />
                {meta.label}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* ── Body: left sidebar + right table ──────────────────────── */}
            <div className="flex flex-1 min-h-0 divide-x divide-border">

              {/* ── Left sidebar ────────────────────────────────────────── */}
              <div className="hidden md:flex flex-col w-64 shrink-0 overflow-y-auto">

                {/* Role card */}
                <div className={cn("p-5 border-b", meta.bg)}>
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Your role</p>
                  <div className={cn("flex items-center gap-2.5 text-sm font-semibold", meta.color)}>
                    <ShieldCheck className="h-5 w-5 shrink-0" />
                    {meta.label}
                  </div>
                  <div className="mt-3 flex items-center gap-1.5">
                    <span className="text-2xl font-bold tabular-nums text-foreground">{totalAllowed}</span>
                    <span className="text-xs text-muted-foreground leading-tight">of {totalActions}<br/>actions allowed</span>
                  </div>
                </div>

                {/* Granting groups */}
                {grantingGroups.length > 0 && (
                  <div className="p-5 border-b">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2.5">Granted by</p>
                    <div className="flex flex-col gap-1.5">
                      {grantingGroups.map((g) => (
                        <div key={g} className={cn(
                          "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-mono",
                          meta.border, meta.color, meta.bg
                        )}>
                          <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
                          {g}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Legend */}
                <div className="p-5 border-b">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Legend</p>
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2.5 text-xs">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-wxops-green/15 border border-wxops-green/30">
                        <Check className="h-3.5 w-3.5 text-wxops-green" />
                      </div>
                      <span className="text-foreground/80">Allowed</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-xs">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-500/10 border border-amber-500/30">
                        <Check className="h-3.5 w-3.5 text-amber-500" />
                      </div>
                      <span className="text-foreground/80">Restricted (scope applies)</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-xs">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted border border-border">
                        <Minus className="h-3.5 w-3.5 text-muted-foreground/50" />
                      </div>
                      <span className="text-foreground/80">Denied</span>
                    </div>
                  </div>
                </div>

                {/* Vault invariants */}
                <div className="p-5 border-b">
                  <div className="flex items-center gap-2 mb-2.5">
                    <Lock className="h-3.5 w-3.5 text-destructive shrink-0" />
                    <p className="text-[11px] font-medium text-destructive uppercase tracking-wider">Vault — all roles</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Portal can <span className="text-foreground font-medium">create / update</span> only.{" "}
                    <span className="text-destructive font-medium">Read and delete are never permitted</span> regardless of role.
                  </p>
                </div>

                {/* Contact */}
                <div className="p-5 flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Who to contact</p>
                  </div>
                  {role === "platform" ? (
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      You are the platform team — full access. Escalate infrastructure concerns internally.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {role === "developer" && orgs.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5 text-[11px] font-medium text-wxops-cyan">
                            <Users className="h-3.5 w-3.5 shrink-0" />
                            Team Managers
                          </div>
                          <div className="flex flex-col gap-1">
                            {orgs.map((o) => (
                              <span key={o} className="text-[10px] font-mono text-wxops-cyan bg-wxops-cyan/10 border border-wxops-cyan/20 rounded px-2 py-0.5">
                                {o}:Managers
                              </span>
                            ))}
                          </div>
                          <p className="text-[10px] text-muted-foreground leading-relaxed">
                            For staging/prod access or lifecycle promotion beyond dev.
                          </p>
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-wxops-green">
                          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                          Platform Team
                        </div>
                        <span className="inline-block text-[10px] font-mono text-wxops-green bg-wxops-green/10 border border-wxops-green/20 rounded px-2 py-0.5">
                          platform-team
                        </span>
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          Cross-team issues, cluster access, or infrastructure changes.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Right: permission matrix ─────────────────────────────── */}
              <div className="flex-1 overflow-y-auto min-w-0">
                {SECTIONS.map((section) => (
                  <div key={section.title}>
                    {/* Section header */}
                    <div className="sticky top-0 z-10 flex items-center gap-2.5 px-6 py-3 bg-muted/60 border-b backdrop-blur-sm">
                      <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-card border border-border shrink-0">
                        <section.Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <span className="text-sm font-semibold text-foreground">{section.title}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground">{section.rows.length} actions</span>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="border-b border-border/50">
                            <th className="px-6 py-2.5 text-left text-xs font-medium text-muted-foreground">Action</th>
                            {COLS.map((col) => (
                              <th
                                key={col.key}
                                className={cn(
                                  "px-4 py-2.5 text-center text-xs font-semibold whitespace-nowrap w-28",
                                  col.key === role
                                    ? cn(meta.headerBg, meta.color)
                                    : "text-muted-foreground"
                                )}
                              >
                                {col.key === role && (
                                  <span className="block text-[9px] font-medium mb-0.5 opacity-70">← you</span>
                                )}
                                {col.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {section.rows.map((row, i) => (
                            <tr
                              key={row.action}
                              className={cn(
                                "border-b border-border/30 transition-colors hover:bg-muted/30",
                                i % 2 === 0 ? "bg-transparent" : "bg-muted/15"
                              )}
                            >
                              <td className="px-6 py-3 text-sm text-foreground/85 leading-snug">{row.action}</td>
                              {COLS.map((col) => (
                                <td
                                  key={col.key}
                                  className={cn(
                                    "px-4 py-3 text-center align-middle w-28",
                                    col.key === role && meta.cellBg
                                  )}
                                >
                                  <CellContent value={row[rowKey[col.key]]} />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}

                {/* Mobile-only: legend + contact footer */}
                <div className="md:hidden border-t px-6 py-5 space-y-4">
                  <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
                    <p className="text-xs font-semibold text-destructive mb-1">Vault — all roles</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Portal can <span className="font-medium text-foreground">create / update</span> secrets only.{" "}
                      <span className="font-medium text-destructive">Read and delete are never permitted</span> regardless of role.
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                      <p className="text-xs font-semibold">Who to contact</p>
                    </div>
                    {role === "platform" ? (
                      <p className="text-xs text-muted-foreground">You are the platform team — full access.</p>
                    ) : (
                      <div className="space-y-2 text-xs text-muted-foreground">
                        {role === "developer" && orgs.map((o) => (
                          <div key={o} className="flex items-center gap-1.5">
                            <Users className="h-3.5 w-3.5 text-wxops-cyan shrink-0" />
                            <span className="font-mono text-wxops-cyan">{o}:Managers</span>
                          </div>
                        ))}
                        <div className="flex items-center gap-1.5">
                          <ShieldCheck className="h-3.5 w-3.5 text-wxops-green shrink-0" />
                          <span className="font-mono text-wxops-green">platform-team</span>
                          <span>on Gitea</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── Cell renderer ──────────────────────────────────────────────────────────────

function CellContent({ value }: { value: CellValue }) {
  if (value === false) {
    return (
      <div className="flex items-center justify-center">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted border border-border">
          <Minus className="h-3.5 w-3.5 text-muted-foreground/40" />
        </div>
      </div>
    );
  }
  if (value === true) {
    return (
      <div className="flex items-center justify-center">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-wxops-green/15 border border-wxops-green/30">
          <Check className="h-3.5 w-3.5 text-wxops-green" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10 border border-amber-500/30">
        <Check className="h-3.5 w-3.5 text-amber-500" />
      </div>
      <span className="text-[9px] leading-none text-amber-500/80 whitespace-nowrap max-w-[80px] text-center">{value}</span>
    </div>
  );
}
