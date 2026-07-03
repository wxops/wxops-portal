"use client";

import { useEffect, useState } from "react";
import { GitBranch, Tag } from "lucide-react";
import { cn } from "@/lib/utils";

interface EnvVersion {
  tag: string;
  date: string;
}

interface VersionsData {
  dev: EnvVersion | null;
  staging: EnvVersion | null;
  production: EnvVersion | null;
}

const ENVS: {
  key: keyof VersionsData;
  label: string;
  dot: string;
  text: string;
  bg: string;
}[] = [
  {
    key: "dev",
    label: "Dev",
    dot: "bg-blue-500",
    text: "text-blue-700 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950/20",
  },
  {
    key: "staging",
    label: "Staging",
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/20",
  },
  {
    key: "production",
    label: "Production",
    dot: "bg-green-500",
    text: "text-green-700 dark:text-green-400",
    bg: "bg-green-50 dark:bg-green-950/20",
  },
];

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff)) return "";
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function shortTag(tag: string): string {
  // dev-2024-01-15_10-30-00-abc1234 → dev-…-abc1234
  if (tag.startsWith("dev-")) {
    const sha = tag.split("-").pop() ?? "";
    return sha ? `dev-…-${sha}` : tag;
  }
  return tag;
}

interface Props {
  entityKind: string;
  entityName: string;
}

export function EnvironmentVersionsCard({ entityKind, entityName }: Props) {
  const [data, setData] = useState<VersionsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(
      `/api/catalog/entities/${encodeURIComponent(entityKind)}/${encodeURIComponent(entityName)}/versions`,
      { credentials: "include" },
    )
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData({ dev: null, staging: null, production: null });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [entityKind, entityName]);

  const hasAny = data && (data.dev || data.staging || data.production);

  if (!loading && !hasAny) return null;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Environments
        </span>
      </div>

      <div className="grid grid-cols-3 divide-x divide-border">
        {ENVS.map(({ key, label, dot, text, bg }) => {
          const v = data?.[key] ?? null;
          return (
            <div key={key} className="px-4 py-3 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dot)} />
                <span className="text-xs font-medium text-muted-foreground">{label}</span>
              </div>

              {loading ? (
                <div className="space-y-1.5 animate-pulse">
                  <div className="h-4 w-24 rounded bg-muted" />
                  <div className="h-3 w-12 rounded bg-muted" />
                </div>
              ) : v ? (
                <>
                  <div className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5", bg)}>
                    <Tag className={cn("h-3 w-3 shrink-0", text)} />
                    <span
                      className={cn("font-mono text-[11px] font-medium leading-none", text)}
                      title={v.tag}
                    >
                      {shortTag(v.tag)}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{relativeDate(v.date)}</p>
                </>
              ) : (
                <span className="text-xs text-muted-foreground/40">—</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
