"use client";

import { useState } from "react";
import { ChevronDown, Box, Network, Database, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export type SectionKind = "services" | "apis" | "resources" | "docs";

const SECTION_META: Record<SectionKind, {
  label: string;
  iconClass: string;
  iconBg: string;
  openBg: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = {
  services:  { label: "Services",           Icon: Box,      iconClass: "text-violet-500",  iconBg: "bg-violet-500/15",  openBg: "bg-violet-500/[0.06]" },
  apis:      { label: "APIs",               Icon: Network,  iconClass: "text-cyan-500",    iconBg: "bg-cyan-500/15",    openBg: "bg-cyan-500/[0.06]" },
  resources: { label: "Resources",          Icon: Database, iconClass: "text-indigo-500",  iconBg: "bg-indigo-500/15",  openBg: "bg-indigo-500/[0.06]" },
  docs:      { label: "Decision Documents", Icon: BookOpen, iconClass: "text-emerald-500", iconBg: "bg-emerald-500/15", openBg: "bg-emerald-500/[0.06]" },
};

interface CollapsibleSectionProps {
  kind: SectionKind;
  count: number;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  kind,
  count,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const { label, Icon, iconClass, iconBg, openBg } = SECTION_META[kind];

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors select-none",
          open ? openBg : "hover:bg-muted/30",
        )}
      >
        <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", iconBg)}>
          <Icon className={cn("h-3.5 w-3.5", iconClass)} />
        </span>

        <span className={cn(
          "flex-1 text-sm font-semibold transition-colors",
          open ? "text-foreground" : "text-foreground/80",
        )}>
          {label}
        </span>

        <span className={cn(
          "text-sm tabular-nums font-semibold transition-colors",
          open ? iconClass : "text-muted-foreground",
        )}>
          {count}
        </span>

        <ChevronDown
          className={cn(
            "h-4 w-4 transition-all duration-200 ml-1 shrink-0",
            open ? `${iconClass} rotate-180` : "text-muted-foreground/50",
          )}
        />
      </button>

      {/* Slide-in content via grid-rows trick */}
      <div
        className="grid"
        style={{
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 0.25s cubic-bezier(0.4,0,0.2,1)",
        }}
      >
        <div className="overflow-hidden">
          <div className={cn("px-4 pt-3 pb-4 border-t border-border/40", open ? openBg : "")}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
