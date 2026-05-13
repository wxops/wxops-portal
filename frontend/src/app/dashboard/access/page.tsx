import { cookies } from "next/headers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, User, Key, Terminal, Users, Download } from "lucide-react";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

interface WhoAmIResponse {
  username: string;
  uid: string;
  groups: string[];
}

async function fetchWhoAmI(
  cookie: string
): Promise<{ data?: WhoAmIResponse; error?: string }> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/k8s/whoami`, {
      headers: { Cookie: `wxops_session=${cookie}` },
      cache: "no-store",
    });
    if (!res.ok) return { error: await res.text() };
    return { data: await res.json() };
  } catch {
    return { error: "Backend unreachable" };
  }
}

export default async function AccessPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("wxops_session")?.value ?? "";
  const { data: whoAmI, error } = await fetchWhoAmI(sessionCookie);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">K8s Access</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your Kubernetes identity via Pinniped and cluster access credentials
        </p>
      </div>

      {/* ── K8s Identity ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-wxops-purple" />
            <CardTitle>Kubernetes Identity</CardTitle>
          </div>
          <CardDescription>
            Your identity as mapped by Pinniped&apos;s JWTAuthenticator on the cluster.
            The OIDC token is validated and your email becomes your k8s username.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive space-y-1">
              <p>{error}</p>
              <p className="text-xs text-muted-foreground">
                Ensure KUBE_API_SERVER is configured and the cluster is reachable.
              </p>
            </div>
          ) : whoAmI ? (
            <dl className="space-y-4">
              <div className="flex items-start gap-3">
                <User className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <dt className="text-xs text-muted-foreground">Username</dt>
                  <dd className="font-mono text-sm mt-0.5">{whoAmI.username}</dd>
                </div>
              </div>

              {whoAmI.uid && (
                <div className="flex items-start gap-3">
                  <Key className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <dt className="text-xs text-muted-foreground">UID</dt>
                    <dd className="font-mono text-sm mt-0.5">{whoAmI.uid}</dd>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3">
                <Users className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <dt className="text-xs text-muted-foreground mb-1.5">Groups</dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {(whoAmI.groups ?? []).map((g) => (
                      <Badge
                        key={g}
                        variant="outline"
                        className="text-xs border-wxops-purple/30 text-wxops-purple"
                      >
                        {g}
                      </Badge>
                    ))}
                    {(whoAmI.groups ?? []).length === 0 && (
                      <span className="text-xs text-muted-foreground">No groups</span>
                    )}
                  </dd>
                </div>
              </div>
            </dl>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Kubeconfig Download ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-wxops-cyan" />
            <CardTitle>Kubeconfig</CardTitle>
          </div>
          <CardDescription>
            Download a kubeconfig that uses your current OIDC token as a Bearer credential.
            Valid for 24 hours (one session).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            After downloading, set <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">KUBECONFIG</code> to
            the file path or pass <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">--kubeconfig</code> to kubectl.
          </p>

          <a
            href="/api/v1/k8s/kubeconfig"
            download
            className="inline-flex items-center gap-2 bg-wxops-purple text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-wxops-purple/90 transition-colors"
          >
            <Download className="h-4 w-4" />
            Download kubeconfig
          </a>

          <div className="rounded-md bg-muted/50 p-3 font-mono text-xs space-y-1 text-muted-foreground">
            <p># Use the downloaded kubeconfig</p>
            <p className="text-foreground">
              kubectl get namespaces --kubeconfig ./kubeconfig-wxops.yaml
            </p>
            <p className="pt-1"># Or export for all commands</p>
            <p className="text-foreground">
              export KUBECONFIG=./kubeconfig-wxops.yaml
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Pinniped CLI ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-wxops-green" />
            <CardTitle>Pinniped CLI (auto-refresh)</CardTitle>
          </div>
          <CardDescription>
            Use <code className="font-mono text-xs">pinniped get kubeconfig</code> to generate
            a kubeconfig that automatically refreshes credentials through Dex.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The Pinniped CLI acts as a kubectl exec-credential plugin. When your token
            expires, kubectl will trigger a browser-based re-login automatically.
          </p>

          <div className="rounded-md bg-muted/50 p-3 font-mono text-xs space-y-1">
            <p className="text-muted-foreground"># Install Pinniped CLI (macOS / Linux)</p>
            <p>brew install pinniped-cli</p>
            <p className="pt-2 text-muted-foreground"># Or download directly</p>
            <p>
              curl -Lso pinniped https://get.pinniped.dev/latest/pinniped-cli-linux-amd64
            </p>
            <p>chmod +x pinniped &amp;&amp; sudo mv pinniped /usr/local/bin/</p>
          </div>

          <div className="rounded-md bg-muted/50 p-3 font-mono text-xs space-y-1">
            <p className="text-muted-foreground">
              # Generate a self-refreshing kubeconfig (requires an admin kubeconfig)
            </p>
            <p>
              pinniped get kubeconfig \
            </p>
            <p className="pl-4 text-muted-foreground/80">
              --kubeconfig ./admin-kubeconfig.yaml \
            </p>
            <p className="pl-4 text-muted-foreground/80">
              --pinniped-cli-path=pinniped \
            </p>
            <p className="pl-4">&gt; pinniped-kubeconfig.yaml</p>
            <p className="pt-2 text-muted-foreground"># Then use it</p>
            <p>kubectl get namespaces --kubeconfig ./pinniped-kubeconfig.yaml</p>
          </div>

          <p className="text-xs text-muted-foreground">
            See{" "}
            <a
              href="https://pinniped.dev/docs/howto/login/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-wxops-cyan transition-colors"
            >
              pinniped.dev/docs/howto/login
            </a>{" "}
            for the full guide.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
