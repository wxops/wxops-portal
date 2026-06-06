"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Server, BookOpen } from "lucide-react";

const navItems = [
  { href: "/dashboard",          label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/clusters", label: "Clusters", icon: Server },
  { href: "/dashboard/catalog",  label: "Catalog",  icon: BookOpen },
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
        <span className="font-semibold text-sm tracking-tight">
          W&apos;xOps{" "}
          <span className="text-gradient font-bold">Portal</span>
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-0.5">
        <p className="text-[10px] font-semibold text-muted-foreground px-2 mb-3 uppercase tracking-widest">
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
                "relative flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm transition-all duration-150",
                active
                  ? "bg-wxops-purple/12 text-wxops-purple font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-full bg-wxops-purple" />
              )}
              <Icon className={cn("h-4 w-4 shrink-0", active ? "text-wxops-purple" : "")} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border">
        <p className="text-[10px] text-muted-foreground/50 font-mono">wxops.cloud</p>
      </div>

    </aside>
  );
}
