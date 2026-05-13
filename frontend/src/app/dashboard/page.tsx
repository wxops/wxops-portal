import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Server, Users, FolderOpen } from "lucide-react";

export default async function DashboardPage() {
  const session = await requireSession();
  const groups = session.groups ?? [];

  const stats = [
    { label: "Groups", value: groups.length, icon: Users, color: "text-wxops-purple" },
    { label: "Clusters", value: "1", icon: Server, color: "text-wxops-cyan" },
    { label: "Namespaces", value: "—", icon: FolderOpen, color: "text-purple-400" },
    { label: "RBAC Status", value: "Active", icon: Shield, color: "text-green-400" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back,{" "}
          <span className="text-gradient">{session.username}</span>
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Identity verified via OIDC · Kubernetes RBAC enforced via Pinniped
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="border-border bg-card hover:border-wxops-purple/40 transition-colors">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {s.label}
              </CardTitle>
              <s.icon className={`h-4 w-4 ${s.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Identity card */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Identity &amp; Groups</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <span className="text-muted-foreground">Username</span>
            <span className="font-medium">{session.username}</span>
            <span className="text-muted-foreground">Subject</span>
            <span className="font-mono text-xs text-muted-foreground truncate">{session.sub}</span>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-2">Group memberships (from Dex)</p>
            <div className="flex flex-wrap gap-2">
              {groups.length > 0 ? (
                groups.map((g) => (
                  <Badge key={g} variant="secondary" className="bg-wxops-purple/15 text-wxops-purple border-wxops-purple/30">
                    {g}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">No groups assigned</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
