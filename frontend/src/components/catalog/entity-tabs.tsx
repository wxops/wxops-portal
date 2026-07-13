"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, GitBranch, Layers, FileCode2, LayoutList, Server } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export type EntityTabId = "overview" | "runtime" | "pipeline" | "promote" | "spec" | "details";

const TAB_META: Record<EntityTabId, {
  label: string;
  shortLabel: string;
  iconClass: string;
  iconBg: string;
  indicator: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = {
  overview: { label: "Overview", shortLabel: "Overview", Icon: Activity,   iconClass: "text-violet-500",  iconBg: "bg-violet-500/15",  indicator: "bg-violet-500"  },
  runtime:  { label: "Runtime",  shortLabel: "Runtime",  Icon: Server,     iconClass: "text-sky-500",     iconBg: "bg-sky-500/15",     indicator: "bg-sky-500"     },
  pipeline: { label: "Pipeline", shortLabel: "Pipeline", Icon: GitBranch,  iconClass: "text-cyan-500",    iconBg: "bg-cyan-500/15",    indicator: "bg-cyan-500"    },
  promote:  { label: "Promote",  shortLabel: "Promote",  Icon: Layers,     iconClass: "text-emerald-500", iconBg: "bg-emerald-500/15", indicator: "bg-emerald-500" },
  spec:     { label: "API Spec", shortLabel: "Spec",     Icon: FileCode2,  iconClass: "text-orange-500",  iconBg: "bg-orange-500/15",  indicator: "bg-orange-500"  },
  details:  { label: "Details",  shortLabel: "Details",  Icon: LayoutList, iconClass: "text-indigo-500",  iconBg: "bg-indigo-500/15",  indicator: "bg-indigo-500"  },
};

export interface EntityTab {
  id: EntityTabId;
  children: ReactNode;
  padding?: "none";
}

interface EntityTabsProps {
  tabs: EntityTab[];
  defaultTab?: EntityTabId;
}

export function EntityTabs({ tabs, defaultTab }: EntityTabsProps) {
  const router = useRouter();
  const initial = (defaultTab && tabs.some((t) => t.id === defaultTab) ? defaultTab : tabs[0]?.id ?? "overview") as EntityTabId;
  const [active, setActive]   = useState<EntityTabId>(initial);
  // Track which tabs have been visited — visited tabs stay mounted (just hidden).
  // Unvisited tabs never mount, so their fetches don't fire until needed.
  const [visited, setVisited] = useState<Set<EntityTabId>>(() => new Set([initial]));

  const validActive = (tabs.some((t) => t.id === active) ? active : tabs[0]?.id ?? "overview") as EntityTabId;

  function handleTabChange(id: EntityTabId) {
    setActive(id);
    setVisited((prev) => new Set([...prev, id]));
    // Update URL without a history entry so the tab survives a reload.
    router.replace(`?tab=${id}`, { scroll: false });
  }

  return (
    <div className="rounded-xl border overflow-hidden">
      {/* Tab strip */}
      <div className="border-b bg-muted/5">
        <div className="flex overflow-x-auto">
          {tabs.map((tab) => {
            const { label, shortLabel, Icon, iconClass, iconBg, indicator } = TAB_META[tab.id];
            const isActive = tab.id === validActive;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={cn(
                  "relative flex shrink-0 items-center gap-2 px-5 py-3.5 transition-colors select-none",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                )}
              >
                {isActive && (
                  <span className={cn("absolute bottom-0 left-0 right-0 h-0.5", indicator)} />
                )}
                <span className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors",
                  isActive ? iconBg : "",
                )}>
                  <Icon className={cn("h-3.5 w-3.5", isActive ? iconClass : "text-muted-foreground/50")} />
                </span>
                <span className={cn("text-sm whitespace-nowrap", isActive ? "font-semibold" : "font-medium")}>
                  <span className="hidden sm:inline">{label}</span>
                  <span className="sm:hidden">{shortLabel}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content — visited tabs stay mounted but are hidden; unvisited tabs never mount. */}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn(
            tab.id !== validActive && "hidden",
            tab.padding === "none" ? "" : "p-6",
          )}
        >
          {visited.has(tab.id) && tab.children}
        </div>
      ))}
    </div>
  );
}
