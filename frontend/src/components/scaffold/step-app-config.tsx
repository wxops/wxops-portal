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
import { dbSecretTarget } from "./xtenant-app-builder";
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

const DB_TIERS = [
  { value: "shared", label: "Shared", description: "Auto-assigns to the least-loaded shared cluster matching the environment" },
  { value: "dedicated", label: "Dedicated", description: "Provisions a new dedicated CNPG cluster (1 cluster = 1 db)" },
];

const DB_ENVIRONMENTS = [
  { value: "dev", label: "Development" },
  { value: "staging", label: "Staging" },
  { value: "prod", label: "Production" },
];

const DB_RECLAIM_POLICIES = [
  { value: "retain", label: "Retain", description: "Database and role survive XR deletion — must be cleaned up manually" },
  { value: "delete", label: "Delete", description: "CNPG drops the database on XR deletion — ordered cleanup with ClusterUsage" },
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

      <div className="grid gap-4 sm:grid-cols-2">
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
          <label htmlFor="replicas" className="block text-sm font-medium mb-1.5">
            Replicas
          </label>
          <input
            id="replicas"
            type="number"
            min={0}
            value={state.replicas ?? ""}
            onChange={(e) =>
              onChange({ replicas: e.target.value ? Number(e.target.value) : null })
            }
            placeholder="1"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
          />
        </div>
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

      {/* ── Resources (from template defaults) ──────────────────── */}
      <fieldset className="space-y-3 pt-2 border-t border-border">
        <legend className="text-sm font-medium">Resources</legend>
        <p className="text-[11px] text-muted-foreground">
          Pre-filled from the template defaults. Adjust for your workload.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <ResourceInput
            label="CPU Request"
            hint="e.g. 100m, 250m, 0.5, 1"
            value={state.resourcesCpuReq}
            placeholder="100m"
            onChange={(v) => onChange({ resourcesCpuReq: v })}
            validate={isValidCPU}
            errorMsg="Use millicores (e.g. 100m) or cores (e.g. 0.5)"
          />
          <ResourceInput
            label="CPU Limit"
            hint="e.g. 500m, 1, 2"
            value={state.resourcesCpuLim}
            placeholder="500m"
            onChange={(v) => onChange({ resourcesCpuLim: v })}
            validate={isValidCPU}
            errorMsg="Use millicores (e.g. 500m) or cores (e.g. 1)"
          />
          <ResourceInput
            label="Memory Request"
            hint="e.g. 128Mi, 256Mi, 1Gi"
            value={state.resourcesMemReq}
            placeholder="128Mi"
            onChange={(v) => onChange({ resourcesMemReq: v })}
            validate={isValidMemory}
            errorMsg="Use Ki, Mi, or Gi (e.g. 128Mi, 1Gi)"
          />
          <ResourceInput
            label="Memory Limit"
            hint="e.g. 256Mi, 512Mi, 1Gi, 2Gi"
            value={state.resourcesMemLim}
            placeholder="512Mi"
            onChange={(v) => onChange({ resourcesMemLim: v })}
            validate={isValidMemory}
            errorMsg="Use Ki, Mi, or Gi (e.g. 512Mi, 1Gi)"
          />
        </div>
      </fieldset>

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
        {state.ingressEnabled && (
          <div className="mt-3">
            <label htmlFor="ingressHost" className="block text-xs font-medium mb-1 text-muted-foreground">
              Hostname <span className="text-destructive">*</span>
            </label>
            <input
              id="ingressHost"
              type="text"
              value={state.ingressHost}
              onChange={(e) => onChange({ ingressHost: e.target.value })}
              placeholder={`${state.appName}.${state.team}.example.com`}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
            />
          </div>
        )}
        {state.certManager && (
          <div className="mt-3">
            <label htmlFor="certClusterIssuer" className="block text-xs font-medium mb-1 text-muted-foreground">
              ClusterIssuer
            </label>
            <input
              id="certClusterIssuer"
              type="text"
              value={state.certClusterIssuer}
              onChange={(e) => onChange({ certClusterIssuer: e.target.value })}
              placeholder="letsencrypt-prod"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
            />
          </div>
        )}

        {/* Vault env vars — shown when Vault Secrets is on */}
        {state.vaultSecrets && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Vault Secrets → <code className="text-foreground">{state.team}/{state.appName}/env</code>
            </p>
            <p className="text-xs text-muted-foreground">
              These will be stored in Vault and synced to Secret <code>{state.appName}-env</code> via ExternalSecret.
            </p>
            <KeyValueEditor
              pairs={state.vaultEnvVars as KVPair[]}
              onChange={(pairs) => onChange({ vaultEnvVars: pairs })}
              keyPlaceholder="SECRET_KEY"
              valuePlaceholder="secret-value"
              allowImport
              secret
            />
          </div>
        )}

        {/* Database config — shown when Database Secrets is on */}
        {state.databaseSecrets && (
          <div className="mt-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">
              Database → XTenantDatabase · Vault: <code>{state.team}/databases/{state.dbName || `${state.appName}-db`}/connection-creds</code> → Secret: <code>{dbSecretTarget(state.appName, state.dbName)}</code>
            </p>

            {/* Core: dbName, tier, environment */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Database Name</label>
                <input
                  type="text"
                  value={state.dbName}
                  onChange={(e) => onChange({ dbName: e.target.value })}
                  placeholder={`${state.appName}-db`}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Tier</label>
                <select
                  value={state.dbTier}
                  onChange={(e) => onChange({ dbTier: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
                >
                  {DB_TIERS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-muted-foreground leading-tight">
                  {DB_TIERS.find((t) => t.value === state.dbTier)?.description}
                </p>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Environment</label>
                <select
                  value={state.dbEnvironment}
                  onChange={(e) => onChange({ dbEnvironment: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
                >
                  {DB_ENVIRONMENTS.map((e) => (
                    <option key={e.value} value={e.value}>{e.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-muted-foreground leading-tight">
                  Pool filtered by environment — must match cluster&apos;s environment
                </p>
              </div>
            </div>

            {/* Shared tier: optional cluster override */}
            {state.dbTier === "shared" && isPlatformTeam && (
              <div className="rounded-md border border-dashed border-border p-3 space-y-2">
                <p className="text-[10px] font-medium text-muted-foreground">
                  Cluster Override <span className="font-normal">(platform-team only — bypasses tier logic)</span>
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-1">clusterRef</label>
                    <input
                      type="text"
                      value={state.dbClusterRef}
                      onChange={(e) => onChange({ dbClusterRef: e.target.value })}
                      placeholder="e.g. cluster-a"
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-1">clusterNamespace</label>
                    <input
                      type="text"
                      value={state.dbClusterNamespace}
                      onChange={(e) => onChange({ dbClusterNamespace: e.target.value })}
                      placeholder="cnpg-system"
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Dedicated tier: cluster configuration */}
            {state.dbTier === "dedicated" && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  Dedicated Cluster Configuration
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-1">Instances</label>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={state.dbDedicatedInstances}
                      onChange={(e) => onChange({ dbDedicatedInstances: Number(e.target.value) || 1 })}
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
                    />
                    <p className="text-[10px] text-muted-foreground mt-0.5">CNPG replicas (1 = standalone, 2+ = HA)</p>
                  </div>
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-1">Storage Size</label>
                    <input
                      type="text"
                      value={state.dbDedicatedStorageSize}
                      onChange={(e) => onChange({ dbDedicatedStorageSize: e.target.value })}
                      placeholder="1Gi"
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
                    />
                    <p className="text-[10px] text-muted-foreground mt-0.5">e.g. 1Gi, 5Gi, 10Gi</p>
                  </div>
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-1">PostgreSQL Version</label>
                    <select
                      value={state.dbDedicatedPostgresVersion}
                      onChange={(e) => onChange({ dbDedicatedPostgresVersion: Number(e.target.value) })}
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
                    >
                      <option value={17}>17</option>
                      <option value={16}>16</option>
                      <option value={15}>15</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2 self-end pb-1.5">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={state.dbDedicatedEnablePooler}
                        onChange={(e) => onChange({ dbDedicatedEnablePooler: e.target.checked })}
                        className="rounded border-border accent-wxops-purple"
                      />
                      Enable PgBouncer Pooler
                    </label>
                  </div>
                </div>
                {isPlatformTeam && (
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-1">
                      Namespace <span className="font-normal">(optional — defaults to cnpg-system)</span>
                    </label>
                    <input
                      type="text"
                      value={state.dbDedicatedNamespace}
                      onChange={(e) => onChange({ dbDedicatedNamespace: e.target.value })}
                      placeholder="cnpg-system"
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Reclaim Policy */}
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Reclaim Policy</label>
              <select
                value={state.dbReclaimPolicy}
                onChange={(e) => onChange({ dbReclaimPolicy: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
              >
                {DB_RECLAIM_POLICIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-muted-foreground leading-tight">
                {DB_RECLAIM_POLICIES.find((p) => p.value === state.dbReclaimPolicy)?.description}
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
                  placeholder={
                    state.ingressEnabled && state.ingressHost
                      ? `https://${state.ingressHost}/swagger/doc.json`
                      : `${state.team}/apis/${state.appName}-openapi.json`
                  }
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

export function validateResources(state: {
  resourcesCpuReq: string;
  resourcesCpuLim: string;
  resourcesMemReq: string;
  resourcesMemLim: string;
}): string | null {
  if (!isValidCPU(state.resourcesCpuReq)) return "Invalid CPU Request format";
  if (!isValidCPU(state.resourcesCpuLim)) return "Invalid CPU Limit format";
  if (!isValidMemory(state.resourcesMemReq)) return "Invalid Memory Request format";
  if (!isValidMemory(state.resourcesMemLim)) return "Invalid Memory Limit format";
  return null;
}

function ResourceInput({
  label,
  hint,
  value,
  placeholder,
  onChange,
  validate,
  errorMsg,
}: {
  label: string;
  hint: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  validate: (v: string) => boolean;
  errorMsg: string;
}) {
  const invalid = value !== "" && !validate(value);
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-md border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 ${
          invalid
            ? "border-red-400 focus:ring-red-400/50"
            : "border-border focus:ring-wxops-purple/50"
        }`}
      />
      {invalid ? (
        <p className="text-[10px] text-red-500 mt-0.5">{errorMsg}</p>
      ) : (
        <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>
      )}
    </div>
  );
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
