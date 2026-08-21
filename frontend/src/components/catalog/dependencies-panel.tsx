"use client";

import { useMemo, useState } from "react";
import { Document } from "flexsearch";
import { AlertTriangle, GitCompare, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  ECOSYSTEM_META,
  ManifestFileLabel,
  PackageTable,
  packageKind,
  type Manifest,
  type Pkg,
  type PackageKind,
} from "@/components/catalog/dependencies-card";
import { ReleasePicker } from "@/components/catalog/release-picker";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FlexDoc = Document<any, any>;

interface PackageDoc {
  id: string;
  name: string;
  ecosystem: string;
  version: string;
  // Index signature required by FlexSearch's DocumentData constraint
  [key: string]: unknown;
}

type KindFilter = "all" | PackageKind;

const KIND_LABEL: Record<KindFilter, string> = {
  all: "All",
  direct: "Direct",
  dev: "Dev",
  indirect: "Indirect",
};

// Built once per dialog-open from the manifests prop — a fresh, local index,
// not lib/catalog-index.ts's module-level singleton (that one indexes
// catalog *entities* on a 5-minute TTL; this is ephemeral per-dialog data).
function buildIndex(manifests: Manifest[]): FlexDoc {
  const index: FlexDoc = new Document({
    tokenize: "forward",
    document: {
      id: "id",
      index: ["name", "ecosystem", "version"],
      store: true,
    },
  });

  for (const manifest of manifests) {
    for (const pkg of manifest.packages) {
      const id = `${manifest.ecosystem}:${manifest.file}:${pkg.name}`;
      index.add({ id, name: pkg.name, ecosystem: pkg.ecosystem, version: pkg.version } satisfies PackageDoc);
    }
  }

  return index;
}

function searchIndex(index: FlexDoc, query: string): Set<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = index.search(query, { limit: 1000, enrich: true }) as any[];
  const ids = new Set<string>();
  for (const fieldResult of raw) {
    for (const item of fieldResult.result ?? []) {
      ids.add(item.id as string);
    }
  }
  return ids;
}

interface DependenciesPanelProps {
  entityKind: string;
  entityName: string;
  manifests: Manifest[];
}

