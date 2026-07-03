"use client";

import { useEffect, useRef, useState } from "react";
import { Tag, Package, Loader2, ExternalLink, Copy, Check, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ReleasesCardProps {
  entityKind: string;
  entityName: string;
}

interface Release {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  created_at: string;
  prerelease: boolean;
}

interface ContainerImage {
  name: string;
  version: string;
  html_url: string;
  created_at: string;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function parseSemver(v: string): number[] {
  const clean = v.replace(/^v/, "").split("-")[0];
  return clean.split(".").map((n) => parseInt(n, 10) || 0);
}

function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.localeCompare(b);
}

type Env = "dev" | "staging" | "production";

const ENV_META: Record<Env, { label: string; dot: string; text: string; bg: string; border: string }> = {
  dev:        { label: "dev",     dot: "bg-blue-500",  text: "text-blue-700 dark:text-blue-400",   bg: "bg-blue-50 dark:bg-blue-950/20",   border: "border-l-blue-400" },
  staging:    { label: "staging", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/20", border: "border-l-amber-400" },
  production: { label: "prod",    dot: "bg-green-500", text: "text-green-700 dark:text-green-400", bg: "bg-green-50 dark:bg-green-950/20", border: "border-l-green-400" },
};

function tagEnv(version: string): Env | null {
  if (version.startsWith("dev-")) return "dev";
  if (version.startsWith("v") && version.includes("-rc")) return "staging";
  if (version.startsWith("v")) return "production";
  return null;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      title="Copy pull command"
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export function ReleasesCard({ entityKind, entityName }: ReleasesCardProps) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [images, setImages] = useState<ContainerImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllReleases, setShowAllReleases] = useState(false);
  const [showAllImages, setShowAllImages] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    async function fetchReleases() {
      try {
        const res = await fetch(
          `/api/catalog/entities/${encodeURIComponent(entityKind)}/${encodeURIComponent(entityName)}/releases`,
          { credentials: "include" },
        );
        if (!res.ok) return;
        const data = await res.json();
        if (mountedRef.current) {
          setReleases(data.releases ?? []);
          setImages(data.images ?? []);
        }
      } catch { /* ignore */ } finally {
        if (mountedRef.current) setLoading(false);
      }
    }

    fetchReleases();
    return () => { mountedRef.current = false; };
  }, [entityKind, entityName]);

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5" /> Releases
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

  const sortedImages = images
    .filter((img) => !img.version.toLowerCase().startsWith("sha256"))
    .sort((a, b) => compareSemver(b.version, a.version));

  if (releases.length === 0 && sortedImages.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5" /> Releases
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No releases or container images yet.</p>
        </CardContent>
      </Card>
    );
  }

  const latest = releases[0];
  const olderReleases = releases.slice(1);
  const previewImages = sortedImages.slice(0, 1);
  const restImages = sortedImages.slice(1);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Tag className="h-3.5 w-3.5" /> Releases
          <span className="ml-auto text-[10px] font-normal">
            {releases.length} release{releases.length !== 1 ? "s" : ""}
            {sortedImages.length > 0 && ` · ${sortedImages.length} image${sortedImages.length !== 1 ? "s" : ""}`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Latest release — always visible */}
        {latest && (
          <div className="rounded-md border border-border bg-muted/20 p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge className="font-mono text-xs">{latest.tag_name}</Badge>
              {latest.prerelease && (
                <span className="text-[10px] rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 font-medium">
                  pre-release
                </span>
              )}
              <span className="text-xs text-muted-foreground ml-auto">{formatDate(latest.created_at)}</span>
            </div>
            {latest.name && latest.name !== latest.tag_name && (
              <p className="text-sm font-medium">{latest.name}</p>
            )}
            {latest.body && (
              <p className="text-xs text-muted-foreground line-clamp-2">{latest.body}</p>
            )}
            <a
              href={latest.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> View release
            </a>
          </div>
        )}

        {/* Older releases — collapsed */}
        {olderReleases.length > 0 && (
          <div className="space-y-1.5">
            {showAllReleases && olderReleases.map((r) => (
              <a
                key={r.tag_name}
                href={r.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs hover:bg-muted/30 rounded-md px-2 py-1.5 transition-colors"
              >
                <span className="font-mono font-medium text-foreground">{r.tag_name}</span>
                {r.prerelease && (
                  <span className="text-[9px] rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 px-1 py-0.5">pre</span>
                )}
                <span className="text-muted-foreground ml-auto">{formatDate(r.created_at)}</span>
              </a>
            ))}
            <button
              onClick={() => setShowAllReleases(!showAllReleases)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full justify-center"
            >
              {showAllReleases ? (
                <><ChevronUp className="h-3 w-3" /> Hide previous releases</>
              ) : (
                <><ChevronDown className="h-3 w-3" /> Show {olderReleases.length} previous release{olderReleases.length !== 1 ? "s" : ""}</>
              )}
            </button>
          </div>
        )}

        {/* Container images — show 1 by default */}
        {images.length > 0 && (
          <div className="space-y-1.5 border-t border-border pt-3">
            <div className="flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-medium text-muted-foreground">Container Images</p>
            </div>
            {[...previewImages, ...(showAllImages ? restImages : [])].map((img, i) => {
              const env = tagEnv(img.version);
              const meta = env ? ENV_META[env] : null;
              return (
                <div
                  key={`${img.name}-${img.version}-${i}`}
                  className={`flex items-center gap-2 rounded-md border border-border border-l-2 px-2.5 py-1.5 ${meta ? `${meta.border} ${meta.bg}` : ""}`}
                >
                  {meta && (
                    <span className={`shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${meta.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                      {meta.label}
                    </span>
                  )}
                  <span className="font-mono text-xs text-foreground truncate flex-1">
                    {img.name}:{img.version}
                  </span>
                  <CopyButton text={`docker pull ${img.name}:${img.version}`} />
                  {img.html_url && (
                    <a href={img.html_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              );
            })}
            {restImages.length > 0 && (
              <button
                onClick={() => setShowAllImages(!showAllImages)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full justify-center"
              >
                {showAllImages ? (
                  <><ChevronUp className="h-3 w-3" /> Show less</>
                ) : (
                  <><ChevronDown className="h-3 w-3" /> Show {restImages.length} more image{restImages.length !== 1 ? "s" : ""}</>
                )}
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
