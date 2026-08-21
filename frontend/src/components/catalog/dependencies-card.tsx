"use client";

import { Package, FolderOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DependenciesPanel } from "@/components/catalog/dependencies-panel";

export interface Pkg {
  ecosystem: string;
  name: string;
  version: string;
  direct: boolean;
  dev: boolean;
}

export interface Manifest {
  ecosystem: string;
  file: string;
  packages: Pkg[];
  truncated: boolean;
  total: number;
}

interface DependenciesCardProps {
  entityKind: string;
  entityName: string;
  manifests: Manifest[];
  templateId: string;
}

export const ECOSYSTEM_META: Record<string, { label: string; color: string }> = {
  go:     { label: "Go",     color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400" },
  node:   { label: "Node",   color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  python: { label: "Python", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
};

export type PackageKind = "direct" | "dev" | "indirect";

export function packageKind(p: Pkg): PackageKind {
  if (p.dev) return "dev";
  if (!p.direct) return "indirect";
  return "direct";
}

/** Shared table rendering, reused by the deep-dive panel — kept out of any
 * per-manifest preview/expand logic so it renders identically wherever a
 * flat list of packages needs to show up. */
export function PackageTable({ packages }: { packages: Pkg[] }) {
  return (
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
          {packages.map((pkg, i) => (
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
  );
}

export function ManifestFileLabel({ ecosystem, file }: { ecosystem: string; file: string }) {
  const meta = ECOSYSTEM_META[ecosystem] ?? { label: ecosystem, color: "bg-muted text-muted-foreground" };
  const isSubdir = file.includes("/");
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.color}`}>
        {meta.label}
      </span>
      <span className="text-xs font-mono text-muted-foreground flex items-center gap-1">
        {isSubdir && <FolderOpen className="h-3 w-3" />}
        {file}
      </span>
    </div>
  );
}

export function DependenciesCard({ entityKind, entityName, manifests, templateId }: DependenciesCardProps) {
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

  // Path + count per manifest, biggest first — a scannable summary of
  // where dependencies live and how much is in each, without listing
  // individual packages (that's what "View all" is for). Capped so a
  // monorepo with many manifests doesn't grow this card unbounded.
  const MANIFEST_PREVIEW_LIMIT = 5;
  const manifestsByCount = [...manifests].sort((a, b) => b.packages.length - a.packages.length);
  const previewManifests = manifestsByCount.slice(0, MANIFEST_PREVIEW_LIMIT);
  const hiddenManifests = manifests.length - previewManifests.length;

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
        <div className="space-y-1.5">
          {previewManifests.map((m) => (
            <div key={`${m.ecosystem}-${m.file}`} className="flex items-center gap-2">
              <ManifestFileLabel ecosystem={m.ecosystem} file={m.file} />
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">
                {m.packages.length} package{m.packages.length !== 1 ? "s" : ""}
              </span>
            </div>
          ))}
          {hiddenManifests > 0 && (
            <p className="text-[10px] text-muted-foreground">
              +{hiddenManifests} more manifest{hiddenManifests !== 1 ? "s" : ""}
            </p>
          )}
        </div>

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

        <Dialog>
          <DialogTrigger
            render={
              <Button variant="ghost" size="sm" className="w-full justify-center text-muted-foreground">
                View all {totalPkgs} packages →
              </Button>
            }
          />
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Dependencies — {entityName}</DialogTitle>
            </DialogHeader>
            <DependenciesPanel entityKind={entityKind} entityName={entityName} manifests={manifests} />
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
