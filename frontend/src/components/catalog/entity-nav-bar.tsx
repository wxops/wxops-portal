"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { trackVisit, isPinned as checkPinned, togglePin } from "@/lib/entity-nav";
import type { NavEntity } from "@/lib/entity-nav";

interface EntityNavBarProps {
  kind:        string;
  name:        string;
  title:       string;
  description: string;
  lifecycle:   string;
}

export function EntityNavBar({ kind, name, title, description, lifecycle }: EntityNavBarProps) {
  const [pinned, setPinned] = useState(false);

  // Track visit + read initial pin state on mount (localStorage is client-only)
  useEffect(() => {
    const entity: NavEntity = { kind, name, title, description, lifecycle };
    trackVisit(entity);
    setPinned(checkPinned(kind, name)); // eslint-disable-line react-hooks/set-state-in-effect
  }, [kind, name, title, description, lifecycle]);

  function handlePin() {
    const entity: NavEntity = { kind, name, title, description, lifecycle };
    setPinned(togglePin(entity));
  }

  return (
    <button
      type="button"
      onClick={handlePin}
      title={pinned ? "Unpin from quick access" : "Pin to quick access"}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg border transition-colors",
        pinned
          ? "border-amber-400/50 bg-amber-50 text-amber-500 hover:bg-amber-100 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-400 dark:hover:bg-amber-900/30"
          : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50",
      )}
    >
      <Star className={cn("h-3.5 w-3.5 transition-all", pinned && "fill-current")} />
    </button>
  );
}
