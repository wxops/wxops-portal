"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Clock, AlertTriangle, ChevronRight, ChevronLeft, Loader2, XCircle, X, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { addNotification } from "@/lib/notifications";
import { KeyValueEditor } from "@/components/scaffold/key-value-editor";

// ── Deprecation confirm dialog ────────────────────────────────────────────────
interface DeprecateDialogProps {
  entityName: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  loading: boolean;
}

function DeprecateDialog({ entityName, onConfirm, onCancel, loading }: DeprecateDialogProps) {
  const [reason, setReason] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Focus the textarea when the dialog opens.
    textareaRef.current?.focus();
  }, []);

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !loading) onCancel(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [loading, onCancel]);

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onCancel(); }}
    >
      {/* Panel */}
      <div className="w-full max-w-md rounded-xl border border-red-200 dark:border-red-800 bg-background shadow-xl">
        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-red-100 dark:border-red-900">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/50">
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Deprecate service</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="font-mono">{entityName}</span> will be marked deprecated and locked.
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            This action will update the lifecycle to <span className="font-semibold text-red-600 dark:text-red-400">deprecated</span>,
            lock the entity from further promotion, and open a removal PR in gitops-infra for platform-team review.
          </p>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              ref={textareaRef}
              rows={3}
              placeholder="Why is this service being deprecated?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={loading}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-red-400/50 dark:focus:ring-red-700/50 resize-none disabled:opacity-50"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={loading || !reason.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 hover:bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
            Yes, deprecate
          </button>
        </div>
      </div>
    </div>
  );
}

interface EnvVersion {
  tag: string;
  date: string;
}

interface OverlayStatus {
  exists: boolean;
  openPR?: number;
}

interface PromoStatus {
  lifecycle: string;
  locked: boolean;
  baseReady: boolean;
  // Feature flags from base xtenant-app.yaml — authoritative after edit-config.
  ingressEnabled: boolean;
  certEnabled: boolean;
  vaultEnabled: boolean;
  databaseEnabled: boolean;
  tags: {
    dev: EnvVersion | null;
    staging: EnvVersion | null;
    production: EnvVersion | null;
  };
  overlays: {
    dev: OverlayStatus;
    staging: OverlayStatus;
    production: OverlayStatus;
  };
}

interface Props {
  entityKind: string;
  entityName: string;
  team: string;
  canElevate: boolean;      // platform-team or Managers
  isMember: boolean;        // any team member
  ingressEnabled: boolean;  // base has ingress.enabled: true — host is required in overlay
  vaultEnabled: boolean;    // base has vault secretsFrom — show vault secrets step
  databaseEnabled: boolean; // base has XTenantDatabase — show DB cluster config step
  dbName: string;           // resolved db name for XTenantDatabase target (e.g. {appName}-db)
  certEnabled: boolean;     // base has cert-manager TLS — show ClusterIssuer override
}

type Env = "development" | "staging" | "production";

const ENV_ORDER: Env[] = ["development", "staging", "production"];

// Numeric levels for lifecycle and environment — used to prevent downgrade actions.
const LIFECYCLE_LEVEL: Record<string, number> = {
  experimental: 0,
  development:  1,
  staging:      2,
  production:   3,
  deprecated:   4,
};
const ENV_LEVEL: Record<Env, number> = { development: 1, staging: 2, production: 3 };

