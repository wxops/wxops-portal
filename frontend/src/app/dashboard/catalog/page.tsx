import { cookies } from "next/headers";
import Link from "next/link";
import { BookOpen, Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
    domain?: string;
    lifecycle?: string;
    type?: string;
    system?: string;
  };
}

async function fetchAllEntities(
  cookie: string,
): Promise<{ entities: Entity[]; error?: string }> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/catalog/entities`, {
      headers: { Cookie: `wxops_session=${cookie}` },
      cache: "no-store",
    });
    if (!res.ok) return { entities: [], error: await res.text() };
    return res.json();
  } catch {
    return { entities: [], error: "Backend unreachable" };
  }
}

export default async function CatalogPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get("wxops_session")?.value ?? "";

  const { entities, error } = await fetchAllEntities(session);

  const systems = entities.filter((e) => e.kind === "System");
  const components = entities.filter((e) => e.kind === "Component");

  // Count components per system for the cards
  const componentCount: Record<string, number> = {};
  for (const c of components) {
    const sys = c.spec.system ?? "__ungrouped__";
    componentCount[sys] = (componentCount[sys] ?? 0) + 1;
  }

  // Components with no system — surface them as standalone
  const ungrouped = components.filter((c) => !c.spec.system);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Service Catalog</h1>
        <p className="text-muted-foreground mt-1">
          Select an application to explore its services, APIs, and resources.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {error.includes("GITEA_URL") || error.includes("configured") ? (
            <>
              Catalog source not configured.{" "}
              <span className="font-medium">
                Set CATALOG_LOCAL_DIR for local testing, or GITEA_URL +
                GITEA_TOKEN + GITEA_CATALOG_OWNER + GITEA_CATALOG_REPO for
                production.
              </span>
            </>
          ) : (
            <>Failed to load catalog: {error}</>
          )}
        </div>
      )}

      {!error && systems.length === 0 && ungrouped.length === 0 && (
        <div className="rounded-md border border-dashed px-6 py-12 text-center text-muted-foreground">
          <BookOpen className="mx-auto h-8 w-8 mb-3 opacity-40" />
          <p className="text-sm">No catalog entries yet.</p>
          <p className="text-xs mt-1">
            Add YAML files to{" "}
            <code className="bg-muted px-1 py-0.5 rounded">
              gitops-infra/catalog/systems/
            </code>
          </p>
        </div>
      )}

      {/* Systems — primary application list */}
      {systems.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {systems.map((sys) => {
            const count = componentCount[sys.metadata.name] ?? 0;
            return (
              <Link
                key={sys.metadata.name}
                href={`/dashboard/catalog/systems/${sys.metadata.name}`}
                className="block group"
              >
                <Card className="flex flex-col h-full transition-colors group-hover:border-primary/50 group-hover:bg-muted/30">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <CardTitle className="text-base truncate">
                          {sys.metadata.title ?? sys.metadata.name}
                        </CardTitle>
                      </div>
                      {sys.spec.domain && (
                        <Badge variant="outline" className="shrink-0 text-xs">
                          {sys.spec.domain}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs font-mono text-muted-foreground mt-0.5">
                      {sys.metadata.name}
                    </p>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-3">
                    {sys.metadata.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {sys.metadata.description}
                      </p>
                    )}
                    <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
                      {sys.spec.owner && <span>{sys.spec.owner}</span>}
                      <span className="ml-auto">
                        {count} service{count !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* Ungrouped components — components with no system */}
      {ungrouped.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Ungrouped Services
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ungrouped.map((c) => (
              <Link
                key={c.metadata.name}
                href={`/dashboard/catalog/Component/${c.metadata.name}`}
                className="block group"
              >
                <Card className="flex flex-col h-full transition-colors group-hover:border-primary/50 group-hover:bg-muted/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      {c.metadata.title ?? c.metadata.name}
                    </CardTitle>
                    <p className="text-xs font-mono text-muted-foreground">
                      {c.metadata.name}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {c.metadata.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {c.metadata.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {c.spec.type && (
                        <Badge variant="secondary" className="text-xs">
                          {c.spec.type}
                        </Badge>
                      )}
                      {c.spec.owner && <span>{c.spec.owner}</span>}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
