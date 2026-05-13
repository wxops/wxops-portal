"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // Avoid hydration mismatch — render only after mount
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="h-8 w-8 rounded-md border border-border bg-muted/40 animate-pulse" />
    );
  }

  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Icon className="h-4 w-4" />
        <span className="sr-only">Toggle theme</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun className="mr-2 h-4 w-4" />
          Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon className="mr-2 h-4 w-4" />
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Monitor className="mr-2 h-4 w-4" />
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
