"use client";

import yaml from "js-yaml";
import type { WizardState } from "./project-wizard";
import { dbSecretTarget } from "./xtenant-app-builder";

interface YAMLPreviewProps {
  state: WizardState;
  giteaURL?: string;
}

export function YAMLPreview({ state }: YAMLPreviewProps) {
  const appManifest = buildXTenantApp(state);
  const dbManifest = state.databaseSecrets ? buildXTenantDatabase(state) : null;
  const envES = state.vaultSecrets ? buildEnvExternalSecret(state) : null;
  const dbES = state.databaseSecrets ? buildDbExternalSecret(state) : null;
  const vaultRes = state.vaultSecrets ? buildVaultResource(state) : null;
  const dbRes = state.databaseSecrets ? buildDatabaseResource(state) : null;
  const apiEntity = state.apiEnabled ? buildApiEntity(state) : null;
  const catalogManifest = buildCatalogComponent(state);
  const systemEntity = buildSystemEntity(state);

  return (
    <div className="space-y-4 text-xs">
      <PreviewBlock title="XTenantApp" content={appManifest} />
      {dbManifest && <PreviewBlock title="XTenantDatabase" content={dbManifest} />}
      {envES && <PreviewBlock title="ExternalSecret (env)" content={envES} />}
      {dbES && <PreviewBlock title="ExternalSecret (database connection)" content={dbES} />}
      <PreviewBlock title="Catalog: Component" content={catalogManifest} />
      {vaultRes && <PreviewBlock title="Catalog: Resource (vault)" content={vaultRes} />}
      {dbRes && <PreviewBlock title="Catalog: Resource (database)" content={dbRes} />}
      {apiEntity && <PreviewBlock title="Catalog: API" content={apiEntity} />}
      {systemEntity && <PreviewBlock title="Catalog: System" content={systemEntity} />}
    </div>
  );
}

function PreviewBlock({ title, content }: { title: string; content: string }) {
  return (
    <div>
      <p className="mb-1 font-medium text-muted-foreground">{title}</p>
      <pre className="overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
        {content}
      </pre>
    </div>
  );
}

function buildXTenantApp(s: WizardState): string {
  const ns = defaultNamespace(s.team);

  const obj: Record<string, unknown> = {
    apiVersion: "platform.wxops.cloud/v1alpha1",
    kind: "XTenantApp",
    metadata: {
      name: `${s.team}-${s.appName}` || "unnamed",
      labels: {
        "app.kubernetes.io/managed-by": "wxops-portal",
        "wxops.cloud/team": s.team || "unknown",
        ...Object.fromEntries(
          (s.extraLabels ?? []).filter((p) => p.key).map((p) => [p.key, p.value]),
        ),
      },
    },
    spec: {
      parameters: cleanUndefined({
        appName: s.appName || undefined,
        namespace: ns || undefined,
        image: `${s.team}/${s.appName}:latest`,
        imagePullSecrets: ["regcred"],
        appFlavor: s.appFlavor || undefined,
        templateId: s.templateId || undefined,
        repository: s.team && s.appName
          ? { url: `<gitea-url>/${s.team}/${s.appName}` }
          : undefined,
        containerPort: s.containerPort || undefined,
        ...buildToggles(s),
        ...buildAdvanced(s),
      }),
    },
  };

  return toYAML(obj);
}

function buildCatalogComponent(s: WizardState): string {
  const dependsOn: string[] = [];
  const providesApis: string[] = [];

  if (s.vaultSecrets) dependsOn.push(`resource:default/${s.appName}-vault`);
  if (s.databaseSecrets) dependsOn.push(`resource:default/${s.appName}-db`);
  if (s.apiEnabled) providesApis.push(`api:default/${s.appName}-api`);

  const obj: Record<string, unknown> = {
    apiVersion: "backstage.io/v1alpha1",
    kind: "Component",
    metadata: cleanUndefined({
      name: s.appName || "unnamed",
      title: s.appName || undefined,
      description: s.description || undefined,
      annotations: {
        "gitea/source-location": `${s.team}/${s.appName}`,
        "wxops.cloud/template-id": s.templateId || "none",
      },
    }),
    spec: cleanUndefined({
      type: "service",
      lifecycle: "experimental",
      owner: s.team ? `group:${s.team}` : undefined,
      system: s.appName,
      dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
      providesApis: providesApis.length > 0 ? providesApis : undefined,
    }),
  };
  return toYAML(obj);
}

