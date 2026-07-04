"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Server,
  BookOpen,
  Rocket,
  Activity,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

const navItems = [
  { href: "/dashboard",           label: "Overview",  icon: LayoutDashboard },
  { href: "/dashboard/clusters",  label: "Clusters",  icon: Server },
  { href: "/dashboard/catalog",   label: "Catalog",   icon: BookOpen },
  { href: "/dashboard/scaffold",  label: "Scaffold",  icon: Rocket },
  { href: "/dashboard/activity",  label: "Activity",  icon: Activity },
];

interface SidebarProps {
  groups?: string[] | null;
}

export function Sidebar(_props: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    const stored = localStorage.getItem("sidebar:collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);

  function toggle() {
    setCollapsed((v) => {
      localStorage.setItem("sidebar:collapsed", String(!v));
      return !v;
    });
  }

  // Avoid layout shift on SSR — render expanded until hydrated
  const isCollapsed = mounted && collapsed;

  return (
    <aside
      className={cn(
        "shrink-0 border-r border-border bg-sidebar flex flex-col transition-[width] duration-200",
        isCollapsed ? "w-14" : "w-56",
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          "h-14 flex items-center border-b border-border shrink-0",
          isCollapsed ? "justify-center" : "gap-2.5 px-4",
        )}
      >
        <div className="relative shrink-0">
          <div className="absolute inset-0 rounded-lg bg-wxops-purple/25 blur-md" />
          <Image
            src="/favicon-48x48.png"
            alt="WxOps"
            width={28}
            height={28}
            className="relative rounded-lg"
            priority
          />
        </div>
        {!isCollapsed && (
          <span className="font-semibold text-sm tracking-tight truncate">
            W&apos;xOps{" "}
            <span className="text-gradient font-bold">Portal</span>
          </span>
        )}
      </div>

      {/* Search trigger */}
      <div className={cn("py-2 border-b border-border", isCollapsed ? "px-1.5" : "px-2")}>
        {isCollapsed ? (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("command-palette:open"))}
            title="Search (⌘K)"
            className="flex w-full items-center justify-center rounded-lg border border-border bg-muted/30 p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <Search className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("command-palette:open"))}
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <Search className="h-3 w-3 shrink-0" />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px]">
              ⌘K
            </kbd>
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className={cn("flex-1 py-4 space-y-0.5 overflow-hidden", isCollapsed ? "px-1.5" : "px-2")}>
        {!isCollapsed && (
          <p className="text-[10px] font-semibold text-muted-foreground px-2 mb-3 uppercase tracking-widest">
            Platform
          </p>
        )}

        {navItems.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/dashboard"
              ? pathname === href
              : pathname.startsWith(href);

          return (
            <div key={href} className="relative group">
              <Link
                href={href}
                className={cn(
                  "relative flex items-center rounded-lg text-sm transition-all duration-150",
                  isCollapsed ? "justify-center p-2.5" : "gap-2.5 px-2 py-2",
                  active
                    ? cn(
                        "text-wxops-purple font-medium",
                        isCollapsed
                          ? "bg-wxops-purple/15"
                          : "bg-gradient-to-r from-wxops-purple/15 to-transparent",
                      )
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-full bg-wxops-purple sidebar-indicator-glow" />
                )}
                <Icon className={cn("h-4 w-4 shrink-0", active ? "text-wxops-purple" : "")} />
                {!isCollapsed && label}
              </Link>

              {/* Floating tooltip shown only in collapsed mode */}
              {isCollapsed && (
                <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md opacity-0 transition-opacity group-hover:opacity-100">
                  {label}
                </span>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer — collapse toggle */}
      <div
        className={cn(
          "py-3 border-t border-border flex items-center shrink-0",
          isCollapsed ? "justify-center px-1.5" : "justify-between px-4",
        )}
      >
        {!isCollapsed && (
          <p className="text-[10px] text-muted-foreground/50 font-mono">wxops.cloud</p>
        )}
        <button
          type="button"
          onClick={toggle}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          {isCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>
    </aside>
  );
}
