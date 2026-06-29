"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Folder, FileCode, Loader2, Shield, Database, Globe, Network, GitBranch, GitMerge, Tag, Package, ArrowRight, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { WizardState } from "./project-wizard";

interface TemplateDefaults {
  port?: number;
  replicas?: number;
  cpuRequest?: string;
  memoryRequest?: string;
  cpuLimit?: string;
  memoryLimit?: string;
  healthPath?: string;
  livenessPath?: string;
  readinessPath?: string;
  metricsPath?: string;
}

interface TemplateFeatures {
  vault?: boolean;
  database?: boolean;
  api?: boolean;
  apiType?: string;
  ingress?: boolean;
  monitoring?: boolean;
}

interface TemplateVersionChoice {
  default: string;
  options: string[];
}

interface TemplateChoice {
  default: string;
  options: string[];
}

interface TemplateRuntime {
  language: string;
  version?: TemplateVersionChoice;
  packageManager?: TemplateChoice;
}

interface TemplateInfo {
  name: string;
  title?: string;
  description?: string;
  tags?: string[];
  runtime?: TemplateRuntime;
  defaults?: TemplateDefaults;
  recommends?: TemplateFeatures;
}

export type { TemplateInfo };

interface StepTemplateProps {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  onTemplateLoaded?: (templates: TemplateInfo[]) => void;
}

const TAG_COLORS: Record<string, string> = {
  backend:      "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  frontend:     "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  go:           "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
  python:       "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  node:         "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  microservice: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
};

function FeatureBadges({ recommends }: { recommends: TemplateFeatures }) {
  const features: { label: string; icon: React.ComponentType<{ className?: string }>; active: boolean }[] = [
    { label: "Vault", icon: Shield, active: !!recommends.vault },
    { label: "Database", icon: Database, active: !!recommends.database },
    { label: recommends.apiType?.toUpperCase() || "API", icon: Globe, active: !!recommends.api },
    { label: "Ingress", icon: Network, active: !!recommends.ingress },
  ];

  const active = features.filter((f) => f.active);
  if (active.length === 0) return null;

  return (
    <div className="flex items-center gap-1 mt-2">
      <span className="text-[9px] text-muted-foreground uppercase tracking-wider mr-0.5">Recommends</span>
      {active.map(({ label, icon: Icon }) => (
        <span
          key={label}
          className="inline-flex items-center gap-0.5 rounded-full bg-wxops-purple/10 text-wxops-purple px-1.5 py-0.5 text-[9px] font-medium"
        >
          <Icon className="h-2.5 w-2.5" />{label}
        </span>
      ))}
    </div>
  );
}

function DefaultsPreview({ defaults }: { defaults: TemplateDefaults }) {
  const items = [
    defaults.port && `Port ${defaults.port}`,
    defaults.replicas && `${defaults.replicas} replicas`,
    defaults.cpuRequest && `CPU ${defaults.cpuRequest}`,
    defaults.memoryRequest && `Mem ${defaults.memoryRequest}`,
    defaults.healthPath && `Health ${defaults.healthPath}`,
  ].filter(Boolean) as string[];

  if (items.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-2">
      <span className="text-[9px] text-muted-foreground uppercase tracking-wider mr-0.5">Defaults</span>
      {items.map((item) => (
        <span key={item} className="text-[10px] font-mono text-muted-foreground bg-muted rounded px-1 py-0.5">
          {item}
        </span>
      ))}
    </div>
  );
}