function buildXTenantDatabase(s: WizardState): string {
  // Base stub — only project-level fields. Per-env fields (dbName, tier,
  // environment, clusterRef) are patched via JSON 6902 in the Promote flow.
  const defaultDbName = `${s.appName}-db`;
  const extensions = s.dbExtensions.length > 0
    ? s.dbExtensions
    : ["uuid-ossp", "pgcrypto"];

  const params: Record<string, unknown> = {
    owner: s.team || undefined,
    extensions: extensions.length > 0 ? extensions : undefined,
    vaultSecretStoreName: "vault-tenant",
  };

  const obj = {
    apiVersion: "platform.wxops.cloud/v1alpha1",
    kind: "XTenantDatabase",
    metadata: {
      name: `${s.team}-${defaultDbName}`,
      labels: {
        "app.kubernetes.io/managed-by": "wxops-portal",
        "wxops.cloud/team": s.team || "unknown",
        "wxops.cloud/tenant-database": "true",
      },
    },
    spec: {
      parameters: cleanUndefined(params),
    },
  };
  return toYAML(obj);
}

function buildEnvExternalSecret(s: WizardState): string {
  const ns = defaultNamespace(s.team);
  const obj = {
    apiVersion: "external-secrets.io/v1",
    kind: "ExternalSecret",
    metadata: { name: `${s.appName}-env`, namespace: ns },
    spec: {
      refreshInterval: "1m",
      secretStoreRef: { name: "vault-tenant", kind: "ClusterSecretStore" },
      target: { name: `${s.appName}-env` },
      dataFrom: [{ extract: { key: `${s.team}/${s.appName}/env` } }],
    },
  };
  return toYAML(obj);
}

function buildDbExternalSecret(s: WizardState): string {
  const ns = defaultNamespace(s.team);
  const dbName = `${s.appName}-db`;
  const secretName = dbSecretTarget(s.appName, "");
  const obj = {
    apiVersion: "external-secrets.io/v1",
    kind: "ExternalSecret",
    metadata: { name: secretName, namespace: ns },
    spec: {
      refreshInterval: "1m",
      secretStoreRef: { name: "vault-tenant", kind: "ClusterSecretStore" },
      target: { name: secretName },
      dataFrom: [{ extract: { key: `${s.team}/databases/${dbName}/connection-creds` } }],
    },
  };
  return toYAML(obj);
}

function buildVaultResource(s: WizardState): string {
  const obj = {
    apiVersion: "backstage.io/v1alpha1",
    kind: "Resource",
    metadata: cleanUndefined({
      name: `${s.appName}-vault`,
      description: `Vault secrets for ${s.appName}`,
      annotations: {
        "wxops.cloud/vault-path": `${s.team}/${s.appName}/env`,
      },
    }),
    spec: cleanUndefined({
      type: "vault",
      lifecycle: "experimental",
      owner: s.team ? `group:${s.team}` : undefined,
      system: s.appName,
    }),
  };
  return toYAML(obj);
}

function buildDatabaseResource(s: WizardState): string {
  const dbName = `${s.appName}-db`;
  const obj = {
    apiVersion: "backstage.io/v1alpha1",
    kind: "Resource",
    metadata: cleanUndefined({
      name: dbName,
      description: `PostgreSQL database for ${s.appName}`,
      annotations: {
        "crossplane/claim-name": `${s.team}-${s.appName}-db`,
      },
    }),
    spec: cleanUndefined({
      type: "database",
      lifecycle: "experimental",
      owner: s.team ? `group:${s.team}` : undefined,
      system: s.appName,
    }),
  };
  return toYAML(obj);
}

