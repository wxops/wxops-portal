import type { WizardState } from "./project-wizard";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Parses the combined config response ({app, database?}) into WizardState fields.
 * Handles both the new combined format and the legacy single-object format.
 */
export function parseXTenantApp(response: any): Partial<WizardState> {
  // Support both {app: {...}, database?: {...}} and legacy flat XTenantApp
  const config = response?.app ?? response;
  const dbConfig = response?.database;

  const params = config?.spec?.parameters ?? {};
  const meta = config?.metadata ?? {};

  const ingress = params.ingress ?? {};
  const probes = params.probes ?? {};
  const secretsFrom = params.secretsFrom ?? {};

  const extraLabels = Object.entries(meta.labels ?? {})
    .filter(([k]) => k !== "app.kubernetes.io/managed-by" && k !== "wxops.cloud/team")
    .map(([key, value]) => ({ key, value: String(value) }));

  const envVars = (params.env ?? []).map((e: any) => ({
    key: e.name ?? "",
    value: e.value ?? "",
  }));

  // Legacy prometheus.io/* pod annotations predate spec.parameters.monitoring
  // (v0.5.1). They never scraped anything, but existing bases still carry them.
  // Translate them into the monitoring block and keep them out of the
  // user-editable annotation list, so the next save migrates the app instead of
  // preserving dead config alongside the real monitor.
  const rawAnnotations: Record<string, unknown> = params.podAnnotations ?? {};
  const legacyScrape = String(rawAnnotations["prometheus.io/scrape"] ?? "") === "true";
  const legacyPath = rawAnnotations["prometheus.io/path"];

  const podAnnotations = Object.entries(rawAnnotations)
    .filter(([key]) => !key.startsWith("prometheus.io/"))
    .map(([key, value]) => ({ key, value: String(value) }));

  const monitoring = params.monitoring ?? {};

  // Parse database config if present
  const dbParams = dbConfig?.spec?.parameters ?? {};
  const hasDatabase = secretsFrom.database?.enabled ?? false;

  return {
    appName: params.appName ?? "",
    templateId: params.templateId ?? "",
    appFlavor: params.appFlavor ?? "webapp",
    containerPort: params.containerPort ?? null,
    reloader: params.reloader?.enabled ?? false,
    vaultSecrets: secretsFrom.app?.enabled ?? false,
    databaseSecrets: hasDatabase,
    ingressEnabled: ingress.enabled ?? false,
    certManager: ingress.tls?.enabled ?? false,
    // certClusterIssuer intentionally absent — set per-env in the Promote flow.
    ssoAuth: ingress.auth?.enabled ?? false,
    livenessPath: probes.liveness?.path ?? "",
    readinessPath: probes.readiness?.path ?? "",
    rolloutType: params.rolloutStrategy?.type ?? "RollingUpdate",
    monitoringEnabled: monitoring.enabled ?? legacyScrape,
    metricsPath: monitoring.path ?? (legacyPath ? String(legacyPath) : "/metrics"),
    envVars: envVars.length > 0 ? envVars : [],
    podAnnotations: podAnnotations.length > 0 ? podAnnotations : [],
    extraLabels: extraLabels.length > 0 ? extraLabels : [],
    // Database — only extensions are project-level; name/tier/cluster go in the Promote flow.
    dbExtensions: dbParams.extensions ?? (hasDatabase ? ["uuid-ossp", "pgcrypto"] : []),
  };
}