function TemplateTree({ templateId }: { templateId: string }) {
  const [tree, setTree] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cacheKey = `wxops:tree:${templateId}`;
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (raw) {
        const { data, ts } = JSON.parse(raw);
        if (Date.now() - ts < TEMPLATE_CACHE_TTL) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setTree(data);
          setLoading(false);
          return;
        }
      }
    } catch { /* ignore */ }

    setLoading(true);
    fetch(`/api/scaffold/templates/${encodeURIComponent(templateId)}/tree`, {
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        const treeData = data.tree ?? [];
        setTree(treeData);
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ data: treeData, ts: Date.now() })); } catch { /* ignore */ }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [templateId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading structure...
      </div>
    );
  }

  if (tree.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">
        Project structure
      </p>
      <div className="font-mono text-xs space-y-0.5">
        {tree.map((entry) => {
          const isDir = entry.endsWith("/");
          const depth = entry.split("/").length - (isDir ? 2 : 1);
          const name = isDir ? entry.slice(0, -1).split("/").pop() : entry.split("/").pop();
          return (
            <div
              key={entry}
              className="flex items-center gap-1.5 text-muted-foreground"
              style={{ paddingLeft: `${depth * 16}px` }}
            >
              {isDir ? (
                <Folder className="h-3 w-3 text-amber-500 shrink-0" />
              ) : (
                <FileCode className="h-3 w-3 shrink-0" />
              )}
              <span className={isDir ? "font-medium text-foreground" : ""}>
                {name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const LANG_LABELS: Record<string, string> = {
  go: "Go",
  python: "Python",
  node: "Node.js",
};

function RuntimeSelector({
  runtime,
  runtimeVersion,
  packageManager,
  onChange,
}: {
  runtime: TemplateRuntime;
  runtimeVersion: string;
  packageManager: string;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  const langLabel = LANG_LABELS[runtime.language] ?? runtime.language;
  const versions = runtime.version?.options ?? [];
  const pkgManagers = runtime.packageManager?.options ?? [];

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
        Runtime — {langLabel}
      </p>
      <div className={cn("grid gap-3", pkgManagers.length > 0 ? "grid-cols-2" : "grid-cols-1")}>
        {versions.length > 0 && (
          <div>
            <label className="block text-xs font-medium mb-1">{langLabel} Version</label>
            <select
              value={runtimeVersion || runtime.version?.default || ""}
              onChange={(e) => onChange({ runtimeVersion: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            >
              {versions.map((v) => (
                <option key={v} value={v}>
                  {v}{v === runtime.version?.default ? " (default)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        {pkgManagers.length > 0 && (
          <div>
            <label className="block text-xs font-medium mb-1">Package Manager</label>
            <select
              value={packageManager || runtime.packageManager?.default || ""}
              onChange={(e) => onChange({ packageManager: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            >
              {pkgManagers.map((pm) => (
                <option key={pm} value={pm}>
                  {pm}{pm === runtime.packageManager?.default ? " (default)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

function GitFlowDiagram() {
  return (
    <div className="rounded-lg border border-border bg-muted/10 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-wxops-purple shrink-0" />
        <p className="text-xs font-semibold">Project Lifecycle</p>
        <span className="text-[9px] text-muted-foreground ml-auto">Same binary, promoted via crane</span>
      </div>

      {/* Branch flow — three nodes with connectors */}
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-0">
        {/* develop */}
        <div className="rounded-lg border-2 border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30 p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-blue-500 ring-2 ring-blue-200 dark:ring-blue-800" />
            <span className="text-xs font-bold text-blue-700 dark:text-blue-400">develop</span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Zap className="h-2.5 w-2.5 text-blue-500" />
              <span>CI builds image</span>
            </div>
            <div className="flex items-center gap-1 text-[10px]">
              <Tag className="h-2.5 w-2.5 text-blue-500" />
              <code className="font-mono text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/40 rounded px-1">dev-*</code>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Package className="h-2.5 w-2.5" />
              <span>experimental</span>
            </div>
          </div>
          <div className="border-t border-blue-200 dark:border-blue-800 pt-1.5 mt-1">
            <p className="text-[9px] text-blue-600/70 dark:text-blue-400/60">
              feature/*, chore/*, refactor/*
            </p>
          </div>
        </div>

        {/* Arrow 1 */}
        <div className="flex flex-col items-center justify-center px-1">
          <ArrowRight className="h-4 w-4 text-muted-foreground/50" />
          <span className="text-[8px] text-muted-foreground/50 mt-0.5">PR</span>
        </div>

        {/* staging */}
        <div className="rounded-lg border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-amber-200 dark:ring-amber-800" />
            <span className="text-xs font-bold text-amber-700 dark:text-amber-400">staging</span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <GitMerge className="h-2.5 w-2.5 text-amber-500" />
              <span>crane re-tag</span>
            </div>
            <div className="flex items-center gap-1 text-[10px]">
              <Tag className="h-2.5 w-2.5 text-amber-500" />
              <code className="font-mono text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 rounded px-1">vX.Y.Z-rcN</code>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Package className="h-2.5 w-2.5" />
              <span>development</span>
            </div>
          </div>
          <div className="border-t border-amber-200 dark:border-amber-800 pt-1.5 mt-1">
            <p className="text-[9px] text-amber-600/70 dark:text-amber-400/60">
              auto-RC versioning
            </p>
          </div>
        </div>

        {/* Arrow 2 */}
        <div className="flex flex-col items-center justify-center px-1">
          <ArrowRight className="h-4 w-4 text-muted-foreground/50" />
          <span className="text-[8px] text-muted-foreground/50 mt-0.5">PR</span>
        </div>

        {/* main */}
        <div className="rounded-lg border-2 border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-green-200 dark:ring-green-800" />
            <span className="text-xs font-bold text-green-700 dark:text-green-400">main</span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <GitMerge className="h-2.5 w-2.5 text-green-500" />
              <span>crane re-tag + release</span>
            </div>
            <div className="flex items-center gap-1 text-[10px]">
              <Tag className="h-2.5 w-2.5 text-green-500" />
              <code className="font-mono text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/40 rounded px-1">vX.Y.Z</code>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Package className="h-2.5 w-2.5" />
              <span>production</span>
            </div>
          </div>
          <div className="border-t border-green-200 dark:border-green-800 pt-1.5 mt-1">
            <p className="text-[9px] text-green-600/70 dark:text-green-400/60">
              hotfix/* merges here
            </p>
          </div>
        </div>
      </div>

      {/* Footer — CI pipeline summary */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1 border-t border-border">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          test + security on every push & PR
        </span>
        <span className="text-border">|</span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          Image Updater auto-deploys
        </span>
        <span className="text-border">|</span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          hotfix always rebuilds
        </span>
      </div>
    </div>
  );
}

const TEMPLATE_CACHE_KEY = "wxops:templates";
const TEMPLATE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedTemplates(): TemplateInfo[] | null {
  try {
    const raw = sessionStorage.getItem(TEMPLATE_CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > TEMPLATE_CACHE_TTL) return null;
    return data as TemplateInfo[];
  } catch {
    return null;
  }
}

function setCachedTemplates(templates: TemplateInfo[]) {
  try {
    sessionStorage.setItem(TEMPLATE_CACHE_KEY, JSON.stringify({ data: templates, ts: Date.now() }));
  } catch { /* quota exceeded — ignore */ }
}

export function StepTemplate({ state, onChange, onTemplateLoaded }: StepTemplateProps) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = getCachedTemplates();
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTemplates(cached);
      onTemplateLoaded?.(cached);
      setLoading(false);
      return;
    }

    fetch("/api/scaffold/templates", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const loaded = data.templates ?? [];
        setTemplates(loaded);
        onTemplateLoaded?.(loaded);
        setCachedTemplates(loaded);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg border bg-muted/30" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">Failed to load templates: {error}</p>;
  }

  if (templates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No templates found. Add template subdirectories to the templates repository.
      </p>
    );
  }

  const selected = templates.find((t) => t.name === state.templateId);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Choose a golden-path template to bootstrap your project.
      </p>

      {/* Git-flow visual */}
      <GitFlowDiagram />

      <div className="grid gap-3 sm:grid-cols-2">
        {templates.map((t) => {
          const isSelected = state.templateId === t.name;
          return (
            <button
              key={t.name}
              type="button"
              onClick={() => onChange({ templateId: t.name })}
              className={cn(
                "rounded-lg border p-4 text-left transition-all",
                isSelected
                  ? "border-wxops-purple bg-wxops-purple/5 ring-1 ring-wxops-purple/40"
                  : "border-border hover:border-primary/40 hover:bg-muted/30",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-sm">{t.title || t.name}</p>
              </div>
              {t.title && (
                <p className="text-[10px] font-mono text-muted-foreground">{t.name}</p>
              )}
              {t.description && (
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{t.description}</p>
              )}
              {t.tags && t.tags.length > 0 && (
                <div className="flex items-center gap-1 mt-2 flex-wrap">
                  {t.tags.map((tag) => (
                    <Badge
                      key={tag}
                      className={cn(
                        "text-[9px] px-1.5 py-0 font-medium",
                        TAG_COLORS[tag] ?? "bg-muted text-muted-foreground",
                      )}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
              {t.recommends && <FeatureBadges recommends={t.recommends} />}
            </button>
          );
        })}
      </div>

      {/* Selected template details */}
      {selected && (
        <div className="space-y-3">
          {selected.runtime && (
            <RuntimeSelector
              runtime={selected.runtime}
              runtimeVersion={state.runtimeVersion}
              packageManager={state.packageManager}
              onChange={onChange}
            />
          )}
          {selected.defaults && <DefaultsPreview defaults={selected.defaults} />}
          <TemplateTree templateId={selected.name} />
        </div>
      )}
    </div>
  );
}
