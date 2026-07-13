"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Network, Database, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export type SectionKind = "services" | "apis" | "resources" | "docs";

const SECTION_META: Record<SectionKind, {
  label: string;
  shortLabel: string;
  iconClass: string;
  iconBg: string;
  indicator: string;
  activeCount: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = {
  services:  { label: "Services",  shortLabel: "Services",  Icon: Box,      iconClass: "text-violet-500",  iconBg: "bg-violet-500/15",  indicator: "bg-violet-500",  activeCount: "text-violet-600 dark:text-violet-400" },
  apis:      { label: "APIs",      shortLabel: "APIs",      Icon: Network,  iconClass: "text-cyan-500",    iconBg: "bg-cyan-500/15",    indicator: "bg-cyan-500",    activeCount: "text-cyan-600 dark:text-cyan-400" },
  resources: { label: "Resources", shortLabel: "Resources", Icon: Database, iconClass: "text-indigo-500",  iconBg: "bg-indigo-500/15",  indicator: "bg-indigo-500",  activeCount: "text-indigo-600 dark:text-indigo-400" },
  docs:      { label: "Decisions", shortLabel: "Decisions", Icon: BookOpen, iconClass: "text-emerald-500", iconBg: "bg-emerald-500/15", indicator: "bg-emerald-500", activeCount: "text-emerald-600 dark:text-emerald-400" },
};

export interface SectionTab {
  kind: SectionKind;
  count: number;
  children: ReactNode;
}

interface SectionTabsProps {
  tabs: SectionTab[];
  defaultKind?: SectionKind;
}

export function SectionTabs({ tabs, defaultKind }: SectionTabsProps) {
  const router  = useRouter();
  const initial = (defaultKind && tabs.some((t) => t.kind === defaultKind) ? defaultKind : tabs[0]?.kind ?? "services") as SectionKind;
  const [active, setActive] = useState<SectionKind>(initial);

  const validActive = tabs.some((t) => t.kind === active) ? active : (tabs[0]?.kind ?? "services");

  function handleTabChange(kind: SectionKind) {
    setActive(kind);
    router.replace(`?tab=${kind}`, { scroll: false });
  }

  return (
    <div className="rounded-xl border overflow-hidden">
      {/* Tab strip — compact natural-width tabs, full-width underline */}
      <div className="border-b bg-muted/5">
        <div className="flex overflow-x-auto">
          {tabs.map((tab) => {
            const { label, shortLabel, Icon, iconClass, iconBg, indicator, activeCount } = SECTION_META[tab.kind];
            const isActive = tab.kind === validActive;
            return (
              <button
                key={tab.kind}
                onClick={() => handleTabChange(tab.kind)}
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

                <span className={cn(
                  "text-sm tabular-nums font-semibold",
                  isActive ? activeCount : "text-muted-foreground/50",
                )}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content panels — active stays in flow; others are absolutely overlaid and invisible */}
      <div className="relative">
        {tabs.map((tab) => {
          const isActive = tab.kind === validActive;
          const { iconBg } = SECTION_META[tab.kind];
          return (
            <div
              key={tab.kind}
              aria-hidden={!isActive}
              className={cn(
                "p-6 transition-opacity duration-200",
                isActive ? "relative opacity-100" : "absolute inset-0 opacity-0 pointer-events-none overflow-hidden",
                isActive ? iconBg.replace("/15", "/[0.04]") : "",
              )}
            >
              {tab.children}
            </div>
          );
        })}
      </div>
    </div>
  );
}