function buildApiEntity(s: WizardState): string {
  const apiType = s.apiType || "openapi";
  const links = s.openapiPath
    ? [{ url: s.openapiPath, title: "OpenAPI Spec", type: "openapi", icon: "api" }]
    : undefined;

  const obj = {
    apiVersion: "backstage.io/v1alpha1",
    kind: "API",
    metadata: cleanUndefined({
      name: `${s.appName}-api`,
      title: `${s.appName} API`,
      description: `API exposed by ${s.appName}`,
      links,
    }),
    spec: cleanUndefined({
      type: apiType,
      lifecycle: "experimental",
      owner: s.team ? `group:${s.team}` : undefined,
      system: s.appName,
    }),
  };
  return toYAML(obj);
}

function buildToggles(s: WizardState): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (s.reloader) out.reloader = { enabled: true };

  if (s.vaultSecrets || s.databaseSecrets) {
    const sf: Record<string, unknown> = {};
    if (s.vaultSecrets) sf.app = { enabled: true };
    if (s.databaseSecrets) sf.database = { enabled: true };
    out.secretsFrom = sf;
  }

  if (s.ingressEnabled || s.certManager || s.ssoAuth) {
    const ing: Record<string, unknown> = { enabled: true };
    if (s.certManager) {
      // clusterIssuer is set per-environment in the Promote flow — not in base.
      ing.tls = { enabled: true };
    }
    if (s.ssoAuth) ing.auth = { enabled: true };
    out.ingress = ing;
  }

  return out;
}

function buildAdvanced(s: WizardState): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (s.livenessPath || s.readinessPath) {
    out.probes = cleanUndefined({
      liveness: s.livenessPath ? { enabled: true, path: s.livenessPath } : undefined,
      readiness: s.readinessPath ? { enabled: true, path: s.readinessPath } : undefined,
    });
  }

  if (s.rolloutType && s.rolloutType !== "RollingUpdate") {
    out.rolloutStrategy = { type: s.rolloutType };
  }

  if (s.devSpaceEnabled) out.devSpace = { enabled: true, replicas: 0 };

  const envEntries = s.envVars?.filter((p) => p.key);
  if (envEntries?.length) {
    out.env = envEntries.map((p) => ({ name: p.key, value: p.value }));
  }

  const ann: Record<string, string> = {};
  const annEntries = s.podAnnotations?.filter((p) => p.key);
  if (annEntries?.length) {
    annEntries.forEach((p) => { ann[p.key] = p.value; });
  }
  if (s.monitoringEnabled) {
    ann["prometheus.io/scrape"] = "true";
    if (s.containerPort) ann["prometheus.io/port"] = String(s.containerPort);
    ann["prometheus.io/path"] = s.metricsPath || "/metrics";
  }
  if (Object.keys(ann).length > 0) out.podAnnotations = ann;

  return out;
}

function toYAML(obj: unknown): string {
  try {
    return yaml.dump(obj, { lineWidth: 80, noRefs: true, sortKeys: false });
  } catch {
    return "# invalid state";
  }
}

function buildSystemEntity(s: WizardState): string {
  const sysName = s.appName;
  const obj = {
    apiVersion: "backstage.io/v1alpha1",
    kind: "System",
    metadata: {
      name: sysName,
      description: `System for ${sysName}`,
    },
    spec: cleanUndefined({
      owner: `group:${s.team}`,
      domain: s.domain || undefined,
    }),
  };
  try {
    return yaml.dump(obj, { lineWidth: 80, noRefs: true });
  } catch {
    return "# invalid state";
  }
}

function defaultNamespace(team: string): string {
  if (team === "platform-team") return "platform";
  return team ? `tenant-${team}` : "";
}

function cleanUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== "") {
      result[k] = v;
    }
  }
  return result;
}