const ENV_META: Record<Env, { label: string; dot: string; text: string; bg: string; border: string; overlayKey: "dev" | "staging" | "production" }> = {
  development: { label: "Development", dot: "bg-blue-500",  text: "text-blue-700 dark:text-blue-400",   bg: "bg-blue-50 dark:bg-blue-950/20",   border: "border-blue-200 dark:border-blue-900", overlayKey: "dev" },
  staging:     { label: "Staging",     dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/20", border: "border-amber-200 dark:border-amber-900", overlayKey: "staging" },
  production:  { label: "Production",  dot: "bg-green-500", text: "text-green-700 dark:text-green-400", bg: "bg-green-50 dark:bg-green-950/20", border: "border-green-200 dark:border-green-900", overlayKey: "production" },
};

function isValidHostname(h: string): boolean {
  if (!h || h.length > 253) return false;
  return h.split(".").every(label => {
    if (!label || label.length > 63) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
    return /^[a-zA-Z0-9-]+$/.test(label);
  });
}

function isValidK8sQuantity(s: string): boolean {
  return /^\d+(\.\d+)?(m|[kKMGTPE]i?)?$/.test(s);
}

// Per-field inline errors shown while the user types.
// Only flags format problems on non-empty fields (except required ingress host).
// Returns a map of fieldKey → error message (empty map = all valid).
function deriveFieldErrors(
  config: OverlayConfigState,
  ctx: { ingressEnabled: boolean; databaseEnabled: boolean },
): Record<string, string> {
  const e: Record<string, string> = {};

  if (config.replicas) {
    const r = parseInt(config.replicas, 10);
    if (isNaN(r) || r < 1) e.replicas = "Must be a positive integer (≥ 1)";
  }
  if (config.cpuReq && !isValidK8sQuantity(config.cpuReq))
    e.cpuReq = "Invalid quantity — use e.g. 100m, 500m, 1.0";
  if (config.cpuLim && !isValidK8sQuantity(config.cpuLim))
    e.cpuLim = "Invalid quantity — use e.g. 500m, 1.0";
  if (config.memReq && !isValidK8sQuantity(config.memReq))
    e.memReq = "Invalid quantity — use e.g. 128Mi, 512Mi, 1Gi";
  if (config.memLim && !isValidK8sQuantity(config.memLim))
    e.memLim = "Invalid quantity — use e.g. 512Mi, 1Gi";

  if (ctx.ingressEnabled && !config.ingressHost) {
    e.ingressHost = "Required — base manifest has ingress enabled";
  } else if (config.ingressHost && !isValidHostname(config.ingressHost)) {
    e.ingressHost = "Not a valid hostname (e.g. app.example.com)";
  }
  if (config.certIssuer && !config.ingressHost)
    e.certIssuer = "Ingress host is required when using a ClusterIssuer";

  if (ctx.databaseEnabled && config.dbTier === "dedicated") {
    if (config.dbInstances) {
      const inst = parseInt(config.dbInstances, 10);
      if (isNaN(inst) || inst < 1) e.dbInstances = "Must be at least 1";
    }
    if (config.dbStorageSize && !isValidK8sQuantity(config.dbStorageSize))
      e.dbStorageSize = "Invalid quantity — use e.g. 1Gi, 5Gi, 20Gi";
    if (config.dbPostgresVersion) {
      const pgVer = parseInt(config.dbPostgresVersion, 10);
      if (!isNaN(pgVer) && pgVer > 0 && (pgVer < 14 || pgVer > 17))
        e.dbPostgresVersion = "Supported versions: 14, 15, 16, 17";
    }
  }

  return e;
}

// Shared validation — called at the "Next" step (step 1 → 2) AND at final submit.
// Returning an empty array means the config is valid.
function validateOverlayConfig(
  config: OverlayConfigState,
  ctx: { ingressEnabled: boolean; databaseEnabled: boolean },
): string[] {
  const errors: string[] = [];

  if (ctx.ingressEnabled && !config.ingressHost) {
    errors.push("Ingress host is required — the base manifest enables ingress");
  }
  if (config.ingressHost && !isValidHostname(config.ingressHost)) {
    errors.push(`Ingress host "${config.ingressHost}" is not a valid hostname`);
  }
  if (config.certIssuer && !config.ingressHost) {
    errors.push("Cert issuer requires an ingress host — set the ingress host first");
  }

  const replicasNum = config.replicas ? parseInt(config.replicas, 10) : undefined;
  if (replicasNum !== undefined && (isNaN(replicasNum) || replicasNum < 1)) {
    errors.push("Replicas must be a positive integer (≥ 1)");
  }

  for (const [field, val] of [
    ["CPU request",    config.cpuReq],
    ["CPU limit",      config.cpuLim],
    ["Memory request", config.memReq],
    ["Memory limit",   config.memLim],
  ] as [string, string][]) {
    if (val && !isValidK8sQuantity(val)) {
      errors.push(`${field} "${val}" is not a valid Kubernetes quantity (e.g. 100m, 512Mi)`);
    }
  }

  if (ctx.databaseEnabled) {
    const tier = config.dbTier || "shared";
    if (tier === "dedicated") {
      const inst = parseInt(config.dbInstances, 10);
      if (isNaN(inst) || inst < 1) {
        errors.push("Dedicated-tier database requires at least 1 instance");
      }
      if (config.dbStorageSize && !isValidK8sQuantity(config.dbStorageSize)) {
        errors.push(`DB storage size "${config.dbStorageSize}" is not a valid Kubernetes quantity`);
      }
      const pgVer = parseInt(config.dbPostgresVersion, 10);
      if (!isNaN(pgVer) && pgVer > 0 && (pgVer < 14 || pgVer > 17)) {
        errors.push(`Postgres version ${pgVer} is out of supported range (14–17)`);
      }
    }
  }

  return errors;
}

function shortTag(tag: string): string {
  if (tag.startsWith("dev-")) {
    const sha = tag.split("-").pop() ?? "";
    return sha ? `dev-…-${sha}` : tag;
  }
  return tag;
}

interface OverlayConfigState {
  replicas: string;
  ingressHost: string;
  cpuReq: string;
  cpuLim: string;
  memReq: string;
  memLim: string;
  vaultSecrets: Array<{ key: string; value: string }>;
  // Database env-specific config (when databaseEnabled)
  dbName: string;
  dbTier: string;        // "shared" | "dedicated"
  dbEnvironment: string; // optional: override environment label (dev/staging share same pool)
  dbClusterRef: string;
  dbClusterNamespace: string;
  // Dedicated-tier cluster parameters
  dbInstances: string;
  dbStorageSize: string;
  dbPostgresVersion: string;
  dbEnablePooler: boolean;
  // Cert-TLS ClusterIssuer override (when certEnabled)
  certIssuer: string;
}

const defaultConfig: OverlayConfigState = {
  replicas: "",
  ingressHost: "",
  cpuReq: "",
  cpuLim: "",
  memReq: "",
  memLim: "",
  vaultSecrets: [],
  dbName: "",
  dbTier: "shared",
  dbEnvironment: "",
  dbClusterRef: "",
  dbClusterNamespace: "",
  dbInstances: "1",
  dbStorageSize: "1Gi",
  dbPostgresVersion: "16",
  dbEnablePooler: true,
  certIssuer: "",
};

// ── Overlay preview helpers ───────────────────────────────────────────────────

// XTenantDatabase accepts "dev" | "staging" | "prod" — map the overlay env name.
function toDbEnv(envName: string): string {
  return envName === "production" ? "prod" : envName;
}

function buildKustPreview(
  team: string,
  appName: string,
  envName: string,
  config: OverlayConfigState,
  databaseEnabled: boolean,
): string {
  const vaultKey = `${team}/${appName}/${envName}/env`;
  const isProdLike = envName === "staging" || envName === "production";
  // Pattern: {appName}-{envName}-env (matches backend overlay.go)
  const envSecretName = `${appName}-${envName}-env`;
  // Patches always target the BASE name; rename is a separate JSON 6902 op.
  const baseXRName = `${team}-${appName}`;
  const xrName     = isProdLike ? `${team}-${appName}-${envName}` : baseXRName;
  const dbXRName   = `${team}-${appName}-db`;

  const esPatch = isProdLike
    ? `  - patch: |-\n      - op: replace\n        path: /metadata/name\n        value: ${envSecretName}\n      - op: replace\n        path: /spec/target/name\n        value: ${envSecretName}\n      - op: replace\n        path: /spec/dataFrom/0/extract/key\n        value: ${vaultKey}\n    target:\n      kind: ExternalSecret\n      name: ${appName}-env`
    : `  - patch: |-\n      - op: replace\n        path: /spec/dataFrom/0/extract/key\n        value: ${vaultKey}\n    target:\n      kind: ExternalSecret\n      name: ${appName}-env`;

  // For staging/production: ingress host (if set) + required rename in one patch targeting base name.
  // For dev: ingress host only (no rename needed).
  let ingressPatch = "";
  if (isProdLike) {
    const ops = config.ingressHost
      ? `      - op: add\n        path: /spec/parameters/ingress/host\n        value: ${config.ingressHost}\n      - op: replace\n        path: /metadata/name\n        value: ${xrName}`
      : `      - op: replace\n        path: /metadata/name\n        value: ${xrName}`;
    ingressPatch = `\n  - patch: |-\n${ops}\n    target:\n      kind: XTenantApp\n      name: ${baseXRName}`;
  } else if (config.ingressHost) {
    ingressPatch = `\n  - patch: |-\n      - op: add\n        path: /spec/parameters/ingress/host\n        value: ${config.ingressHost}\n    target:\n      kind: XTenantApp\n      name: ${baseXRName}`;
  }

  let dbPatch = "";
  if (databaseEnabled) {
    const dbName = config.dbName || `${appName}-${envName}-db`;
    const tier   = config.dbTier || "shared";
    const dbEnv  = config.dbEnvironment || toDbEnv(envName);

    // For staging/production: prepend XTenantDatabase rename op.
    let ops = "";
    if (isProdLike) {
      ops += `      - op: replace\n        path: /metadata/name\n        value: ${team}-${appName}-${envName}-db\n`;
    }
    ops += `      - op: add\n        path: /spec/parameters/dbName\n        value: ${dbName}\n`;
    ops += `      - op: add\n        path: /spec/parameters/tier\n        value: ${tier}\n`;
    ops += `      - op: add\n        path: /spec/parameters/environment\n        value: ${dbEnv}`;

    if (tier === "shared") {
      if (config.dbClusterRef)       ops += `\n      - op: add\n        path: /spec/parameters/clusterRef\n        value: ${config.dbClusterRef}`;
      if (config.dbClusterNamespace) ops += `\n      - op: add\n        path: /spec/parameters/clusterNamespace\n        value: ${config.dbClusterNamespace}`;
    } else {
      const instances = config.dbInstances    || "1";
      const storage   = config.dbStorageSize  || "1Gi";
      const pgVer     = config.dbPostgresVersion || "16";
      ops += `\n      - op: add\n        path: /spec/parameters/dedicatedCluster\n        value:\n          instances: ${instances}\n          storageSize: ${storage}\n          postgresVersion: ${pgVer}`;
      ops += `\n          enablePooler: ${config.dbEnablePooler}`;
      ops += `\n          namespace: cnpg-system`;
    }

    dbPatch = `\n  - patch: |-\n${ops}\n    target:\n      kind: XTenantDatabase\n      name: ${dbXRName}`;

    // For staging/production: rename the DB ExternalSecret too.
    if (isProdLike) {
      const baseDbSecret = `${appName}-db-creds`;
      const envDbSecret  = `${appName}-${envName}-db-creds`;
      dbPatch += `\n  - patch: |-\n      - op: replace\n        path: /spec/dataFrom/0/extract/key\n        value: ${team}/databases/${dbName}/connection-creds\n      - op: replace\n        path: /spec/target/name\n        value: ${envDbSecret}\n      - op: replace\n        path: /metadata/name\n        value: ${envDbSecret}\n    target:\n      kind: ExternalSecret\n      name: ${baseDbSecret}`;
    }
  }

  return `apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n    - ../../base\nconfigurations:\n    - image-transformer.yaml\npatches:\n    - path: patch-xtenant-app.yaml\n${esPatch}${ingressPatch}${dbPatch}`;
}

function buildPatchPreview(team: string, appName: string, envName: string, config: OverlayConfigState): string {
  // Always target the BASE name — rename to {team}-{appName}-{envName} is handled
  // via JSON 6902 in kustomization.yaml (see buildKustPreview).
  const baseXRName  = `${team}-${appName}`;
  const isProdLike  = envName === "staging" || envName === "production";
  const r = config.replicas ? parseInt(config.replicas, 10) : null;

  let params = "";
  // For staging/production, patch the appName with env suffix so the XR is
  // distinguishable from other environments in the same spoke cluster.
  if (isProdLike) params += `\n    appName: ${appName}-${envName}`;
  if (r) params += `\n    replicas: ${r}`;
  if (config.cpuReq || config.cpuLim || config.memReq || config.memLim) {
    params += "\n    resources:";
    if (config.cpuReq || config.memReq) {
      params += "\n      requests:";
      if (config.cpuReq) params += `\n        cpu: ${config.cpuReq}`;
      if (config.memReq) params += `\n        memory: ${config.memReq}`;
    }
    if (config.cpuLim || config.memLim) {
      params += "\n      limits:";
      if (config.cpuLim) params += `\n        cpu: ${config.cpuLim}`;
      if (config.memLim) params += `\n        memory: ${config.memLim}`;
    }
  }
  if (!params) params = "\n    {} # only replicas/resources differ from base";

  return `apiVersion: platform.wxops.cloud/v1alpha1\nkind: XTenantApp\nmetadata:\n  name: ${baseXRName}\nspec:\n  parameters:${params}`;
}

// ── Overlay creation wizard (2-step modal) ────────────────────────────────────

const REPLICA_HINT: Record<string, string> = {
  dev:        "1 replica is sufficient for development",
  staging:    "1–2 replicas for load / smoke testing",
  production: "2 or more for high availability",
};

interface OverlayWizardProps {
  env: Env;
  mode: "create" | "edit";
  team: string;
  appName: string;
  ingressEnabled: boolean;
  vaultEnabled: boolean;
  databaseEnabled: boolean;
  certEnabled: boolean;
  config: OverlayConfigState;
  setConfig: React.Dispatch<React.SetStateAction<OverlayConfigState>>;
  submitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
}

function OverlayWizardModal({ env, mode, team, appName, ingressEnabled, vaultEnabled, databaseEnabled, certEnabled, config, setConfig, submitting, onClose, onSubmit }: OverlayWizardProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const meta = ENV_META[env];
  const envName = meta.overlayKey;
  const vaultKey = `${team}/${appName}/${envName}/env`;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !submitting) onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [submitting, onClose]);

  const inputCls    = "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50";
  const inputErrCls = "border-red-500 focus:ring-red-400/50 dark:focus:ring-red-700/50";
  const hintCls     = "text-[11px] text-muted-foreground mt-0.5";
  const errCls      = "text-[11px] text-red-600 dark:text-red-400 mt-0.5";

  const fieldErrors = deriveFieldErrors(config, { ingressEnabled, databaseEnabled });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-background shadow-xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", meta.dot)} />
          <p className="text-sm font-semibold">{mode === "edit" ? "Edit" : "Create"} {meta.label} overlay</p>
          <button onClick={onClose} disabled={submitting} className="ml-auto text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step pills */}
        <div className="flex items-center gap-2 px-5 py-2.5 border-b border-border/50 bg-muted/20 shrink-0">
          <span className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold border",
            step === 1 ? cn(meta.bg, meta.text, meta.border) : "bg-muted text-muted-foreground border-transparent",
          )}>
            1 &nbsp;Configure
          </span>
          <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
          <span className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold border",
            step === 2 ? cn(meta.bg, meta.text, meta.border) : "bg-muted text-muted-foreground border-transparent",
          )}>
            2 &nbsp;Review
          </span>
        </div>

        {/* ── Step 1: Configure ─────────────────────────────────────────────── */}
        {step === 1 && (
          <>
            <div className="p-5 space-y-5 overflow-y-auto">
              {/* Resources */}
              <div className="space-y-3">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Resources</p>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Replicas</label>
                  <input type="number" min="1" placeholder="1"
                    value={config.replicas}
                    onChange={(e) => setConfig((p) => ({ ...p, replicas: e.target.value }))}
                    className={cn(inputCls, fieldErrors.replicas && inputErrCls)} />
                  {fieldErrors.replicas
                    ? <p className={errCls}>{fieldErrors.replicas}</p>
                    : <p className={hintCls}>{REPLICA_HINT[envName]}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium">CPU request</label>
                    <input type="text" placeholder="100m"
                      value={config.cpuReq}
                      onChange={(e) => setConfig((p) => ({ ...p, cpuReq: e.target.value }))}
                      className={cn(inputCls, fieldErrors.cpuReq && inputErrCls)} />
                    {fieldErrors.cpuReq
                      ? <p className={errCls}>{fieldErrors.cpuReq}</p>
                      : <p className={hintCls}>e.g. <span className="font-mono">100m</span>, <span className="font-mono">500m</span>, <span className="font-mono">1.0</span></p>}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">CPU limit</label>
                    <input type="text" placeholder="500m"
                      value={config.cpuLim}
                      onChange={(e) => setConfig((p) => ({ ...p, cpuLim: e.target.value }))}
                      className={cn(inputCls, fieldErrors.cpuLim && inputErrCls)} />
                    {fieldErrors.cpuLim
                      ? <p className={errCls}>{fieldErrors.cpuLim}</p>
                      : <p className={hintCls}>Hard cap — throttled when exceeded. Leave blank for cluster default.</p>}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Memory request</label>
                    <input type="text" placeholder="128Mi"
                      value={config.memReq}
                      onChange={(e) => setConfig((p) => ({ ...p, memReq: e.target.value }))}
                      className={cn(inputCls, fieldErrors.memReq && inputErrCls)} />
                    {fieldErrors.memReq
                      ? <p className={errCls}>{fieldErrors.memReq}</p>
                      : <p className={hintCls}>e.g. <span className="font-mono">128Mi</span>, <span className="font-mono">512Mi</span>, <span className="font-mono">1Gi</span></p>}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Memory limit</label>
                    <input type="text" placeholder="512Mi"
                      value={config.memLim}
                      onChange={(e) => setConfig((p) => ({ ...p, memLim: e.target.value }))}
                      className={cn(inputCls, fieldErrors.memLim && inputErrCls)} />
                    {fieldErrors.memLim
                      ? <p className={errCls}>{fieldErrors.memLim}</p>
                      : <p className={hintCls}>OOMKilled when exceeded. Leave blank for cluster default.</p>}
                  </div>
                </div>
              </div>

              {/* Networking */}
              <div className="space-y-3">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Networking</p>
                <div className="space-y-1">
                  <label className="text-xs font-medium">
                    Ingress host
                    {ingressEnabled && <span className="ml-1 text-red-500">*</span>}
                  </label>
                  <input type="text" placeholder={`${appName}.example.com`}
                    value={config.ingressHost}
                    onChange={(e) => setConfig((p) => ({ ...p, ingressHost: e.target.value }))}
                    className={cn(inputCls, fieldErrors.ingressHost && inputErrCls)} />
                  {fieldErrors.ingressHost
                    ? <p className={errCls}>{fieldErrors.ingressHost}</p>
                    : <p className={hintCls}>
                        {ingressEnabled
                          ? "Required — the base manifest enables ingress. Must match a DNS record pointing at your ingress controller."
                          : "Public hostname for this environment. Leave blank to inherit from base."}
                      </p>}
                </div>
              </div>

              {/* Vault secrets */}
              {vaultEnabled && (
                <div className="space-y-3">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Vault secrets</p>
                  <p className="text-xs font-mono text-foreground">{vaultKey}</p>
                  {mode === "edit" && (
                    <p className={hintCls}>
                      Secrets already configured at this path. Leave the list below empty to keep them unchanged,
                      or add entries to update specific keys.
                    </p>
                  )}
                  <KeyValueEditor
                    pairs={config.vaultSecrets}
                    onChange={(pairs) => setConfig((p) => ({ ...p, vaultSecrets: pairs }))}
                    keyPlaceholder="SECRET_KEY"
                    valuePlaceholder="value"
                    allowImport
                    secret
                  />
                  <p className={hintCls}>
                    {mode === "create" ? "Required — written" : "Written"} to Vault at <span className="font-mono">{vaultKey}</span> before the overlay is committed.
                    Only the provided keys are written; existing secrets at this path are preserved.
                  </p>
                </div>
              )}

              {/* Database — all per-env config delegated to promotion */}
              {databaseEnabled && (
                <div className="space-y-3">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Database</p>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium">DB name</label>
                      <input type="text" placeholder={`${appName}-${envName}-db`}
                        value={config.dbName}
                        onChange={(e) => setConfig((p) => ({ ...p, dbName: e.target.value }))}
                        className={inputCls} />
                      <p className={hintCls}>Logical name for this environment&apos;s database. Defaults to <span className="font-mono">{appName}-{envName}-db</span>.</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Tier</label>
                      <select
                        value={config.dbTier}
                        onChange={(e) => {
                          const tier = e.target.value;
                          setConfig((p) => ({
                            ...p,
                            dbTier: tier,
                            // Clear pool override when switching to dedicated — each env gets its own cluster.
                            ...(tier === "dedicated" ? { dbEnvironment: "" } : {}),
                          }));
                        }}
                        className={inputCls}>
                        <option value="shared">Shared</option>
                        <option value="dedicated">Dedicated</option>
                      </select>
                      <p className={hintCls}>Shared assigns to an existing cluster pool. Dedicated provisions a new CNPG cluster for this app only.</p>
                    </div>
                  </div>

                  {/* Environment — selectable for shared dev/staging; read-only badge otherwise */}
                  {config.dbTier === "shared" && (envName === "dev" || envName === "staging") ? (
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Environment <span className="text-muted-foreground font-normal">(optional override)</span></label>
                      <select
                        value={config.dbEnvironment || envName}
                        onChange={(e) => setConfig((p) => ({ ...p, dbEnvironment: e.target.value }))}
                        className={inputCls}>
                        <option value="dev">dev</option>
                        <option value="staging">staging</option>
                        <option value="prod">prod</option>
                      </select>
                      <p className={hintCls}>
                        Defaults to <span className="font-mono">{envName}</span>. Set to <span className="font-mono">dev</span> if staging uses the same shared pool as dev.
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">Environment</span>
                      <span className="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs">
                        {toDbEnv(envName)}
                      </span>
                      <span className={hintCls}>
                        {config.dbTier === "dedicated"
                          ? "Fixed — dedicated cluster is provisioned per environment."
                          : "Fixed — production always targets the prod pool."}
                      </span>
                    </div>
                  )}

                  {/* Shared tier: cluster targeting */}
                  {config.dbTier === "shared" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium">Cluster ref</label>
                        <input type="text" placeholder={`${envName}-cnpg-cluster`}
                          value={config.dbClusterRef}
                          onChange={(e) => setConfig((p) => ({ ...p, dbClusterRef: e.target.value }))}
                          className={inputCls} />
                        <p className={hintCls}>Name of the shared CNPG cluster. Ask your platform team for the cluster name.</p>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium">Cluster namespace</label>
                        <input type="text" placeholder="cnpg-system"
                          value={config.dbClusterNamespace}
                          onChange={(e) => setConfig((p) => ({ ...p, dbClusterNamespace: e.target.value }))}
                          className={inputCls} />
                        <p className={hintCls}>Namespace where the shared cluster lives. Defaults to <span className="font-mono">cnpg-system</span> if blank.</p>
                      </div>
                    </div>
                  )}

                  {/* Dedicated tier: cluster parameters */}
                  {config.dbTier === "dedicated" && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs font-medium">Instances</label>
                          <input type="number" min="1" placeholder="1"
                            value={config.dbInstances}
                            onChange={(e) => setConfig((p) => ({ ...p, dbInstances: e.target.value }))}
                            className={cn(inputCls, fieldErrors.dbInstances && inputErrCls)} />
                          {fieldErrors.dbInstances
                            ? <p className={errCls}>{fieldErrors.dbInstances}</p>
                            : <p className={hintCls}>Primary + replica nodes. Use 1 for dev, 2+ for HA.</p>}
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium">Storage size</label>
                          <input type="text" placeholder="1Gi"
                            value={config.dbStorageSize}
                            onChange={(e) => setConfig((p) => ({ ...p, dbStorageSize: e.target.value }))}
                            className={cn(inputCls, fieldErrors.dbStorageSize && inputErrCls)} />
                          {fieldErrors.dbStorageSize
                            ? <p className={errCls}>{fieldErrors.dbStorageSize}</p>
                            : <p className={hintCls}>PV size per node. e.g. <span className="font-mono">5Gi</span> for dev, <span className="font-mono">20Gi</span> for production.</p>}
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium">Postgres version</label>
                          <input type="number" min="14" max="17" placeholder="16"
                            value={config.dbPostgresVersion}
                            onChange={(e) => setConfig((p) => ({ ...p, dbPostgresVersion: e.target.value }))}
                            className={cn(inputCls, fieldErrors.dbPostgresVersion && inputErrCls)} />
                          {fieldErrors.dbPostgresVersion
                            ? <p className={errCls}>{fieldErrors.dbPostgresVersion}</p>
                            : <p className={hintCls}>Major version (14–17). Cannot be downgraded after creation.</p>}
                        </div>
                      </div>
                      <div className="flex items-start gap-2.5">
                        <input type="checkbox" id="db-pooler"
                          checked={config.dbEnablePooler}
                          onChange={(e) => setConfig((p) => ({ ...p, dbEnablePooler: e.target.checked }))}
                          className="mt-0.5 h-3.5 w-3.5 rounded border-border" />
                        <div>
                          <label htmlFor="db-pooler" className="text-xs font-medium cursor-pointer">Enable connection pooler (PgBouncer)</label>
                          <p className={hintCls}>Deploys a PgBouncer sidecar for connection pooling. Recommended for staging and production.</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Cert-TLS ClusterIssuer override */}
              {certEnabled && (
                <div className="space-y-3">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">TLS</p>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">ClusterIssuer override</label>
                    <input type="text"
                      placeholder={envName === "production" ? "letsencrypt-prod" : "letsencrypt-staging"}
                      value={config.certIssuer}
                      onChange={(e) => setConfig((p) => ({ ...p, certIssuer: e.target.value }))}
                      className={cn(inputCls, fieldErrors.certIssuer && inputErrCls)} />
                    {fieldErrors.certIssuer
                      ? <p className={errCls}>{fieldErrors.certIssuer}</p>
                      : <p className={hintCls}>
                          Overrides the base ClusterIssuer for this environment (e.g.{" "}
                          <span className="font-mono">letsencrypt-staging</span> for staging,{" "}
                          <span className="font-mono">letsencrypt-prod</span> for production).
                          Leave blank to inherit from base.
                        </p>}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
              <button onClick={onClose} disabled={submitting}
                className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
                Cancel
              </button>
              {Object.keys(fieldErrors).length > 0 && (
                <span className="text-[11px] text-red-600 dark:text-red-400 font-medium">
                  {Object.keys(fieldErrors).length} field{Object.keys(fieldErrors).length > 1 ? "s" : ""} need{Object.keys(fieldErrors).length === 1 ? "s" : ""} attention
                </span>
              )}
              <button onClick={() => {
                  const errs = validateOverlayConfig(config, { ingressEnabled, databaseEnabled });
                  if (errs.length > 0) { errs.forEach(e => toast.error(e)); return; }
                  setStep(2);
                }}
                className={cn("inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:opacity-90",
                  meta.text, meta.bg, meta.border)}>
                Review <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: Review ────────────────────────────────────────────────── */}
        {step === 2 && (
          <>
            <div className="p-5 space-y-4 overflow-y-auto">
              {/* Summary card */}
              <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-3">
                <p className="text-xs font-semibold">{mode === "edit" ? "What will be updated" : "What will be created"}</p>
                <p className={hintCls}>
                  3 files in{" "}
                  <span className="font-mono">tenants-apps/{team}/{appName}/overlays/{envName}/</span>
                </p>
                <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs">
                  <span className="text-muted-foreground">XR name</span>
                  <span className="font-mono">{envName === "dev" ? `${team}-${appName}` : `${team}-${appName}-${envName}`}</span>
                  <span className="text-muted-foreground">Vault key</span>
                  <span className="font-mono">{vaultKey}</span>
                  <span className="text-muted-foreground">Replicas</span>
                  <span className="font-mono">{config.replicas || "1 (default)"}</span>
                  {config.ingressHost && (
                    <>
                      <span className="text-muted-foreground">Ingress host</span>
                      <span className="font-mono">{config.ingressHost} <span className="text-muted-foreground/60">(kustomization patch)</span></span>
                    </>
                  )}
                  {(config.cpuReq || config.cpuLim) && (
                    <>
                      <span className="text-muted-foreground">CPU req / lim</span>
                      <span className="font-mono">{config.cpuReq || "—"} / {config.cpuLim || "—"}</span>
                    </>
                  )}
                  {(config.memReq || config.memLim) && (
                    <>
                      <span className="text-muted-foreground">Mem req / lim</span>
                      <span className="font-mono">{config.memReq || "—"} / {config.memLim || "—"}</span>
                    </>
                  )}
                  {vaultEnabled && config.vaultSecrets.filter(v => v.key).length > 0 && (
                    <>
                      <span className="text-muted-foreground">Vault secrets</span>
                      <span className="font-mono text-green-600 dark:text-green-400">{config.vaultSecrets.filter(v => v.key).length} key{config.vaultSecrets.filter(v => v.key).length > 1 ? "s" : ""} → {vaultKey}</span>
                    </>
                  )}
                  {databaseEnabled && (
                    <>
                      <span className="text-muted-foreground">DB name</span>
                      <span className="font-mono">{config.dbName || `${appName}-${envName}-db`}</span>
                      <span className="text-muted-foreground">Tier / env</span>
                      <span className="font-mono">
                        {config.dbTier || "shared"} / {config.dbEnvironment || toDbEnv(envName)}
                        {config.dbEnvironment && config.dbEnvironment !== toDbEnv(envName) && (
                          <span className="ml-1 text-muted-foreground/60">(overridden)</span>
                        )}
                      </span>
                    </>
                  )}
                  {databaseEnabled && config.dbTier === "shared" && config.dbClusterRef && (
                    <>
                      <span className="text-muted-foreground">Cluster ref</span>
                      <span className="font-mono">{config.dbClusterRef}{config.dbClusterNamespace ? ` / ${config.dbClusterNamespace}` : ""}</span>
                    </>
                  )}
                  {databaseEnabled && config.dbTier === "dedicated" && (config.dbInstances || config.dbStorageSize || config.dbPostgresVersion) && (
                    <>
                      <span className="text-muted-foreground">Dedicated cluster</span>
                      <span className="font-mono">
                        {[
                          config.dbInstances ? `${config.dbInstances} instance${config.dbInstances !== "1" ? "s" : ""}` : null,
                          config.dbStorageSize || "1Gi",
                          `pg${config.dbPostgresVersion || "16"}`,
                          config.dbEnablePooler ? "pooler" : null,
                        ].filter(Boolean).join(" · ")}
                      </span>
                    </>
                  )}
                  {certEnabled && config.certIssuer && (
                    <>
                      <span className="text-muted-foreground">ClusterIssuer</span>
                      <span className="font-mono">{config.certIssuer}</span>
                    </>
                  )}
                </div>
              </div>

              {/* kustomization.yaml preview */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">kustomization.yaml</p>
                <pre className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-[11px] font-mono leading-relaxed overflow-x-auto whitespace-pre">
                  {buildKustPreview(team, appName, envName, config, databaseEnabled)}
                </pre>
              </div>

              {/* patch-xtenant-app.yaml preview */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">patch-xtenant-app.yaml</p>
                <pre className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-[11px] font-mono leading-relaxed overflow-x-auto whitespace-pre">
                  {buildPatchPreview(team, appName, envName, config)}
                </pre>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-border shrink-0">
              <button onClick={() => setStep(1)} disabled={submitting}
                className="inline-flex items-center gap-1 rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
              <button onClick={onSubmit} disabled={submitting}
                className={cn("inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-50",
                  meta.text, meta.bg, meta.border)}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {env === "development"
                  ? (mode === "edit" ? "Apply changes" : "Apply overlay")
                  : (mode === "edit" ? "Open update PR" : "Create overlay PR")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── PromotionPanel ────────────────────────────────────────────────────────────

export function PromotionPanel({ entityKind, entityName, team, canElevate, isMember, ingressEnabled, vaultEnabled, databaseEnabled, dbName, certEnabled }: Props) {
  const [status, setStatus] = useState<PromoStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Effective feature flags: prefer values from promostatus (parsed from base manifest)
  // over catalog entity annotations/dependsOn, which can lag after edit-config.
  const effectiveIngressEnabled  = status?.baseReady ? (status.ingressEnabled  ?? ingressEnabled)  : ingressEnabled;
  const effectiveCertEnabled     = status?.baseReady ? (status.certEnabled     ?? certEnabled)     : certEnabled;
  const effectiveVaultEnabled    = status?.baseReady ? (status.vaultEnabled    ?? vaultEnabled)    : vaultEnabled;
  const effectiveDatabaseEnabled = status?.baseReady ? (status.databaseEnabled ?? databaseEnabled) : databaseEnabled;
  const [refreshSeq, setRefreshSeq] = useState(0);
  const [wizardEnv, setWizardEnv] = useState<Env | null>(null);
  const [wizardMode, setWizardMode] = useState<"create" | "edit">("create");
  const [loadingOverlay, setLoadingOverlay] = useState<Env | null>(null);
  const [overlayConfig, setOverlayConfig] = useState<OverlayConfigState>(defaultConfig);
  const [submitting, setSubmitting] = useState<Env | null>(null);
  const [showDeprecateDialog, setShowDeprecateDialog] = useState(false);
  const [deprecating, setDeprecating] = useState(false);

  function refresh() {
    setRefreshSeq((n) => n + 1);
  }

  useEffect(() => {
    let cancelled = false;

    async function fetchStatus() {
      try {
        const res = await fetch(
          `/api/catalog/entities/${encodeURIComponent(entityKind)}/${encodeURIComponent(entityName)}/promostatus`,
          { credentials: "include" },
        );
        const d: PromoStatus = await res.json();
        if (!cancelled) setStatus(d);
      } catch {
        if (!cancelled) setStatus(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchStatus();
    return () => { cancelled = true; };
  }, [entityKind, entityName, refreshSeq]);

  async function openEditWizard(env: Env) {
    setLoadingOverlay(env);
    try {
      const res = await fetch(
        `/api/catalog/entities/${encodeURIComponent(entityKind)}/${encodeURIComponent(entityName)}/overlay/${encodeURIComponent(env)}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        toast.error("Could not load current overlay config");
        return;
      }
      const cfg = await res.json();
      // Map backend OverlayConfig → OverlayConfigState
      setOverlayConfig({
        replicas: cfg.replicas != null ? String(cfg.replicas) : "",
        ingressHost: cfg.ingressHost ?? "",
        cpuReq: cfg.resources?.requests?.cpu ?? "",
        cpuLim: cfg.resources?.limits?.cpu ?? "",
        memReq: cfg.resources?.requests?.memory ?? "",
        memLim: cfg.resources?.limits?.memory ?? "",
        vaultSecrets: [],
        dbName: cfg.dbName ?? "",
        dbTier: cfg.dbTier || "shared",
        dbEnvironment: cfg.dbEnvironment ?? "",
        dbClusterRef: cfg.dbClusterRef ?? "",
        dbClusterNamespace: cfg.dbClusterNamespace ?? "",
        dbInstances: cfg.dbInstances ? String(cfg.dbInstances) : "",
        dbStorageSize: cfg.dbStorageSize || "1Gi",
        dbPostgresVersion: cfg.dbPostgresVersion ? String(cfg.dbPostgresVersion) : "16",
        dbEnablePooler: cfg.dbEnablePooler ?? false,
        certIssuer: cfg.certIssuer ?? "",
      });
      setWizardMode("edit");
      setWizardEnv(env);
    } catch {
      toast.error("Network error loading overlay config");
    } finally {
      setLoadingOverlay(null);
    }
  }

  async function handleCreateOverlay(env: Env) {
    setSubmitting(env);
    const meta = ENV_META[env];

    // Vault secrets — required on create, optional on edit (secrets already exist).
    const vaultPairs = overlayConfig.vaultSecrets.filter(v => v.key);
    let vaultWritten = false;
    if (effectiveVaultEnabled) {
      if (wizardMode === "create" && vaultPairs.length === 0) {
        toast.error("Vault secrets are required — add at least one secret before committing the overlay");
        setSubmitting(null);
        return;
      }
      if (vaultPairs.length > 0) {
        try {
          const secretsRes = await fetch("/api/scaffold/secrets", {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              team,
              appName: entityName,
              targetEnv: meta.overlayKey,
              envVars: vaultPairs,
            }),
          });
          if (!secretsRes.ok) {
            const errData = await secretsRes.json().catch(() => null);
            toast.error(errData?.error ?? "Failed to write Vault secrets");
            setSubmitting(null);
            return;
          }
          vaultWritten = true;
        } catch {
          toast.error("Network error writing Vault secrets");
          setSubmitting(null);
          return;
        }
      }
    }

    // Safety-net validation (the wizard "Next" button runs the same check earlier).
    const overlayErrors = validateOverlayConfig(overlayConfig, {
      ingressEnabled: effectiveIngressEnabled || effectiveCertEnabled,
      databaseEnabled: effectiveDatabaseEnabled,
    });
    if (overlayErrors.length > 0) {
      overlayErrors.forEach(e => toast.error(e));
      setSubmitting(null);
      return;
    }

    const body: Record<string, unknown> = {
      action: wizardMode === "edit" ? "update-overlay" : "create-overlay",
      targetLifecycle: env,
      vaultWritten,
    };
    const r = overlayConfig.replicas ? parseInt(overlayConfig.replicas, 10) : undefined;
    if (r !== undefined && !isNaN(r)) body.replicas = r;
    if (overlayConfig.ingressHost) body.ingressHost = overlayConfig.ingressHost;
    if (overlayConfig.cpuReq)  body.resourcesCpuReq = overlayConfig.cpuReq;
    if (overlayConfig.cpuLim)  body.resourcesCpuLim = overlayConfig.cpuLim;
    if (overlayConfig.memReq)  body.resourcesMemReq = overlayConfig.memReq;
    if (overlayConfig.memLim)  body.resourcesMemLim = overlayConfig.memLim;
    if (effectiveDatabaseEnabled) {
      body.databaseEnabled = true;
      body.dbName = overlayConfig.dbName || `${entityName}-${meta.overlayKey}-db`;
      body.dbTier = overlayConfig.dbTier || "shared";
      // dbEnvironment override only applies to shared tier (pool selection).
      // Dedicated always uses the overlay's own env — let the backend default.
      if (overlayConfig.dbTier === "shared" && overlayConfig.dbEnvironment) {
        body.dbEnvironment = overlayConfig.dbEnvironment;
      }
      if (overlayConfig.dbTier === "shared") {
        if (overlayConfig.dbClusterRef) body.dbClusterRef = overlayConfig.dbClusterRef;
        if (overlayConfig.dbClusterNamespace) body.dbClusterNamespace = overlayConfig.dbClusterNamespace;
      } else if (overlayConfig.dbTier === "dedicated") {
        const inst = parseInt(overlayConfig.dbInstances, 10);
        if (!isNaN(inst) && inst > 0) body.dbInstances = inst;
        if (overlayConfig.dbStorageSize) body.dbStorageSize = overlayConfig.dbStorageSize;
        const pgVer = parseInt(overlayConfig.dbPostgresVersion, 10);
        if (!isNaN(pgVer) && pgVer > 0) body.dbPostgresVersion = pgVer;
        body.dbEnablePooler = overlayConfig.dbEnablePooler;
      }
    }
    if (effectiveCertEnabled && overlayConfig.certIssuer) body.certIssuer = overlayConfig.certIssuer;

    try {
      const res = await fetch(
        `/api/catalog/entities/${encodeURIComponent(entityKind)}/${encodeURIComponent(entityName)}/promote`,
        { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to create overlay PR");
      } else {
        if (data.committed) {
          toast.success(`Dev overlay committed to main — lifecycle updated to development`);
          addNotification({
            type: "pr_merged",
            title: "Dev overlay committed",
            body: `${entityName} → development`,
          });
        } else {
          const verb = wizardMode === "edit" ? "Update PR opened for" : "PR opened for";
          toast.success(`${verb} ${meta.label} overlay — platform-team will review`);
          addNotification({
            type: "pr_opened",
            title: wizardMode === "edit" ? "Overlay update PR opened" : "Overlay PR opened",
            body: data.prTitle ?? `${entityName} → ${meta.label}`,
          });
        }
        setWizardEnv(null);
        setWizardMode("create");
        setOverlayConfig(defaultConfig);
        // Reload status before clearing submitting so the panel reflects the new
        // state in the same render pass — no stale-button window.
        try {
          const sr = await fetch(
            `/api/catalog/entities/${encodeURIComponent(entityKind)}/${encodeURIComponent(entityName)}/promostatus`,
            { credentials: "include" },
          );
          if (sr.ok) setStatus(await sr.json());
        } catch { /* best-effort */ }
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleConfirm(env: Env) {
    setSubmitting(env);
    const body = { action: "confirm", targetLifecycle: env };
    try {
      const res = await fetch(
        `/api/catalog/entities/${encodeURIComponent(entityKind)}/${encodeURIComponent(entityName)}/promote`,
        { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to confirm lifecycle");
        return;
      }
      toast.success(`Lifecycle updated to ${env}`);
      addNotification({
        type: "pr_merged",
        title: "Lifecycle confirmed",
        body: `${entityName} → ${env}`,
      });
      // Reload status while the spinner is still visible so the button is gone
      // before submitting clears — prevents the double-click window.
      try {
        const sr = await fetch(
          `/api/catalog/entities/${encodeURIComponent(entityKind)}/${encodeURIComponent(entityName)}/promostatus`,
          { credentials: "include" },
        );
        if (sr.ok) setStatus(await sr.json());
      } catch { /* best-effort — stale status is tolerable */ }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleDeprecate(reason: string) {
    setDeprecating(true);
    try {
      const res = await fetch(
        `/api/catalog/entities/${encodeURIComponent(entityKind)}/${encodeURIComponent(entityName)}/deprecate`,
        { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to deprecate");
      } else {
        toast.success("Entity deprecated — removal PR opened for review");
        addNotification({
          type: "pr_opened",
          title: "Deprecation PR opened",
          body: entityName,
        });
        setShowDeprecateDialog(false);
        refresh();
      }
    } catch {
      toast.error("Network error");
    } finally {
      setDeprecating(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Promotion</span>
        </div>
        <div className="px-4 py-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking promotion status…
        </div>
      </div>
    );
  }

  if (!status) return null;

  const isDeprecated = status.locked;

  return (
    <>
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Promotion</span>
        <span className="ml-auto text-[10px] text-muted-foreground capitalize">{status.lifecycle}</span>
      </div>

      {isDeprecated && (
        <div className="px-4 py-3 border-b border-border bg-red-50 dark:bg-red-950/20">
          <div className="flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
            <XCircle className="h-4 w-4 shrink-0" />
            <span className="font-medium">This entity is deprecated and locked from further promotion.</span>
          </div>
        </div>
      )}

      {!isDeprecated && !status.baseReady && (
        <div className="px-4 py-3 border-b border-border bg-amber-50 dark:bg-amber-950/20">
          <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
            <Clock className="h-4 w-4 shrink-0" />
            <span className="font-medium">Scaffold PR not merged yet — merge the base manifests in gitops-infra before creating overlays.</span>
          </div>
        </div>
      )}

      <div className="divide-y divide-border">
        {ENV_ORDER.map((env) => {
          const meta = ENV_META[env];
          const overlayKey = meta.overlayKey;
          const overlay = status.overlays[overlayKey];
          const tag = status.tags[overlayKey];
          const isCurrent = status.lifecycle === env;
          const isSubmitting = submitting === env;

          // What action is available?
          const overlayExists = overlay.exists;
          const openPR = overlay.openPR;

          // Can this user act on this environment?
          const canActDev = (env === "development" && (isMember || canElevate));
          const canActElevated = (env !== "development" && canElevate);
          const canAct = !isDeprecated && (canActDev || canActElevated);

          // Promotion is strictly forward: block any action that would downgrade the lifecycle.
          // A row below the current lifecycle shows as "Deployed" with an Edit button only.
          const isBelowCurrent = ENV_LEVEL[env] < (LIFECYCLE_LEVEL[status.lifecycle] ?? 0);

          // Step A: overlay doesn't exist → create overlay (only valid at/above current lifecycle)
          const needsOverlayPR = !isBelowCurrent && !overlayExists && !openPR;
          // PR open, waiting for merge
          const prPending = !isBelowCurrent && !overlayExists && !!openPR;
          // Overlay exists but lifecycle not yet confirmed (only valid above current — below means already moved on)
          const needsConfirm = !isBelowCurrent && overlayExists && !isCurrent;
          // Live at the current lifecycle stage
          const done = overlayExists && isCurrent;
          // Already deployed at a lower stage — show edit only, no warning/confirm
          const deployedBelow = isBelowCurrent && overlayExists;

          return (
            <div key={env} className={cn("px-4 py-3", isCurrent && meta.bg)}>
              <div className="flex items-center gap-2.5 min-h-[2rem]">
                <span className={cn("h-2 w-2 rounded-full shrink-0", meta.dot)} />
                <span className={cn("text-sm font-medium", isCurrent ? meta.text : "text-foreground")}>
                  {meta.label}
                </span>

                {/* Status indicator */}
                {done && (
                  <span className={cn("ml-1 inline-flex items-center gap-1 text-[11px] font-medium", meta.text)}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Live
                  </span>
                )}
                {deployedBelow && (
                  <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Deployed
                  </span>
                )}
                {prPending && (
                  <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                    <Clock className="h-3.5 w-3.5" /> PR #{openPR} pending
                  </span>
                )}
                {needsConfirm && canAct && (
                  <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                    <AlertTriangle className="h-3.5 w-3.5" /> Overlay merged, lifecycle not confirmed
                  </span>
                )}

                {/* Tag badge — always right-aligned, coloured border pill */}
                {tag && (
                  <span
                    className={cn(
                      "ml-auto inline-flex items-center rounded-md border px-1.5 py-0.5",
                      "font-mono text-[10px] font-medium leading-none",
                      meta.bg, meta.border, meta.text,
                    )}
                    title={tag.tag}
                  >
                    {shortTag(tag.tag)}
                  </span>
                )}

                {/* Edit overlay button — shown for Live and Deployed rows */}
                {(done || deployedBelow) && canAct && (
                  <button
                    onClick={() => openEditWizard(env)}
                    disabled={loadingOverlay === env}
                    title={env === "development" ? "Edit overlay — applies directly" : "Edit overlay — opens PR"}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                      meta.border, meta.text, meta.bg,
                      "hover:brightness-95 dark:hover:brightness-110",
                    )}
                  >
                    {loadingOverlay === env
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Pencil className="h-3 w-3" />}
                    Edit
                  </button>
                )}

                {/* Action button — only for at/above current lifecycle (no downgrade) */}
                {!isDeprecated && canAct && (needsOverlayPR || needsConfirm) && (
                  <div className="ml-auto">
                    {needsOverlayPR && (
                      <button
                        onClick={() => {
                          setWizardMode("create");
                          setOverlayConfig({
                            ...defaultConfig,
                            dbName: effectiveDatabaseEnabled ? (dbName || `${entityName}-db`) : "",
                          });
                          if (status.baseReady) setWizardEnv(env);
                        }}
                        disabled={!status.baseReady}
                        title={!status.baseReady ? "Scaffold PR must be merged first" : undefined}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                          status.baseReady
                            ? "bg-primary/10 hover:bg-primary/20 text-primary"
                            : "bg-muted text-muted-foreground cursor-not-allowed opacity-50",
                        )}
                      >
                        Create overlay
                        <ChevronRight className="h-3 w-3" />
                      </button>
                    )}
                    {needsConfirm && (
                      <button
                        onClick={() => handleConfirm(env)}
                        disabled={isSubmitting}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                          meta.text, meta.bg, "border", meta.border,
                          "disabled:opacity-50",
                        )}
                      >
                        {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                        Confirm
                      </button>
                    )}
                  </div>
                )}
              </div>

            </div>
          );
        })}
      </div>

      {/* Deprecation trigger */}
      {canElevate && !isDeprecated && (
        <div className="px-4 py-3 border-t border-border">
          <button
            onClick={() => setShowDeprecateDialog(true)}
            className="inline-flex items-center gap-2 rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/50 hover:border-red-400 dark:hover:border-red-700 transition-colors"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Deprecate this service
          </button>
        </div>
      )}

      {/* Deprecation confirm dialog */}
      {showDeprecateDialog && (
        <DeprecateDialog
          entityName={entityName}
          onConfirm={handleDeprecate}
          onCancel={() => setShowDeprecateDialog(false)}
          loading={deprecating}
        />
      )}
    </div>

    {/* Overlay creation wizard — rendered outside the panel div so the fixed
        backdrop covers the full viewport without being clipped by overflow */}
    {wizardEnv && (
      <OverlayWizardModal
        env={wizardEnv}
        mode={wizardMode}
        team={team}
        appName={entityName}
        ingressEnabled={effectiveIngressEnabled || effectiveCertEnabled}
        vaultEnabled={effectiveVaultEnabled}
        databaseEnabled={effectiveDatabaseEnabled}
        certEnabled={effectiveCertEnabled}
        config={overlayConfig}
        setConfig={setOverlayConfig}
        submitting={submitting === wizardEnv}
        onClose={() => { setWizardEnv(null); setWizardMode("create"); setOverlayConfig(defaultConfig); }}
        onSubmit={() => handleCreateOverlay(wizardEnv)}
      />
    )}
    </>
  );
}
