import Link from "next/link";
import { Rocket, Import } from "lucide-react";

export default function ScaffoldPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Project Scaffold</h1>
        <p className="text-muted-foreground mt-1">
          Create a new project from a template or import an existing repository
          into the service catalog.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/dashboard/scaffold/new" className="block group">
          <div className="rounded-xl border border-dashed border-border p-8 text-center transition-colors group-hover:border-primary/50 group-hover:bg-muted/30">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-wxops-purple/10">
              <Rocket className="h-6 w-6 text-wxops-purple" />
            </div>
            <p className="font-medium">Create New Project</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick a team, choose a template, configure your app
            </p>
          </div>
        </Link>

        <Link href="/dashboard/scaffold/import" className="block group">
          <div className="rounded-xl border border-dashed border-border p-8 text-center transition-colors group-hover:border-primary/50 group-hover:bg-muted/30">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/10">
              <Import className="h-6 w-6 text-blue-500" />
            </div>
            <p className="font-medium">Import Existing Project</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add an existing Gitea repo to the service catalog
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}
