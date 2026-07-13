"use client";

import { useState } from "react";
import { Terminal, Check, Copy, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Entity } from "@/lib/types";

function CopyableCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="group relative rounded-md border border-border bg-muted/40 px-3 py-2 pr-9 font-mono text-xs leading-relaxed break-all">
      {code}
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-1.5 top-1.5 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground hover:bg-muted"
        title="Copy"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function Section({ title, children, defaultOpen = true }: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-widest hover:text-foreground transition-colors"
      >
        {open
          ? <ChevronDown className="h-3 w-3" />
          : <ChevronRight className="h-3 w-3" />
        }
        {title}
      </button>
      {open && <div className="space-y-1.5 pl-1">{children}</div>}
    </div>
  );
}

interface DarlanePanelProps {
  entity: Entity;
}

export function DarlanePanel({ entity }: DarlanePanelProps) {
  const annotations = entity.metadata.annotations ?? {};

  // Derive namespace from spec.owner (e.g. "group:rocket-team" → "tenant-rocket-team")
  const rawOwner = (entity.spec?.owner ?? "").replace(/^group:/, "");
  const team = rawOwner.split(":")[0]; // strip sub-group suffix like ":Managers"
  const namespace = team === "platform-team" ? "platform" : `tenant-${team}`;

  const appName = entity.metadata.name;
  const devDeploy = `${appName}-dev`;
  const port = annotations["wxops.cloud/container-port"] ?? "8080";

  const [showMirrord, setShowMirrord] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-wxops-green/10">
            <Terminal className="h-4 w-4 text-wxops-green" />
          </div>
          Debug Locally
          <span className="ml-auto rounded-full bg-wxops-green/10 px-2 py-0.5 text-[10px] font-medium text-wxops-green">
            Darlane
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Parallel pod in <span className="font-mono">{namespace}</span> — same secrets, same DB, zero external exposure.
        </p>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">

        {/* Scale controls */}
        <Section title="Pod lifecycle">
          <div className="grid grid-cols-2 gap-1.5">
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground/70 font-mono uppercase tracking-widest">Scale up</p>
              <CopyableCode
                code={`kubectl -n ${namespace} scale deployment/${devDeploy} --replicas=1`}
              />
            </div>
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground/70 font-mono uppercase tracking-widest">Scale down</p>
              <CopyableCode
                code={`kubectl -n ${namespace} scale deployment/${devDeploy} --replicas=0`}
              />
            </div>
          </div>
        </Section>

        {/* Exec + port-forward */}
        <Section title="Connect">
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground/70 font-mono uppercase tracking-widest">Exec (bash)</p>
            <CopyableCode
              code={`kubectl -n ${namespace} exec -it deployment/${devDeploy} -- bash`}
            />
          </div>
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground/70 font-mono uppercase tracking-widest">Port-forward</p>
            <CopyableCode
              code={`kubectl -n ${namespace} port-forward deployment/${devDeploy} ${port}:${port}`}
            />
          </div>
        </Section>

        {/* Traffic mirroring — collapsible advanced section */}
        <div className="border-t pt-3">
          <button
            type="button"
            onClick={() => setShowMirrord((v) => !v)}
            className={cn(
              "flex w-full items-center justify-between text-xs font-medium transition-colors",
              showMirrord ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="flex items-center gap-1.5">
              {showMirrord ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Traffic mirroring (mirrord)
            </span>
            <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
              optional
            </span>
          </button>

          {showMirrord && (
            <div className="mt-2 space-y-1.5 pl-1">
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Copies real traffic into your Darlane pod. Your code handles actual requests — production users are unaffected.
              </p>
              <CopyableCode
                code={`mirrord exec \\\n  --target deployment/${devDeploy} \\\n  --target-namespace ${namespace} \\\n  -- <your-start-command>`}
              />
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                Requires <span className="font-mono">mirrord</span> CLI installed locally.
                Mirror mode is safe in all environments.
              </p>
            </div>
          )}
        </div>

      </CardContent>
    </Card>
  );
}
