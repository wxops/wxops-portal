"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface CatalogSearchBarProps {
  defaultValue?: string;
  baseParams?: Record<string, string | undefined>;
}

export function CatalogSearchBar({
  defaultValue = "",
  baseParams = {},
}: CatalogSearchBarProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  function navigate(value: string) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(baseParams)) {
      if (v) params.set(k, v);
    }
    if (value.trim()) {
      params.set("search", value.trim());
    }
    const qs = params.toString();
    router.push(`/dashboard/catalog${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="relative flex items-center">
      <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
      <input
        ref={inputRef}
        type="search"
        defaultValue={defaultValue}
        onKeyDown={(e) => {
          if (e.key === "Enter") navigate(e.currentTarget.value);
        }}
        placeholder="Search by name, description, or tags…"
        className={cn(
          "h-9 w-full rounded-lg border border-border bg-background",
          "pl-9 pr-9 text-sm placeholder:text-muted-foreground",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0",
          "transition-colors"
        )}
      />
      {defaultValue && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            if (inputRef.current) inputRef.current.value = "";
            navigate("");
          }}
          className="absolute right-3 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
