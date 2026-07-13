import yaml from "js-yaml";
import type { WizardState } from "./project-wizard";

export function dbSecretTarget(appName: string, dbName: string): string {
  if (!dbName) return `${appName}-db-creds`;
  if (dbName.endsWith("-db")) return `${dbName}-creds`;
  return `${dbName}-db-creds`;
}

export function defaultNamespace(team: string): string {
  if (team === "platform-team") return "platform";
  return team ? `tenant-${team}` : "";
}

export function cleanUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== "") {
      result[k] = v;
    }
  }
  return result;
}

export function toYAML(obj: unknown): string {
  try {
    return yaml.dump(obj, { lineWidth: 80, noRefs: true, sortKeys: false });
  } catch {
    return "# invalid state";
  }
}

export function buildToggles(s: WizardState): Record<string, unknown> {
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

export function buildAdvanced(s: WizardState): Record<string, unknown> {
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

export function buildXTenantAppObject(s: WizardState): Record<string, unknown> {
  const ns = defaultNamespace(s.team);

  return {
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
        containerPort: s.containerPort || undefined,
        ...buildToggles(s),
        ...buildAdvanced(s),
      }),
    },
  };
}

export function buildXTenantAppYAML(s: WizardState): string {
  return toYAML(buildXTenantAppObject(s));
}

export function buildXTenantDatabaseYAML(s: WizardState): string {
  // Base stub — only project-level fields (extensions, owner, vault store).
  // Per-env fields (dbName, tier, environment, clusterRef) are patched
  // via JSON 6902 in each overlay through the Promote flow.
  const defaultDbName = `${s.appName}-db`;
  const extensions = s.dbExtensions.length > 0 ? s.dbExtensions : ["uuid-ossp", "pgcrypto"];

  const params: Record<string, unknown> = {
    owner: s.team || undefined,
    extensions: extensions.length > 0 ? extensions : undefined,
    vaultSecretStoreName: "vault-tenant",
  };

  return toYAML({
    apiVersion: "platform.wxops.cloud/v1alpha1",
    kind: "XTenantDatabase",
    metadata: {
      name: `${s.team}-${defaultDbName}`,
      labels: {
        "app.kubernetes.io/managed-by": "wxops-portal",
        "wxops.cloud/team": s.team,
        "wxops.cloud/tenant-database": "true",
      },
    },
    spec: {
      parameters: cleanUndefined(params),
    },
  });
}

export function buildEnvExternalSecretYAML(s: WizardState): string {
  const ns = defaultNamespace(s.team);
  return toYAML({
    apiVersion: "external-secrets.io/v1",
    kind: "ExternalSecret",
    metadata: { name: `${s.appName}-env`, namespace: ns },
    spec: {
      refreshInterval: "1m",
      secretStoreRef: { name: "vault-tenant", kind: "ClusterSecretStore" },
      target: { name: `${s.appName}-env` },
      dataFrom: [{ extract: { key: `${s.team}/${s.appName}/env` } }],
    },
  });
}

export function buildDbExternalSecretYAML(s: WizardState): string {
  const ns = defaultNamespace(s.team);
  const dbName = `${s.appName}-db`;
  const secretName = dbSecretTarget(s.appName, "");
  return toYAML({
    apiVersion: "external-secrets.io/v1",
    kind: "ExternalSecret",
    metadata: { name: secretName, namespace: ns },
    spec: {
      refreshInterval: "1m",
      secretStoreRef: { name: "vault-tenant", kind: "ClusterSecretStore" },
      target: { name: secretName },
      dataFrom: [{ extract: { key: `${s.team}/databases/${dbName}/connection-creds` } }],
    },
  });
}
