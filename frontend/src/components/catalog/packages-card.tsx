"use client";

import { useEffect, useRef, useState } from "react";
import { Package, Loader2, ChevronDown, ChevronUp, FolderOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PackagesCardProps {
  entityKind: string;
  entityName: string;
}

interface Pkg {
  ecosystem: string;
  name: string;
  version: string;
  direct: boolean;
  dev: boolean;
}

interface Manifest {
  ecosystem: string;
  file: string;
  packages: Pkg[];
}

const ECOSYSTEM_META: Record<string, { label: string; color: string }> = {
  go:     { label: "Go",     color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400" },
  node:   { label: "Node",   color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  python: { label: "Python", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
};

function ManifestSection({ manifest, isMulti }: { manifest: Manifest; isMulti: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const meta = ECOSYSTEM_META[manifest.ecosystem] ?? { label: manifest.ecosystem, color: "bg-muted text-muted-foreground" };
  const direct = manifest.packages.filter((p) => p.direct && !p.dev);
  const dev = manifest.packages.filter((p) => p.dev);
  const indirect = manifest.packages.filter((p) => !p.direct && !p.dev);
  const preview = 5;
  const allPkgs = [...direct, ...dev, ...indirect];
  const shown = expanded ? allPkgs : allPkgs.slice(0, preview);
  const hasMore = allPkgs.length > preview;
  const isSubdir = manifest.file.includes("/");

  return (
    <div className={`space-y-2 ${isMulti ? "rounded-md border border-border p-3" : ""}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.color}`}>
          {meta.label}
        </span>
        <span className="text-xs font-mono text-muted-foreground flex items-center gap-1">
          {isSubdir && <FolderOpen className="h-3 w-3" />}
          {manifest.file}
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {allPkgs.length} pkg{allPkgs.length !== 1 ? "s" : ""}
          {dev.length > 0 ? ` (${dev.length} dev)` : ""}
          {indirect.length > 0 ? ` (${indirect.length} indirect)` : ""}
        </span>
      </div>

      <div className="rounded-md border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-2.5 py-1.5 font-medium text-muted-foreground">Package</th>
              <th className="text-left px-2.5 py-1.5 font-medium text-muted-foreground">Version</th>
              <th className="text-left px-2.5 py-1.5 font-medium text-muted-foreground w-16">Type</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((pkg, i) => (
              <tr key={`${pkg.name}-${i}`} className="border-t border-border">
                <td className="px-2.5 py-1.5 font-mono truncate max-w-[200px]">{pkg.name}</td>
                <td className="px-2.5 py-1.5">
                  <Badge variant="outline" className="font-mono text-[10px]">{pkg.version}</Badge>
                </td>
                <td className="px-2.5 py-1.5">
                  {pkg.dev ? (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400">dev</span>
                  ) : !pkg.direct ? (
                    <span className="text-[10px] text-muted-foreground">indirect</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? (
            <><ChevronUp className="h-3 w-3" /> Show less</>
          ) : (
            <><ChevronDown className="h-3 w-3" /> Show {allPkgs.length - preview} more</>
          )}
        </button>
      )}
    </div>
  );
}

export function PackagesCard({ entityKind, entityName }: PackagesCardProps) {
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    async function fetchPackages() {
      try {
        const res = await fetch(
          `/api/catalog/entities/${encodeURIComponent(entityKind)}/${encodeURIComponent(entityName)}/packages`,
          { credentials: "include" },
        );
        if (!res.ok) return;
        const data = await res.json();
        if (mountedRef.current) {
          setManifests(data.manifests ?? []);
          setTemplateId(data.templateId ?? "");
        }
      } catch { /* ignore */ } finally {
        if (mountedRef.current) setLoading(false);
      }
    }

    fetchPackages();
    return () => { mountedRef.current = false; };
  }, [entityKind, entityName]);

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Package className="h-3.5 w-3.5" /> Dependencies
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (manifests.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Package className="h-3.5 w-3.5" /> Dependencies
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No dependency files found.</p>
        </CardContent>
      </Card>
    );
  }

  const isMulti = manifests.length > 1;
  const ecosystems = [...new Set(manifests.map((m) => m.ecosystem))];
  const totalPkgs = manifests.reduce((sum, m) => sum + m.packages.length, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5" /> Dependencies
          <span className="ml-auto flex items-center gap-2">
            {templateId && (
              <Badge variant="outline" className="font-mono text-[10px] font-normal">
                template: {templateId}
              </Badge>
            )}
            <span className="text-[10px] font-normal">
              {totalPkgs} total · {manifests.length} manifest{manifests.length !== 1 ? "s" : ""}
            </span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isMulti && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {ecosystems.map((eco) => {
              const meta = ECOSYSTEM_META[eco] ?? { label: eco, color: "bg-muted text-muted-foreground" };
              const count = manifests.filter((m) => m.ecosystem === eco).length;
              return (
                <span key={eco} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.color}`}>
                  {meta.label} × {count}
                </span>
              );
            })}
          </div>
        )}
        {manifests.map((m) => (
          <ManifestSection key={`${m.ecosystem}-${m.file}`} manifest={m} isMulti={isMulti} />
        ))}
      </CardContent>
    </Card>
  );
}
