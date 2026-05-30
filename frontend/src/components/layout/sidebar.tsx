"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Settings,
  ChevronRight,
  Server,
  BookOpen,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/clusters", label: "Clusters", icon: Server },
  { href: "/dashboard/catalog", label: "Catalog", icon: BookOpen },
];

interface SidebarProps {
  groups?: string[] | null;
}

export function Sidebar(_props: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 border-r border-border bg-sidebar flex flex-col">
      {/* Logo */}
      <div className="h-14 flex items-center gap-2.5 px-4 border-b border-border">
        <Image
          src="/favicon-48x48.png"
          alt="W'xOps"
          width={28}
          height={28}
          className="rounded-lg shrink-0"
          priority
        />
        <span className="font-semibold text-sm tracking-tight">W&apos;xOps Portal</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-0.5">
        <p className="text-xs font-medium text-muted-foreground px-2 mb-2 uppercase tracking-wider">
          Platform
        </p>
        {navItems.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/dashboard"
              ? pathname === href
              : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 px-2 py-2 rounded-md text-sm transition-colors",
                active
                  ? "bg-wxops-purple/10 text-wxops-purple font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
              {active && <ChevronRight className="h-3 w-3 ml-auto" />}
            </Link>
          );
        })}

        <div className="pt-4">
          <p className="text-xs font-medium text-muted-foreground px-2 mb-2 uppercase tracking-wider">
            Settings
          </p>
          <Link
            href="/dashboard/settings"
            className="flex items-center gap-2.5 px-2 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Settings className="h-4 w-4 shrink-0" />
            Settings
          </Link>
        </div>
      </nav>
    </aside>
  );
}
