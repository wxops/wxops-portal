"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  RefreshCw,
  KeyRound,
  Database,
  ShieldCheck,
  Lock,
  Globe,
  Plug,
  Activity,
} from "lucide-react";
import type { WizardState } from "./project-wizard";
import { KeyValueEditor } from "./key-value-editor";
import type { KVPair } from "./key-value-editor";

interface StepAppConfigProps {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  isPlatformTeam?: boolean;
}

const DB_EXTENSIONS = [
  { value: "uuid-ossp", label: "uuid-ossp", description: "Generate universally unique identifiers (UUIDs)" },
  { value: "pgcrypto", label: "pgcrypto", description: "Cryptographic functions — hashing, encryption, random bytes" },
  { value: "pgvector", label: "pgvector", description: "Vector similarity search for AI/ML embeddings" },
  { value: "postgis", label: "PostGIS", description: "Geospatial objects and queries (geometry, geography)" },
  { value: "pg_trgm", label: "pg_trgm", description: "Trigram-based fuzzy text matching and similarity search" },
  { value: "hstore", label: "hstore", description: "Key-value store inside a single PostgreSQL column" },
  { value: "citext", label: "citext", description: "Case-insensitive text data type" },
  { value: "pg_stat_statements", label: "pg_stat_statements", description: "Track query execution statistics for performance tuning" },
];


const APP_FLAVORS = [
  { value: "webapp", label: "Web App", description: "Standard web application (API + frontend)" },
  { value: "ai", label: "AI / ML", description: "Machine learning or AI inference workload" },
  { value: "ai-webapp", label: "AI Web App", description: "Web application with AI/ML capabilities" },
  { value: "geo-webapp", label: "Geo Web App", description: "Location-aware web application" },
  { value: "search-webapp", label: "Search Web App", description: "Web application with search functionality" },
];

type Tab = "essentials" | "advanced";