export function DependenciesPanel({ entityKind, entityName, manifests }: DependenciesPanelProps) {
  const [query, setQuery] = useState("");
  const [ecosystemFilter, setEcosystemFilter] = useState<string>("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  const index = useMemo(() => buildIndex(manifests), [manifests]);
  const ecosystems = useMemo(() => [...new Set(manifests.map((m) => m.ecosystem))], [manifests]);

  const matchedIds = useMemo(
    () => (query.trim() ? searchIndex(index, query) : null),
    [index, query],
  );

  // Group filtered packages back by manifest, preserving original order,
  // hiding manifests with no surviving packages.
  const groups = manifests
    .map((manifest) => {
      const packages = manifest.packages.filter((pkg) => {
        if (ecosystemFilter && manifest.ecosystem !== ecosystemFilter) return false;
        if (kindFilter !== "all" && packageKind(pkg) !== kindFilter) return false;
        if (matchedIds && !matchedIds.has(`${manifest.ecosystem}:${manifest.file}:${pkg.name}`)) return false;
        return true;
      });
      return { manifest, packages };
    })
    .filter((g) => g.packages.length > 0);

  return (
    <div className="space-y-4">
      <div className="space-y-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, ecosystem, or version…"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {ecosystems.length > 1 && (
            <>
              <button
                onClick={() => setEcosystemFilter("")}
                className={cn(
                  "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  ecosystemFilter === ""
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
                )}
              >
                All ecosystems
              </button>
              {ecosystems.map((eco) => {
                const meta = ECOSYSTEM_META[eco] ?? { label: eco, color: "" };
                return (
                  <button
                    key={eco}
                    onClick={() => setEcosystemFilter(eco)}
                    className={cn(
                      "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                      ecosystemFilter === eco
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
                    )}
                  >
                    {meta.label}
                  </button>
                );
              })}
              <span className="w-px h-4 bg-border mx-1" />
            </>
          )}
          {(Object.keys(KIND_LABEL) as KindFilter[]).map((k) => (
            <button
              key={k}
              onClick={() => setKindFilter(k)}
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                kindFilter === k
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">No packages match this filter.</p>
      ) : (
        <div className="space-y-4">
          {groups.map(({ manifest, packages }) => (
            <div key={`${manifest.ecosystem}-${manifest.file}`} className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <ManifestFileLabel ecosystem={manifest.ecosystem} file={manifest.file} />
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {packages.length} shown
                </span>
              </div>
              {manifest.truncated && (
                <p className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  Showing {manifest.packages.length} of {manifest.total} — search to find a specific package.
                </p>
              )}
              <PackageTable packages={packages} />
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-border pt-4">
        <CompareControl entityKind={entityKind} entityName={entityName} />
      </div>
    </div>
  );
}

interface PackageBump {
  name: string;
  fromVersion: string;
  toVersion: string;
}

// One entry per manifest that actually changed — base and head are matched
// by (ecosystem, file) on the backend before anything inside them is
// compared, so a dependency bumped in one manifest never gets confused with
// a same-named dependency in another (e.g. this repo's own cli/go.mod vs.
// backend/go.mod).
interface ManifestDiff {
  ecosystem: string;
  file: string;
  added: Pkg[];
  removed: Pkg[];
  bumped: PackageBump[];
  baseTruncated: boolean;
  headTruncated: boolean;
}

interface PackageDiff {
  manifests: ManifestDiff[];
}

// Comparing against a release is itself a "browse releases" action — it
// belongs in this data-dense panel, not the glance card. The tag picker
// below is the same ReleasePicker the Releases panel uses (mode="select"),
// so there's one release-picking UX in the app, not two.
function CompareControl({ entityKind, entityName }: { entityKind: string; entityName: string }) {
  const [open, setOpen] = useState(false);
  const [selectedTag, setSelectedTag] = useState("");
  const [diff, setDiff] = useState<PackageDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  async function handleSelectTag(tag: string) {
    setSelectedTag(tag);
    setDiff(null);
    if (!tag) return;
    setDiffLoading(true);
    try {
      const res = await fetch(
        `/api/catalog/entities/${encodeURIComponent(entityKind)}/${encodeURIComponent(entityName)}/packages/compare?ref=${encodeURIComponent(tag)}`,
        { credentials: "include" },
      );
      const data = await res.json();
      setDiff(data.diff ?? { manifests: [] });
    } catch {
      setDiff(null);
    } finally {
      setDiffLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <GitCompare className="h-3.5 w-3.5" /> Compare against a release
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <GitCompare className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Compare current branch against a release</span>
      </div>

      <ReleasePicker
        entityKind={entityKind}
        entityName={entityName}
        mode="select"
        selectedTag={selectedTag}
        onSelect={handleSelectTag}
      />

      {diffLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Comparing…
        </div>
      )}

      {diff && !diffLoading && <DiffResult diff={diff} />}
    </div>
  );
}

function DiffResult({ diff }: { diff: PackageDiff }) {
  if (diff.manifests.length === 0) {
    return <p className="text-xs text-muted-foreground">No dependency changes.</p>;
  }

  const totalAdded = diff.manifests.reduce((sum, m) => sum + m.added.length, 0);
  const totalRemoved = diff.manifests.reduce((sum, m) => sum + m.removed.length, 0);
  const totalBumped = diff.manifests.reduce((sum, m) => sum + m.bumped.length, 0);
  const isMulti = diff.manifests.length > 1;

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-muted-foreground">
        <span className="text-green-600 dark:text-green-400">+{totalAdded}</span>
        {" / "}
        <span className="text-red-600 dark:text-red-400">-{totalRemoved}</span>
        {" / "}
        <span className="text-amber-600 dark:text-amber-400">{totalBumped} bumped</span>
        {isMulti && ` across ${diff.manifests.length} manifests`}
      </p>
      {diff.manifests.map((m) => (
        <ManifestDiffSection key={`${m.ecosystem}-${m.file}`} manifest={m} isMulti={isMulti} />
      ))}
    </div>
  );
}

function ManifestDiffSection({ manifest, isMulti }: { manifest: ManifestDiff; isMulti: boolean }) {
  const truncationWarning = manifest.baseTruncated || manifest.headTruncated;

  return (
    <div className="space-y-1.5">
      {isMulti && <ManifestFileLabel ecosystem={manifest.ecosystem} file={manifest.file} />}
      {truncationWarning && (
        <p className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3" />
          Dependency list truncated on {manifest.baseTruncated && manifest.headTruncated ? "both sides" : manifest.baseTruncated ? "the current branch" : "the release"} — added/removed counts may be incomplete.
        </p>
      )}
      <div className="rounded-md border border-border overflow-hidden text-xs">
        {manifest.added.map((p) => (
          <div key={`add-${p.name}`} className="flex items-center gap-2 px-2.5 py-1 bg-green-50 dark:bg-green-950/20 border-t border-border first:border-t-0">
            <span className="text-green-600 dark:text-green-400 font-mono">+</span>
            <span className="font-mono truncate">{p.name}</span>
            <Badge variant="outline" className="font-mono text-[10px] ml-auto">{p.version}</Badge>
          </div>
        ))}
        {manifest.removed.map((p) => (
          <div key={`rm-${p.name}`} className="flex items-center gap-2 px-2.5 py-1 bg-red-50 dark:bg-red-950/20 border-t border-border first:border-t-0">
            <span className="text-red-600 dark:text-red-400 font-mono">-</span>
            <span className="font-mono truncate">{p.name}</span>
            <Badge variant="outline" className="font-mono text-[10px] ml-auto">{p.version}</Badge>
          </div>
        ))}
        {manifest.bumped.map((b) => (
          <div key={`bump-${b.name}`} className="flex items-center gap-2 px-2.5 py-1 bg-amber-50 dark:bg-amber-950/20 border-t border-border first:border-t-0">
            <span className="text-amber-600 dark:text-amber-400 font-mono">~</span>
            <span className="font-mono truncate">{b.name}</span>
            <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
              {b.fromVersion} → {b.toVersion}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
