import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

interface Entity {
  kind: string;
  metadata: {
    name: string;
    title?: string;
    description?: string;
    tags?: string[];
  };
  spec: {
    owner?: string;
    system?: string;
    type?: string;
    memberOf?: string[];
    email?: string;
    docType?: string;
    docStatus?: string;
    author?: string;
  };
}

async function fetchAll(cookie: string): Promise<Entity[]> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/catalog/entities`, {
      headers: { Cookie: `wxops_session=${cookie}` },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.entities ?? [];
  } catch {
    return [];
  }
}

function refName(ref: string): string {
  const afterColon = ref.includes(":") ? ref.split(":")[1] : ref;
  return afterColon.includes("/") ? afterColon.split("/").pop()! : afterColon;
}

const docTypeBadge: Record<string, string> = {
  rfc:           "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  adr:           "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  documentation: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
};

const docStatusColors: Record<string, string> = {
  proposed:      "text-amber-600",
  "under-review":"text-blue-600",
  accepted:      "text-green-600",
  deprecated:    "text-gray-500",
  superseded:    "text-orange-500",
};

function DocCard({ doc }: { doc: Entity }) {
  const docType   = doc.spec.docType ?? "documentation";
  const docStatus = doc.spec.docStatus ?? "proposed";
  return (
    <Link href={`/dashboard/catalog/Doc/${doc.metadata.name}`} className="block group">
      <Card className="flex flex-col h-full transition-colors group-hover:border-primary/50 group-hover:bg-muted/30">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm font-medium leading-snug">
              {doc.metadata.title ?? doc.metadata.name}
            </CardTitle>
            <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${docTypeBadge[docType] ?? "bg-muted text-muted-foreground"}`}>
              {docType}
            </span>
          </div>
          {doc.spec.system && (
            <p className="text-xs font-mono text-muted-foreground">{doc.spec.system}</p>
          )}
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-1.5">
          {doc.metadata.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">{doc.metadata.description}</p>
          )}
          <span className={`text-xs font-medium mt-auto ${docStatusColors[docStatus] ?? "text-muted-foreground"}`}>
            {docStatus}
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name }    = await params;
  const cookieStore = await cookies();
  const session     = cookieStore.get("wxops_session")?.value ?? "";

  const entities = await fetchAll(session);

  const user = entities.find(
    (e) => e.kind === "User" && e.metadata.name === name,
  );

  const memberOfNames = (user?.spec.memberOf ?? []).map(refName);
  const groups = entities.filter(
    (e) => e.kind === "Group" && memberOfNames.includes(e.metadata.name),
  );

  const userRef = `user:${name}`;
  const authoredDocs = entities.filter(
    (e) => e.kind === "Doc" && e.spec.author === userRef,
  );

  const rfcs          = authoredDocs.filter((d) => d.spec.docType === "rfc");
  const adrs          = authoredDocs.filter((d) => d.spec.docType === "adr");
  const documentation = authoredDocs.filter((d) => !d.spec.docType || d.spec.docType === "documentation");

  const displayName = user?.metadata.title ?? user?.metadata.name ?? name;
  const initials    = displayName
    .split(" ")
    .map((w: string) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="space-y-8 max-w-4xl">

      <Link
        href="/dashboard/catalog"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Catalog
      </Link>

      {/* Header */}
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
            {initials}
          </div>
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary">User</Badge>
            </div>
            <h1 className="text-xl font-bold">{displayName}</h1>
            <p className="text-sm font-mono text-muted-foreground">@{name}</p>
            {user?.spec.email && (
              <a
                href={`mailto:${user.spec.email}`}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <Mail className="h-3.5 w-3.5" />
                {user.spec.email}
              </a>
            )}
          </div>
        </div>

        {user?.metadata.description && (
          <p className="text-sm text-muted-foreground mt-4 leading-relaxed">
            {user.metadata.description}
          </p>
        )}

        {/* Member of */}
        {groups.length > 0 && (
          <div className="mt-4 pt-4 border-t flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Member of</span>
            {groups.map((g) => (
              <Link
                key={g.metadata.name}
                href={`/dashboard/catalog/groups/${g.metadata.name}`}
                className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium hover:bg-muted transition-colors"
              >
                {g.metadata.title ?? g.metadata.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Authored documents */}
      {authoredDocs.length > 0 && (
        <div className="space-y-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Authored Documents
          </h2>

          {rfcs.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-violet-700 dark:text-violet-400 uppercase tracking-wider">RFCs</span>
                <span className="text-xs text-muted-foreground">({rfcs.length})</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {rfcs.map((d) => <DocCard key={d.metadata.name} doc={d} />)}
              </div>
            </section>
          )}

          {adrs.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider">ADRs</span>
                <span className="text-xs text-muted-foreground">({adrs.length})</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {adrs.map((d) => <DocCard key={d.metadata.name} doc={d} />)}
              </div>
            </section>
          )}

          {documentation.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Documentation</span>
                <span className="text-xs text-muted-foreground">({documentation.length})</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {documentation.map((d) => <DocCard key={d.metadata.name} doc={d} />)}
              </div>
            </section>
          )}
        </div>
      )}

      {authoredDocs.length === 0 && user && (
        <div className="rounded-md border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          No documents authored by {displayName} yet.
        </div>
      )}

      {!user && (
        <div className="rounded-md border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          User <code className="font-mono">{name}</code> not found in catalog.
        </div>
      )}
    </div>
  );
}
