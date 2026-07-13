import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft, ExternalLink, FileText, GitBranch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocViewer } from "@/components/catalog/doc-viewer";
import { slugifyHeading } from "@/lib/doc-utils";
import { DocToc, type TocItem } from "@/components/catalog/doc-toc";
import { ScrollToTop } from "@/components/catalog/scroll-to-top";
import { EntityActions } from "@/components/catalog/entity-actions";
import { getSession } from "@/lib/session";
import type { Entity } from "@/lib/types";

function extractToc(md: string): TocItem[] {
  const lines = md.split("\n");
  const items: TocItem[] = [];
  const counts: Record<string, number> = {};
  let inCode = false;

  for (const line of lines) {
    if (line.startsWith("```")) { inCode = !inCode; continue; }
    if (inCode) continue;
    const m = line.match(/^(#{1,4})\s+(.+)$/);
    if (!m) continue;
    const level = m[1].length;
    // Strip inline markdown from the display text
    const text = m[2].trim().replace(/[*_`~]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    const base = slugifyHeading(text);
    counts[base] = (counts[base] ?? 0) + 1;
    const id = counts[base] === 1 ? base : `${base}-${counts[base] - 1}`;
    items.push({ level, text, id });
  }
  return items;
}

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

interface DocEntity {
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    title?: string;
    description?: string;
    tags?: string[];
    links?: { url: string; title?: string; type?: string }[];
    annotations?: Record<string, string>;
  };
  spec: {
    owner?: string;
    system?: string;
    docType?: string;
    docStatus?: string;
    supersededBy?: string;
    relatedTo?: string[];
    author?: string;
    contentUrl?: string;
  };
}

async function fetchDoc(
  cookie: string,
  name: string,
): Promise<{ entity: DocEntity | null; error?: string }> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/v1/catalog/entities/Doc/${name}`,
      { headers: { Cookie: `wxops_session=${cookie}` }, cache: "no-store" },
    );
    if (res.status === 404) return { entity: null, error: "Document not found" };
    if (!res.ok) return { entity: null, error: await res.text() };
    return { entity: await res.json() };
  } catch {
    return { entity: null, error: "Backend unreachable" };
  }
}

async function fetchDocContent(
  cookie: string,
  name: string,
): Promise<{ content: string | null; contentError?: string }> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/v1/catalog/entities/Doc/${name}/content`,
      { headers: { Cookie: `wxops_session=${cookie}` }, cache: "no-store" },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let msg = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(body);
        if (j.error) msg = j.error;
      } catch { /* not JSON */ }
      return { content: null, contentError: msg };
    }
    return { content: await res.text() };
  } catch (err) {
    return { content: null, contentError: String(err) };
  }
}

const docTypeBadge: Record<string, string> = {
  rfc: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  adr: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  runbook: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  documentation: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
};

const statusBadge: Record<string, string> = {
  proposed:      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  "under-review":"bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  accepted:      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  deprecated:    "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  superseded:    "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

function refName(ref: string): string {
  const afterColon = ref.includes(":") ? ref.split(":")[1] : ref;
  return afterColon.includes("/") ? afterColon.split("/").pop()! : afterColon;
}

function refKind(ref: string): string {
  return ref.includes(":") ? ref.split(":")[0] : "component";
}

export default async function DocDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const cookieStore  = await cookies();
  const session      = cookieStore.get("wxops_session")?.value ?? "";

  const [{ entity, error }, { content, contentError }, userSession] = await Promise.all([
    fetchDoc(session, name),
    fetchDocContent(session, name),
    getSession(),
  ]);
  const userGroups = userSession?.groups ?? [];
  const tocItems = content ? extractToc(content) : [];

  if (error || !entity) {
    return (
      <div className="space-y-4">
        <Link
          href="/dashboard/catalog"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Catalog
        </Link>
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {error ?? "Document not found"}
        </div>
      </div>
    );
  }

  const displayTitle = entity.metadata.title ?? entity.metadata.name;
  const docType      = entity.spec.docType ?? "documentation";
  const docStatus    = entity.spec.docStatus ?? "proposed";
  const giteaLink    = entity.metadata.links?.find(
    (l) => l.type === "gitea" || l.url.includes("gitea"),
  );

  return (
    <div className="space-y-6">

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/dashboard/catalog" className="hover:text-foreground">
          Catalog
        </Link>
        {entity.spec.system && (
          <>
            <span>/</span>
            <Link
              href={`/dashboard/catalog/systems/${entity.spec.system}`}
              className="hover:text-foreground"
            >
              {entity.spec.system}
            </Link>
          </>
        )}
        <span>/</span>
        <span className="text-foreground font-medium">{entity.metadata.name}</span>
      </nav>

      {/* Header */}
      <div className="rounded-lg border bg-card p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${docTypeBadge[docType] ?? "bg-muted text-muted-foreground"}`}
          >
            {docType}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge[docStatus] ?? "bg-muted text-muted-foreground"}`}
          >
            {docStatus}
          </span>
          <div className="ml-auto">
            <EntityActions entity={entity as unknown as Entity} userGroups={userGroups} />
          </div>
        </div>

        <h1 className="text-xl font-bold leading-tight">{displayTitle}</h1>
        {entity.metadata.title && (
          <p className="text-xs font-mono text-muted-foreground">
            {entity.metadata.name}
          </p>
        )}
        {entity.metadata.description && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {entity.metadata.description}
          </p>
        )}

        {/* Meta strip */}
        <div className="border-t pt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {entity.spec.owner && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-muted-foreground">Owner</span>
              <Link
                href={`/dashboard/catalog/groups/${refName(entity.spec.owner)}`}
                className="font-mono text-primary hover:underline"
              >
                {entity.spec.owner}
              </Link>
            </div>
          )}
          {entity.spec.author && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-muted-foreground">Author</span>
              <Link
                href={`/dashboard/catalog/users/${refName(entity.spec.author)}`}
                className="font-mono text-primary hover:underline"
              >
                {entity.spec.author}
              </Link>
            </div>
          )}
          {entity.spec.system && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-muted-foreground">System</span>
              <Link
                href={`/dashboard/catalog/systems/${entity.spec.system}`}
                className="font-mono text-primary hover:underline"
              >
                {entity.spec.system}
              </Link>
            </div>
          )}
        </div>

        {/* Tags */}
        {(entity.metadata.tags ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {entity.metadata.tags!.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Sidebar + content + ToC layout */}
      <div className="grid gap-6 lg:grid-cols-[240px_1fr] xl:grid-cols-[240px_1fr_220px] items-start">

        {/* Sidebar */}
        <div className="space-y-3 lg:sticky lg:top-6">

          {/* Gitea link */}
          {(entity.spec.contentUrl || giteaLink) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Source
                </CardTitle>
              </CardHeader>
              <CardContent>
                <a
                  href={giteaLink?.url ?? entity.spec.contentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <GitBranch className="h-3.5 w-3.5 shrink-0" />
                  {giteaLink?.title ?? "Review on Gitea"}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              </CardContent>
            </Card>
          )}

          {/* Decision chain */}
          {entity.spec.supersededBy && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Decision Chain
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Superseded by</p>
                <Link
                  href={`/dashboard/catalog/Doc/${refName(entity.spec.supersededBy)}`}
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline font-mono"
                >
                  {refName(entity.spec.supersededBy)}
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Related entities */}
          {(entity.spec.relatedTo ?? []).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Related To
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {entity.spec.relatedTo!.map((ref) => {
                  const kind = refKind(ref);
                  const n    = refName(ref);
                  const href = kind.toLowerCase() === "doc"
                    ? `/dashboard/catalog/Doc/${n}`
                    : `/dashboard/catalog/${kind.charAt(0).toUpperCase() + kind.slice(1)}/${n}`;
                  return (
                    <Link
                      key={ref}
                      href={href}
                      className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                    >
                      <span className="text-[10px] font-mono text-muted-foreground uppercase">
                        {kind}
                      </span>
                      <span className="font-mono">{n}</span>
                    </Link>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Other links */}
          {(entity.metadata.links ?? []).filter((l) => l.type !== "gitea").length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Links
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {entity.metadata.links!
                  .filter((l) => l.type !== "gitea")
                  .map((l) => (
                    <a
                      key={l.url}
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      {l.title ?? l.url}
                    </a>
                  ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Markdown content */}
        <div className="rounded-lg border bg-card min-w-0 min-h-[70vh]">
          {content ? (
            <div className="px-10 py-8 lg:px-14 lg:py-10">
              <DocViewer content={content} />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center min-h-[40vh] px-6 py-10 text-center text-sm text-muted-foreground">
              <FileText className="h-8 w-8 text-muted-foreground/40 mb-3" />
              <p>Content not available.</p>
              {contentError && (
                <p className="text-xs mt-1 font-mono text-red-500 dark:text-red-400">
                  {contentError}
                </p>
              )}
              {!contentError && (
                <p className="text-xs mt-1 text-muted-foreground/60">
                  Set a <code className="font-mono">contentUrl</code> pointing to a markdown file
                  (relative path or absolute URL).
                </p>
              )}
              {entity.spec.contentUrl && (
                <a
                  href={entity.spec.contentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-3 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open raw source
                </a>
              )}
            </div>
          )}
        </div>

        {/* Table of Contents — right column, xl screens only */}
        <DocToc items={tocItems} />
      </div>

      <ScrollToTop />
    </div>
  );
}