export function StepAppConfig({ state, onChange, isPlatformTeam }: StepAppConfigProps) {
  const [tab, setTab] = useState<Tab>("essentials");

  return (
    <div className="space-y-5">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
        {(["essentials", "advanced"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors capitalize",
              tab === t
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "essentials" ? (
        <EssentialsTab state={state} onChange={onChange} isPlatformTeam={isPlatformTeam} />
      ) : (
        <AdvancedTab state={state} onChange={onChange} />
      )}
    </div>
  );
}

/* ── Essentials ────────────────────────────────────────────────────────────── */

function EssentialsTab({
  state,
  onChange,
  isPlatformTeam,
}: {
  state: WizardState;
  onChange: (p: Partial<WizardState>) => void;
  isPlatformTeam?: boolean;
}) {
  return (
    <div className="space-y-5">
      {/* Core fields */}
      <div>
        <label htmlFor="appFlavor" className="block text-sm font-medium mb-1.5">
          App Flavor
        </label>
        <select
          id="appFlavor"
          value={state.appFlavor}
          onChange={(e) => onChange({ appFlavor: e.target.value })}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
        >
          {APP_FLAVORS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        {state.appFlavor && (
          <p className="mt-1 text-[11px] text-muted-foreground leading-tight">
            {APP_FLAVORS.find((f) => f.value === state.appFlavor)?.description}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="containerPort" className="block text-sm font-medium mb-1.5">
          Container Port
        </label>
        <input
          id="containerPort"
          type="number"
          value={state.containerPort ?? ""}
          onChange={(e) =>
            onChange({ containerPort: e.target.value ? Number(e.target.value) : null })
          }
          placeholder="8080"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
        />
      </div>

      <div>
        <label htmlFor="domain" className="block text-sm font-medium mb-1.5">
          Domain <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          id="domain"
          type="text"
          value={state.domain}
          onChange={(e) => onChange({ domain: e.target.value })}
          placeholder="e.g. finance, logistics, platform"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
        />
        <p className="mt-1 text-[11px] text-muted-foreground leading-tight">
          Business domain that groups related systems. A System entity is created automatically with the app name.
        </p>
      </div>

      {/* ── Health Probes (from template defaults) ────────────────── */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Health Probes</legend>
        <p className="text-[11px] text-muted-foreground">
          Pre-filled from the template. Leave empty to skip.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Liveness Path</label>
            <input
              type="text"
              value={state.livenessPath}
              onChange={(e) => onChange({ livenessPath: e.target.value })}
              placeholder="/healthz"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Readiness Path</label>
            <input
              type="text"
              value={state.readinessPath}
              onChange={(e) => onChange({ readinessPath: e.target.value })}
              placeholder="/readyz"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
            />
          </div>
        </div>
      </fieldset>

      {/* ── Platform Toggles ─────────────────────────────────────── */}
      <div className="pt-2 border-t border-border">
        <p className="text-sm font-medium mb-3">Platform Features</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FeatureToggle
            icon={RefreshCw}
            label="Reloader"
            description="Auto-restart on ConfigMap/Secret changes"
            checked={state.reloader}
            onChange={(v) => onChange({ reloader: v })}
          />
          <FeatureToggle
            icon={KeyRound}
            label="Vault Secrets"
            description="Mount app secrets from Vault via ExternalSecret"
            checked={state.vaultSecrets}
            onChange={(v) => onChange({ vaultSecrets: v })}
          />
          <FeatureToggle
            icon={Database}
            label="Database Secrets"
            description="Sync remote database connection credentials via ExternalSecret"
            checked={state.databaseSecrets}
            onChange={(v) => onChange({ databaseSecrets: v })}
          />
          <FeatureToggle
            icon={ShieldCheck}
            label="Cert-Manager TLS"
            description="Auto-issue TLS certificate via cert-manager"
            checked={state.certManager}
            onChange={(v) => onChange({ certManager: v })}
          />
          <FeatureToggle
            icon={Globe}
            label="Ingress"
            description="Expose the service to the internet via Ingress"
            checked={state.ingressEnabled}
            onChange={(v) => onChange({ ingressEnabled: v })}
          />
          <FeatureToggle
            icon={Lock}
            label="SSO Auth"
            description="Protect ingress with oauth2-proxy ForwardAuth"
            checked={state.ssoAuth}
            onChange={(v) => onChange({ ssoAuth: v })}
          />
          <FeatureToggle
            icon={Plug}
            label="API"
            description="This service exposes an API — generates an API catalog entity"
            checked={state.apiEnabled}
            onChange={(v) => onChange({ apiEnabled: v })}
          />
          <FeatureToggle
            icon={Activity}
            label="Monitoring"
            description="Expose a Prometheus metrics endpoint for scraping"
            checked={state.monitoringEnabled}
            onChange={(v) => onChange({ monitoringEnabled: v })}
          />
        </div>

        {/* Conditional inputs for toggles that need extra config */}
        {state.certManager && (
          <div className="mt-3 rounded-lg border border-border/50 bg-muted/30 px-4 py-3 space-y-1">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">TLS / ClusterIssuer</p>
            <p className="text-[11px] text-muted-foreground">
              ClusterIssuer is set per environment when you create overlays via the Promote flow.
            </p>
          </div>
        )}

        {/* Vault info — shown when Vault Secrets is on */}
        {state.vaultSecrets && (
          <div className="mt-4 rounded-lg border border-border/50 bg-muted/30 px-4 py-3 space-y-1">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Vault secret path</p>
            <p className="text-xs font-mono">{state.team || "<team>"}/{state.appName || "<app>"}/&#123;env&#125;/env</p>
            <p className="text-[11px] text-muted-foreground">
              Vault secrets are written per environment when you create overlays via the Promote flow — not at scaffold time.
            </p>
          </div>
        )}

        {/* Database config — shown when Database Secrets is on */}
        {state.databaseSecrets && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-border/50 bg-muted/30 px-4 py-3 space-y-1">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Database</p>
              <p className="text-[11px] text-muted-foreground">
                Name, tier, environment, and cluster are configured per environment when you create overlays via the Promote flow.
              </p>
            </div>

            {/* Extensions — curated checklist */}
            <div>
              <label className="block text-xs text-muted-foreground mb-2">
                Extensions
                <span className="font-normal ml-1">
                  ({state.dbExtensions.length} selected)
                </span>
              </label>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {DB_EXTENSIONS.map((ext) => (
                  <label
                    key={ext.value}
                    className="flex items-start gap-2 rounded-md border border-border px-2.5 py-2 text-xs cursor-pointer transition-colors hover:bg-muted/30 has-[:checked]:border-wxops-purple/40 has-[:checked]:bg-wxops-purple/5"
                  >
                    <input
                      type="checkbox"
                      checked={state.dbExtensions.includes(ext.value)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...state.dbExtensions, ext.value]
                          : state.dbExtensions.filter((v) => v !== ext.value);
                        onChange({ dbExtensions: next });
                      }}
                      className="mt-0.5 rounded border-border accent-wxops-purple shrink-0"
                    />
                    <div className="min-w-0">
                      <span className="font-mono font-medium">{ext.label}</span>
                      <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                        {ext.description}
                      </p>
                    </div>
                  </label>
                ))}
              </div>

              {/* Platform team: custom extension input */}
              {isPlatformTeam && (
                <div className="mt-2">
                  <label className="block text-[10px] text-muted-foreground mb-1">
                    Custom extensions <span className="font-normal">(platform-team only, comma-separated)</span>
                  </label>
                  <input
                    type="text"
                    value={state.dbExtensions
                      .filter((e) => !DB_EXTENSIONS.some((d) => d.value === e))
                      .join(", ")}
                    onChange={(e) => {
                      const curated = state.dbExtensions.filter((v) =>
                        DB_EXTENSIONS.some((d) => d.value === v),
                      );
                      const custom = e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean);
                      onChange({ dbExtensions: [...curated, ...custom] });
                    }}
                    placeholder="timescaledb, pg_partman"
                    className="w-full rounded-md border border-dashed border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground leading-tight">
                    Add extensions not in the supported list. These require manual operator validation.
                  </p>
                </div>
              )}

              {!isPlatformTeam && (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Need an extension not listed? Contact the platform team to add it to the supported list.
                </p>
              )}
            </div>
          </div>
        )}

        {/* API config — shown when API is on */}
        {state.apiEnabled && (
          <div className="mt-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">
              API → generates <code>{state.appName}-api</code> entity linked via <code>providesApis</code>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">API Type</label>
                <select
                  value={state.apiType}
                  onChange={(e) => onChange({ apiType: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
                >
                  <option value="openapi">OpenAPI</option>
                  <option value="asyncapi">AsyncAPI</option>
                  <option value="grpc">gRPC</option>
                </select>
                <p className="mt-1 text-[10px] text-muted-foreground leading-tight">
                  {state.apiType === "openapi" && "REST API described by OpenAPI / Swagger spec"}
                  {state.apiType === "asyncapi" && "Event-driven API described by AsyncAPI spec"}
                  {state.apiType === "grpc" && "gRPC service with Protocol Buffers"}
                </p>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Spec Path
                  <span className="font-normal text-muted-foreground ml-1">(optional)</span>
                </label>
                <input
                  type="text"
                  value={state.openapiPath}
                  onChange={(e) => onChange({ openapiPath: e.target.value })}
                  placeholder={`${state.team}/apis/${state.appName}-openapi.json`}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Public URL or relative path to committed spec file in gitops-infra.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Monitoring config — shown when Monitoring is on */}
        {state.monitoringEnabled && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Monitoring → Prometheus metrics endpoint
            </p>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Metrics Path</label>
              <input
                type="text"
                value={state.metricsPath}
                onChange={(e) => onChange({ metricsPath: e.target.value })}
                placeholder="/metrics"
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                HTTP path where Prometheus scrapes metrics (e.g. /metrics, /debug/metrics).
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Feature Toggle Card ───────────────────────────────────────────────────── */

function FeatureToggle({
  icon: Icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3 text-left transition-all",
        checked
          ? "border-wxops-purple bg-wxops-purple/5 ring-1 ring-wxops-purple/30"
          : "border-border hover:border-primary/40 hover:bg-muted/30",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          checked ? "text-wxops-purple" : "text-muted-foreground",
        )}
      />
      <div className="min-w-0">
        <p className={cn("text-sm font-medium", checked && "text-wxops-purple")}>
          {label}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
          {description}
        </p>
      </div>
    </button>
  );
}

/* ── Resource validation ───────────────────────────────────────────────────── */

export function isValidCPU(v: string): boolean {
  if (!v) return true;
  return /^\d+(\.\d+)?$/.test(v) || /^\d+m$/.test(v);
}

export function isValidMemory(v: string): boolean {
  if (!v) return true;
  return /^\d+(\.\d+)?(Ki|Mi|Gi|Ti|k|M|G|T)?$/.test(v);
}

// Resources (CPU/memory, replicas) are env-specific and configured per environment
// via the Promote flow — not in the scaffold wizard. No validation needed here.
export function validateResources(_state: unknown): string | null {
  return null;
}

/* ── Advanced Tab ──────────────────────────────────────────────────────────── */

function AdvancedTab({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (p: Partial<WizardState>) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Rollout Strategy */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Rollout Strategy</legend>
        <select
          value={state.rolloutType}
          onChange={(e) => onChange({ rolloutType: e.target.value })}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
        >
          <option value="RollingUpdate">Rolling Update</option>
          <option value="Recreate">Recreate</option>
        </select>
      </fieldset>

      {/* DevSpace */}
      <fieldset>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={state.devSpaceEnabled}
            onChange={(e) => onChange({ devSpaceEnabled: e.target.checked })}
            className="rounded border-border accent-wxops-purple"
          />
          Enable DevSpace (scale-to-zero dev pod)
        </label>
      </fieldset>

      {/* Plain env vars */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Environment Variables</legend>
        <p className="text-xs text-muted-foreground">
          Non-secret env vars injected directly into the container.
        </p>
        <KeyValueEditor
          pairs={state.envVars as KVPair[]}
          onChange={(pairs) => onChange({ envVars: pairs })}
          keyPlaceholder="ENV_NAME"
          valuePlaceholder="value"
        />
      </fieldset>

      {/* Pod Annotations */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Pod Annotations</legend>
        <KeyValueEditor
          pairs={state.podAnnotations as KVPair[]}
          onChange={(pairs) => onChange({ podAnnotations: pairs })}
          keyPlaceholder="annotation.key/name"
          valuePlaceholder="value"
        />
      </fieldset>

      {/* Extra Labels */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Extra Labels</legend>
        <KeyValueEditor
          pairs={state.extraLabels as KVPair[]}
          onChange={(pairs) => onChange({ extraLabels: pairs })}
          keyPlaceholder="label.key/name"
          valuePlaceholder="value"
        />
      </fieldset>
    </div>
  );
}
