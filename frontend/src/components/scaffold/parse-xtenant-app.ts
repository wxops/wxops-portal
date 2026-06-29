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
  const resources = params.resources ?? {};
  const probes = params.probes ?? {};
  const secretsFrom = params.secretsFrom ?? {};

  const extraLabels = Object.entries(meta.labels ?? {})
    .filter(([k]) => k !== "app.kubernetes.io/managed-by" && k !== "wxops.cloud/team")
    .map(([key, value]) => ({ key, value: String(value) }));

  const envVars = (params.env ?? []).map((e: any) => ({
    key: e.name ?? "",
    value: e.value ?? "",
  }));

  const podAnnotations = Object.entries(params.podAnnotations ?? {}).map(
    ([key, value]) => ({ key, value: String(value) }),
  );

  // Parse database config if present
  const dbParams = dbConfig?.spec?.parameters ?? {};
  const hasDatabase = secretsFrom.database?.enabled ?? false;

  return {
    appName: params.appName ?? "",
    templateId: params.templateId ?? "",
    appFlavor: params.appFlavor ?? "webapp",
    containerPort: params.containerPort ?? null,
    replicas: params.replicas ?? null,
    reloader: params.reloader?.enabled ?? false,
    vaultSecrets: secretsFrom.app?.enabled ?? false,
    databaseSecrets: hasDatabase,
    ingressEnabled: ingress.enabled ?? false,
    ingressHost: ingress.host ?? "",
    certManager: ingress.tls?.enabled ?? false,
    certClusterIssuer: ingress.tls?.clusterIssuer ?? "letsencrypt-prod",
    ssoAuth: ingress.auth?.enabled ?? false,
    resourcesCpuReq: resources.requests?.cpu ?? "",
    resourcesCpuLim: resources.limits?.cpu ?? "",
    resourcesMemReq: resources.requests?.memory ?? "",
    resourcesMemLim: resources.limits?.memory ?? "",
    livenessPath: probes.liveness?.path ?? "",
    readinessPath: probes.readiness?.path ?? "",
    rolloutType: params.rolloutStrategy?.type ?? "RollingUpdate",
    devSpaceEnabled: params.devSpace?.enabled ?? false,
    envVars: envVars.length > 0 ? envVars : [],
    podAnnotations: podAnnotations.length > 0 ? podAnnotations : [],
    extraLabels: extraLabels.length > 0 ? extraLabels : [],
    // Database fields — from XTenantDatabase if available
    dbName: dbParams.dbName ?? "",
    dbExtensions: dbParams.extensions ?? (hasDatabase ? ["uuid-ossp", "pgcrypto"] : []),
    dbTier: dbParams.tier ?? "shared",
  };
}
