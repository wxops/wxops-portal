import { requireSession } from "@/lib/session";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Shield, Server } from "lucide-react";

export default async function SettingsPage() {
  const session = await requireSession();

  return (
    <div className="space-y-8 max-w-2xl">

      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Portal preferences and runtime configuration.
        </p>
      </div>

      {/* Appearance */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          Appearance
        </h2>
        <div className="rounded-xl border bg-card p-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Theme</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Switch between light and dark mode.
            </p>
          </div>
          <ThemeToggle />
        </div>
      </section>

      {/* Account */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          Account
        </h2>
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Username</span>
            <span className="font-medium">{session.username}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Subject</span>
            <span className="font-mono text-xs text-muted-foreground truncate max-w-[260px]">
              {session.sub}
            </span>
          </div>
          <div className="flex items-start justify-between text-sm gap-4">
            <span className="text-muted-foreground shrink-0">Groups</span>
            <div className="flex flex-wrap gap-1.5 justify-end">
              {(session.groups ?? []).map((g) => (
                <Badge
                  key={g}
                  variant="secondary"
                  className="bg-wxops-purple/10 text-wxops-purple border-wxops-purple/25 text-xs"
                >
                  {g}
                </Badge>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground border-t">
            <Shield className="h-3.5 w-3.5 text-wxops-green" />
            Identity verified via OIDC
            <Server className="h-3.5 w-3.5 ml-1" />
            Kubernetes RBAC enforced via Pinniped
          </div>
        </div>
      </section>

    </div>
  );
}
