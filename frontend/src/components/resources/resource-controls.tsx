"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Layers, Box, Server } from "lucide-react";

const TABS = [
  { id: "namespaces", label: "Namespaces", icon: Layers },
  { id: "pods", label: "Pods", icon: Box },
  { id: "deployments", label: "Deployments", icon: Server },
];

interface ResourceControlsProps {
  activeTab: string;
  activeNamespace: string;
  namespaces: string[];
}

export function ResourceControls({
  activeTab,
  activeNamespace,
  namespaces,
}: ResourceControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function navigate(updates: { tab?: string; namespace?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    if (updates.tab !== undefined) {
      params.set("tab", updates.tab);
    }
    if (updates.namespace !== undefined) {
      params.set("namespace", updates.namespace);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  const showNamespaceSelector = activeTab !== "namespaces";

  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      {/* Tab buttons */}
      <div className="flex border-b border-border">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => navigate({ tab: id })}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeTab === id
                ? "border-wxops-purple text-wxops-purple"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Namespace selector — only shown for pods/deployments */}
      {showNamespaceSelector && namespaces.length > 0 && (
        <div className="flex items-center gap-2 text-sm mb-0.5">
          <span className="text-muted-foreground text-xs">Namespace:</span>
          <select
            value={activeNamespace}
            onChange={(e) => navigate({ namespace: e.target.value })}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-wxops-purple"
          >
            {namespaces.map((ns) => (
              <option key={ns} value={ns}>
                {ns}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
