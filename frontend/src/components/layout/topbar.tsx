"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { UserSession } from "@/lib/session";
import { logout } from "@/lib/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { LogOut, Settings, User } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { NotificationBell } from "@/components/layout/notification-bell";

interface TopBarProps {
  user: UserSession;
}

function initials(username?: string | null) {
  if (!username) return "?";
  const local = username.includes("@") ? username.split("@")[0] : username;
  return local.slice(0, 2).toUpperCase();
}

export function TopBar({ user }: TopBarProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleLogout() {
    startTransition(() => logout());
  }

  return (
    <header className="h-14 shrink-0 border-b border-border bg-card/80 backdrop-blur-sm flex items-center justify-between px-6 gap-4 z-10">

      {/* Left — breadcrumb */}
      <div className="flex-1 min-w-0">
        <Breadcrumb />
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-2 shrink-0">
        <NotificationBell />
        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring ml-1">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs bg-wxops-purple text-white">
                {initials(user?.username)}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium hidden sm:inline-block">
              {user?.username}
            </span>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <div className="flex flex-col space-y-0.5">
                  <p className="text-sm font-medium">{user?.username}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.sub}</p>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => router.push("/dashboard/settings")}>
                <User className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/dashboard/settings")}>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuGroup>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={isPending}
                onClick={handleLogout}
              >
                <LogOut className="mr-2 h-4 w-4" />
                {isPending ? "Signing out…" : "Sign out"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
