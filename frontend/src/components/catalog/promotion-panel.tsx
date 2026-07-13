"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, CheckCircle2, Clock, AlertTriangle, ChevronRight, ChevronLeft, Loader2, XCircle, X, Pencil, Terminal, ChevronDown, KeyRound, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { addNotification } from "@/lib/notifications";
import { KeyValueEditor } from "@/components/scaffold/key-value-editor";

// ── Shared modal utilities ────────────────────────────────────────────────────

/** Locks body scroll and moves browser focus to the dialog panel on open. */
function useModalFocus(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => { document.body.style.overflow = prev; };
  }, [ref]);
}

// ── Deprecation confirm dialog ────────────────────────────────────────────────
interface DeprecateDialogProps {
  entityName: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  loading: boolean;
}

function DeprecateDialog({ entityName, onConfirm, onCancel, loading }: DeprecateDialogProps) {
  const [reason, setReason] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useModalFocus(dialogRef);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !loading) onCancel(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [loading, onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onCancel(); }}
    >
      {/* Panel */}
      <div ref={dialogRef} tabIndex={-1} className="w-full max-w-md rounded-xl border border-red-200 dark:border-red-800 bg-background shadow-xl outline-none">
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
    </div>,
    document.body,
  );
}

interface EnvVersion {
  tag: string;
  date: string;
}

interface OverlayStatus {
  exists: boolean;
  openPR?: number;
  darlaneEnabled?: boolean;
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
  // Vault UI config from backend — avoids duplicating VAULT_ADDR / VAULT_KV_MOUNT as NEXT_PUBLIC_* vars.
  vaultAddr?: string;
  vaultKvMount?: string;
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
  originalConfig?: OverlayConfigState;
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

function OverlayWizardModal({ env, mode, originalConfig, team, appName, ingressEnabled, vaultEnabled, databaseEnabled, certEnabled, config, setConfig, submitting, onClose, onSubmit }: OverlayWizardProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const meta = ENV_META[env];
  const envName = meta.overlayKey;
  const vaultKey = `${team}/${appName}/${envName}/env`;

  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef);

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

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div ref={dialogRef} tabIndex={-1} className="w-full max-w-2xl rounded-xl border border-border bg-background shadow-xl flex flex-col max-h-[90vh] outline-none">

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
            <div className="p-6 space-y-5 overflow-y-auto">
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

              {/* Vault secrets — editor on create, direct Vault link on edit */}
              {vaultEnabled && mode === "create" && (
                <div className="space-y-3">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Vault secrets</p>
                  <p className="text-xs font-mono text-foreground">{vaultKey}</p>
                  <KeyValueEditor
                    pairs={config.vaultSecrets}
                    onChange={(pairs) => setConfig((p) => ({ ...p, vaultSecrets: pairs }))}
                    keyPlaceholder="SECRET_KEY"
                    valuePlaceholder="value"
                    allowImport
                    secret
                  />
                  <p className={hintCls}>
                    Required — written to Vault at <span className="font-mono">{vaultKey}</span> before the overlay is committed.
                    Only the provided keys are written; existing secrets at this path are preserved.
                  </p>
                </div>
              )}
              {vaultEnabled && mode === "edit" && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3">
                  <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    Vault secrets configured at{" "}
                    <span className="font-mono text-foreground">{vaultKey}</span>
                    {" "}— edit from the Vault button on the promotion panel.
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
            <div className="p-6 space-y-5 overflow-y-auto">
              {/* Summary card */}
              <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold">{mode === "edit" ? "What will change" : "What will be created"}</p>
                  {mode === "edit" && (
                    <div className="flex items-center gap-3 text-[10px]">
                      <span className="text-green-600 dark:text-green-400 font-semibold">+ added</span>
                      <span className="text-amber-500 dark:text-amber-400 font-semibold">~ changed</span>
                      <span className="text-red-500 dark:text-red-400 font-semibold">− removed</span>
                    </div>
                  )}
                </div>
                <p className={hintCls}>
                  3 files in{" "}
                  <span className="font-mono">tenants-apps/{team}/{appName}/overlays/{envName}/</span>
                </p>
                <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs">
                  {/* XR name and Vault key are derived — no diff badge needed */}
                  <span className="text-muted-foreground">XR name</span>
                  <span className="font-mono">{envName === "dev" ? `${team}-${appName}` : `${team}-${appName}-${envName}`}</span>
                  <span className="text-muted-foreground">Vault key</span>
                  <span className="font-mono">{vaultKey}</span>

                  <span className="text-muted-foreground">Replicas</span>
                  <span className="font-mono flex items-center gap-2">
                    {config.replicas || "1 (default)"}
                    {mode === "edit" && <DiffBadge status={diffStatus(originalConfig?.replicas ?? "", config.replicas, "")} />}
                  </span>

                  {(config.ingressHost || (mode === "edit" && originalConfig?.ingressHost)) && (
                    <>
                      <span className="text-muted-foreground">Ingress host</span>
                      <span className="font-mono flex items-center gap-2">
                        {config.ingressHost || <span className="text-muted-foreground/50 italic">removed</span>}
                        <span className="text-muted-foreground/60 text-[10px]">(kustomization patch)</span>
                        {mode === "edit" && <DiffBadge status={diffStatus(originalConfig?.ingressHost ?? "", config.ingressHost, "")} />}
                      </span>
                    </>
                  )}

                  {(config.cpuReq || config.cpuLim || (mode === "edit" && (originalConfig?.cpuReq || originalConfig?.cpuLim))) && (
                    <>
                      <span className="text-muted-foreground">CPU req / lim</span>
                      <span className="font-mono flex items-center gap-2">
                        {config.cpuReq || "—"} / {config.cpuLim || "—"}
                        {mode === "edit" && <DiffBadge status={diffStatus(
                          `${originalConfig?.cpuReq ?? ""}/${originalConfig?.cpuLim ?? ""}`,
                          `${config.cpuReq}/${config.cpuLim}`, "/"
                        )} />}
                      </span>
                    </>
                  )}

                  {(config.memReq || config.memLim || (mode === "edit" && (originalConfig?.memReq || originalConfig?.memLim))) && (
                    <>
                      <span className="text-muted-foreground">Mem req / lim</span>
                      <span className="font-mono flex items-center gap-2">
                        {config.memReq || "—"} / {config.memLim || "—"}
                        {mode === "edit" && <DiffBadge status={diffStatus(
                          `${originalConfig?.memReq ?? ""}/${originalConfig?.memLim ?? ""}`,
                          `${config.memReq}/${config.memLim}`, "/"
                        )} />}
                      </span>
                    </>
                  )}

                  {vaultEnabled && mode === "create" && config.vaultSecrets.filter(v => v.key).length > 0 && (
                    <>
                      <span className="text-muted-foreground">Vault secrets</span>
                      <span className="font-mono text-green-600 dark:text-green-400">
                        {config.vaultSecrets.filter(v => v.key).length} key{config.vaultSecrets.filter(v => v.key).length > 1 ? "s" : ""} → {vaultKey}
                      </span>
                    </>
                  )}
                  {vaultEnabled && mode === "edit" && (
                    <>
                      <span className="text-muted-foreground">Vault secrets</span>
                      <span className="text-muted-foreground/60 italic">managed in Vault directly</span>
                    </>
                  )}

                  {databaseEnabled && (
                    <>
                      <span className="text-muted-foreground">DB name</span>
                      <span className="font-mono flex items-center gap-2">
                        {config.dbName || `${appName}-${envName}-db`}
                        {mode === "edit" && <DiffBadge status={diffStatus(originalConfig?.dbName ?? "", config.dbName, "")} />}
                      </span>
                      <span className="text-muted-foreground">Tier / env</span>
                      <span className="font-mono flex items-center gap-2">
                        {config.dbTier || "shared"} / {config.dbEnvironment || toDbEnv(envName)}
                        {config.dbEnvironment && config.dbEnvironment !== toDbEnv(envName) && (
                          <span className="text-muted-foreground/60">(overridden)</span>
                        )}
                        {mode === "edit" && <DiffBadge status={diffStatus(
                          `${originalConfig?.dbTier ?? "shared"}/${originalConfig?.dbEnvironment ?? ""}`,
                          `${config.dbTier || "shared"}/${config.dbEnvironment}`, "shared/"
                        )} />}
                      </span>
                    </>
                  )}

                  {databaseEnabled && config.dbTier === "shared" && (config.dbClusterRef || (mode === "edit" && originalConfig?.dbClusterRef)) && (
                    <>
                      <span className="text-muted-foreground">Cluster ref</span>
                      <span className="font-mono flex items-center gap-2">
                        {config.dbClusterRef
                          ? `${config.dbClusterRef}${config.dbClusterNamespace ? ` / ${config.dbClusterNamespace}` : ""}`
                          : <span className="text-muted-foreground/50 italic">removed</span>}
                        {mode === "edit" && <DiffBadge status={diffStatus(
                          `${originalConfig?.dbClusterRef ?? ""}/${originalConfig?.dbClusterNamespace ?? ""}`,
                          `${config.dbClusterRef}/${config.dbClusterNamespace}`, "/"
                        )} />}
                      </span>
                    </>
                  )}

                  {databaseEnabled && config.dbTier === "dedicated" && (config.dbInstances || config.dbStorageSize || config.dbPostgresVersion) && (
                    <>
                      <span className="text-muted-foreground">Dedicated cluster</span>
                      <span className="font-mono flex items-center gap-2">
                        {[
                          config.dbInstances ? `${config.dbInstances} instance${config.dbInstances !== "1" ? "s" : ""}` : null,
                          config.dbStorageSize || "1Gi",
                          `pg${config.dbPostgresVersion || "16"}`,
                          config.dbEnablePooler ? "pooler" : null,
                        ].filter(Boolean).join(" · ")}
                        {mode === "edit" && <DiffBadge status={diffStatus(
                          `${originalConfig?.dbInstances}/${originalConfig?.dbStorageSize}/${originalConfig?.dbPostgresVersion}/${originalConfig?.dbEnablePooler}`,
                          `${config.dbInstances}/${config.dbStorageSize}/${config.dbPostgresVersion}/${config.dbEnablePooler}`, "///"
                        )} />}
                      </span>
                    </>
                  )}

                  {certEnabled && (config.certIssuer || (mode === "edit" && originalConfig?.certIssuer)) && (
                    <>
                      <span className="text-muted-foreground">ClusterIssuer</span>
                      <span className="font-mono flex items-center gap-2">
                        {config.certIssuer || <span className="text-muted-foreground/50 italic">removed</span>}
                        {mode === "edit" && <DiffBadge status={diffStatus(originalConfig?.certIssuer ?? "", config.certIssuer, "")} />}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* kustomization.yaml preview */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">kustomization.yaml</p>
                <DiffYamlPreview
                  after={buildKustPreview(team, appName, envName, config, databaseEnabled)}
                  before={mode === "edit" && originalConfig ? buildKustPreview(team, appName, envName, originalConfig, databaseEnabled) : undefined}
                />
              </div>

              {/* patch-xtenant-app.yaml preview */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">patch-xtenant-app.yaml</p>
                <DiffYamlPreview
                  after={buildPatchPreview(team, appName, envName, config)}
                  before={mode === "edit" && originalConfig ? buildPatchPreview(team, appName, envName, originalConfig) : undefined}
                />
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
    </div>,
    document.body,
  );
}

// ── Darlane wizard ───────────────────────────────────────────────────────────

interface EnvVar { name: string; value: string; }

interface DarlaneConfig {
  replicas: string;
  command: string;
  fileSync: boolean;
  mountPath: string;
  initFromImage: boolean;
  ttl: string;
  cpuReq: string;
  cpuLim: string;
  memReq: string;
  memLim: string;
  // feature flags / env overrides
  envVars: EnvVar[];
  // A/B traffic
  trafficWeight: string;   // "0"=debug only, "1"–"99"=A/B split, "100"=full canary
  stickySession: boolean;
  cookieName: string;
  sameSite: "lax" | "strict" | "none";
  secure: boolean;
  // header routing
  headerRoutingEnabled: boolean;
  headerRoutingHeader: string;
  headerRoutingValue: string;
  // port overrides
  containerPort: string;
  telemetryPort: string;
  // production safety
  productionOverride: boolean;
}

const defaultDarlaneConfig: DarlaneConfig = {
  replicas: "0",
  command: "",
  fileSync: false,
  mountPath: "/app",
  initFromImage: true,
  ttl: "4h",
  cpuReq: "",
  cpuLim: "",
  memReq: "",
  memLim: "",
  envVars: [],
  trafficWeight: "0",
  stickySession: false,
  cookieName: "",
  sameSite: "lax",
  secure: true,
  headerRoutingEnabled: false,
  headerRoutingHeader: "X-Target-Env",
  headerRoutingValue: "darlane",
  containerPort: "",
  telemetryPort: "",
  productionOverride: false,
};

function buildDarlanePreview(cfg: DarlaneConfig): string {
  const lines: string[] = ["- op: add", "  path: /spec/parameters/darlane", "  value:"];
  lines.push("    enabled: true");
  const r = parseInt(cfg.replicas, 10);
  if (!isNaN(r)) lines.push(`    replicas: ${r}`);
  if (cfg.ttl) lines.push(`    ttl: ${cfg.ttl}`);
  if (cfg.command.trim()) {
    lines.push("    command:");
    // Bare integers (e.g. port numbers) must be single-quoted — YAML parses unquoted
    // digits as int but K8s container command arrays require []string.
    cfg.command.trim().split(/\s+/).forEach((token) => {
      lines.push(/^\d+$/.test(token) ? `    - '${token}'` : `    - ${token}`);
    });
  }
  if (cfg.fileSync) {
    lines.push("    fileSync:");
    lines.push("      enabled: true");
    if (cfg.mountPath) lines.push(`      mountPath: ${cfg.mountPath}`);
    lines.push(`      initFromImage: ${cfg.initFromImage ? "true" : "false"}`);
  }
  if (cfg.cpuReq || cfg.cpuLim || cfg.memReq || cfg.memLim) {
    lines.push("    resources:");
    if (cfg.cpuReq || cfg.memReq) {
      lines.push("      requests:");
      if (cfg.cpuReq) lines.push(`        cpu: ${cfg.cpuReq}`);
      if (cfg.memReq) lines.push(`        memory: ${cfg.memReq}`);
    }
    if (cfg.cpuLim || cfg.memLim) {
      lines.push("      limits:");
      if (cfg.cpuLim) lines.push(`        cpu: ${cfg.cpuLim}`);
      if (cfg.memLim) lines.push(`        memory: ${cfg.memLim}`);
    }
  }
  const validEnvVars = cfg.envVars.filter((v) => v.name.trim());
  if (validEnvVars.length > 0) {
    lines.push("    env:");
    validEnvVars.forEach((v) => {
      lines.push(`    - name: ${v.name}`);
      lines.push(`      value: "${v.value}"`);
    });
  }
  const tw = parseInt(cfg.trafficWeight, 10);
  if (!isNaN(tw) && tw > 0) {
    lines.push(`    trafficWeight: ${tw}`);
    if (cfg.stickySession) {
      lines.push("    stickySession:");
      lines.push("      enabled: true");
      if (cfg.cookieName) lines.push(`      cookieName: ${cfg.cookieName}`);
      lines.push(`      secure: ${cfg.secure}`);
      lines.push(`      sameSite: ${cfg.sameSite}`);
    }
  }
  // Ports must be single-quoted strings — CRD field type is string, not integer.
  if (cfg.headerRoutingEnabled) {
    lines.push("    headerRouting:");
    lines.push("      enabled: true");
    if (cfg.headerRoutingHeader) lines.push(`      header: ${cfg.headerRoutingHeader}`);
    if (cfg.headerRoutingValue) lines.push(`      value: ${cfg.headerRoutingValue}`);
  }
  if (cfg.containerPort) lines.push(`    containerPort: '${parseInt(cfg.containerPort, 10)}'`);
  if (cfg.telemetryPort) lines.push(`    telemetryPort: '${parseInt(cfg.telemetryPort, 10)}'`);
  if (cfg.productionOverride) lines.push("    productionOverride: true");
  return lines.join("\n");
}

// ── Diff helpers for the reconfigure review step ──────────────────────────────

type DiffStatus = "added" | "changed" | "removed" | "same";

function diffStatus(orig: string | boolean | undefined | null, curr: string | boolean | undefined, empty: string | boolean = ""): DiffStatus {
  const origEmpty = orig === undefined || orig === null || orig === empty;
  const currEmpty = curr === undefined || curr === null || curr === empty;
  if (origEmpty && !currEmpty) return "added";
  if (!origEmpty && currEmpty) return "removed";
  if (!origEmpty && !currEmpty && orig !== curr) return "changed";
  return "same";
}

function DiffBadge({ status }: { status: DiffStatus }) {
  if (status === "same") return null;
  const cls = {
    added:   "text-green-600 dark:text-green-400",
    changed: "text-amber-500 dark:text-amber-400",
    removed: "text-red-500 dark:text-red-400",
  }[status];
  const label = { added: "+ added", changed: "~ changed", removed: "− removed" }[status];
  return <span className={cn("text-[10px] font-semibold shrink-0", cls)}>{label}</span>;
}

// ── YAML diff preview ─────────────────────────────────────────────────────────

type LineDiff = { text: string; status: "same" | "added" | "removed" };

function diffLines(before: string, after: string): LineDiff[] {
  const a = before.split("\n");
  const b = after.split("\n");
  // LCS dp table
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  // Backtrack
  const result: LineDiff[] = [];
  let i = a.length, j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ text: a[i - 1], status: "same" });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ text: b[j - 1], status: "added" });
      j--;
    } else {
      result.unshift({ text: a[i - 1], status: "removed" });
      i--;
    }
  }
  return result;
}

function DiffYamlPreview({ after, before }: { after: string; before?: string }) {
  if (!before || before === after) {
    return (
      <pre className="rounded-lg border border-border bg-muted/30 px-4 py-4 text-xs font-mono leading-6 overflow-x-auto whitespace-pre">
        {after}
      </pre>
    );
  }
  const lines = diffLines(before, after);
  const hasDiff = lines.some((l) => l.status !== "same");
  return (
    <pre className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-[11px] font-mono leading-relaxed overflow-x-auto whitespace-pre">
      {hasDiff && (
        <span className="block mb-2 flex gap-3 font-sans text-[10px] not-italic">
          <span className="text-green-600 dark:text-green-400 font-semibold">+ added</span>
          <span className="text-red-500 dark:text-red-400 font-semibold">− removed</span>
          <span className="text-muted-foreground">unchanged</span>
        </span>
      )}
      {lines.map((line, idx) => {
        if (line.status === "added") {
          return (
            <span key={idx} className="block bg-green-500/10 text-green-700 dark:text-green-400">
              {"+"} {line.text}
            </span>
          );
        }
        if (line.status === "removed") {
          return (
            <span key={idx} className="block bg-red-500/10 text-red-600 dark:text-red-400 line-through opacity-70">
              {"−"} {line.text}
            </span>
          );
        }
        return <span key={idx} className="block">{" "} {line.text}</span>;
      })}
    </pre>
  );
}

interface DarlaneWizardModalProps {
  env: Env;
  entityKind: string;
  entityName: string;
  mode: "enable" | "reconfigure";
  originalConfig?: DarlaneConfig;
  config: DarlaneConfig;
  setConfig: (c: DarlaneConfig) => void;
  submitting: boolean;
  ingressEnabled: boolean;
  onClose: () => void;
  onSubmit: () => void;
}

function DarlaneWizardModal({ env, mode, originalConfig, config, setConfig, submitting, ingressEnabled, onClose, onSubmit }: DarlaneWizardModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const meta = ENV_META[env];
  const hintCls = "text-xs text-muted-foreground";
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !submitting) onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [submitting, onClose]);

  function field(label: string, hint: string, input: React.ReactNode) {
    return (
      <div className="space-y-1">
        <label className="text-xs font-medium">{label}</label>
        {hint && <p className={hintCls}>{hint}</p>}
        {input}
      </div>
    );
  }

  const inputCls = "w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-wxops-green/40";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div ref={dialogRef} tabIndex={-1} className="w-full max-w-2xl rounded-xl border border-wxops-green/30 bg-background shadow-xl flex flex-col max-h-[90vh] outline-none">
        {/* Header */}
        <div className="flex items-center gap-3 p-5 border-b border-border shrink-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-wxops-green/10">
            <Terminal className="h-5 w-5 text-wxops-green" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{mode === "reconfigure" ? "Reconfigure Darlane" : "Enable Darlane"}</p>
            <p className={cn("text-xs mt-0.5", meta.text)}>{meta.label} overlay</p>
          </div>
          {/* Step pills */}
          <div className="flex items-center gap-1.5">
            {([1, 2] as const).map((s) => (
              <span key={s} className={cn(
                "h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-semibold border",
                step === s ? cn("text-wxops-green border-wxops-green/40 bg-wxops-green/10") : "text-muted-foreground border-border bg-muted/30",
              )}>{s}</span>
            ))}
          </div>
          <button onClick={onClose} disabled={submitting} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step 1: Configure */}
        {step === 1 && (
          <>
            <div className="p-6 space-y-5 overflow-y-auto">
              {field("Replicas (at rest)", "0 = scales to zero between debug sessions. Increase to keep the dev pod always running.", (
                <input type="number" min={0} value={config.replicas}
                  onChange={(e) => setConfig({ ...config, replicas: e.target.value })}
                  className={cn(inputCls, "w-24")} />
              ))}

              {/* Start command */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Start command</label>
                <p className={hintCls}>
                  Overrides the container entrypoint. Leave blank to use{" "}
                  <code className="font-mono text-[11px]">sleep infinity</code> (default) — exec into the idle pod to run commands manually.
                </p>
                <input
                  type="text"
                  value={config.command}
                  placeholder="sleep infinity"
                  onChange={(e) => setConfig({ ...config, command: e.target.value })}
                  className={inputCls}
                />
                {/* Quick-select presets */}
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {[
                    { label: "sleep ∞",  cmd: "",                                                                          hint: "Idle shell — exec target only" },
                    { label: "uvicorn",  cmd: "uvicorn main:app --reload --host 0.0.0.0 --port 8080",                     hint: "Python FastAPI / Starlette" },
                    { label: "flask",    cmd: "flask run --host 0.0.0.0 --port 8080",                                     hint: "Python Flask" },
                    { label: "django",   cmd: "python manage.py runserver 0.0.0.0:8080",                                  hint: "Django dev server" },
                    { label: "node",     cmd: "PORT=8080 node --watch index.js",                                          hint: "Node.js watch mode" },
                    { label: "nodemon",  cmd: "PORT=8080 nodemon index.js",                                               hint: "Node.js nodemon" },
                    { label: "air",      cmd: "air",                                                                       hint: "Go hot reload (port in .air.toml / main.go)" },
                    { label: "npm dev",  cmd: "npm run dev -- --port 8080",                                               hint: "Vite / Next.js dev server" },
                    { label: "gradle",   cmd: "./gradlew bootRun --args='--server.port=8080'",                            hint: "Spring Boot Gradle" },
                    { label: "mvn",      cmd: "mvn spring-boot:run -Dspring-boot.run.arguments=--server.port=8080",       hint: "Spring Boot Maven" },
                  ].map(({ label, cmd, hint }) => {
                    const isActive = config.command === cmd;
                    return (
                      <button
                        key={label}
                        type="button"
                        title={hint}
                        onClick={() => setConfig({ ...config, command: cmd })}
                        className={cn(
                          "rounded-md border px-2 py-0.5 text-[11px] font-mono transition-colors",
                          isActive
                            ? "border-wxops-green/50 bg-wxops-green/10 text-wxops-green"
                            : "border-border bg-muted/30 text-muted-foreground hover:border-wxops-green/30 hover:text-foreground",
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input type="checkbox" checked={config.fileSync}
                    onChange={(e) => setConfig({ ...config, fileSync: e.target.checked })}
                    className="rounded border-border accent-wxops-green" />
                  <span className="font-medium">File sync</span>
                  <span className={hintCls}>— writable volume for mutagen / VS Code Remote</span>
                </label>
                {config.fileSync && (
                  <div className="pl-5 space-y-3">
                    <div>
                      <label className={cn(hintCls, "mb-1 block")}>Mount path</label>
                      <input type="text" value={config.mountPath} placeholder="/app"
                        onChange={(e) => setConfig({ ...config, mountPath: e.target.value })}
                        className={cn(inputCls, "w-48")} />
                    </div>
                    <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                      <input type="checkbox" checked={config.initFromImage}
                        onChange={(e) => setConfig({ ...config, initFromImage: e.target.checked })}
                        className="rounded border-border accent-wxops-green" />
                      <span className="font-medium">Seed volume from pod image</span>
                      <span className={hintCls}>— init container copies the pod&apos;s filesystem into the writable volume before sync starts</span>
                    </label>
                  </div>
                )}
              </div>

              {field("TTL", "Auto scale-down after this duration of inactivity.", (
                <select value={config.ttl} onChange={(e) => setConfig({ ...config, ttl: e.target.value })}
                  className={cn(inputCls, "w-32")}>
                  {["1h","2h","4h","8h","12h","24h"].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              ))}

              <details className="group">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none list-none flex items-center gap-1">
                  <ChevronDown className="h-3.5 w-3.5 group-open:rotate-180 transition-transform" />
                  Resources <span className="font-normal">(optional — CPU &amp; memory override for the dev pod)</span>
                </summary>
                <div className="mt-3 grid grid-cols-2 gap-3 pl-4">
                  {[
                    ["CPU request", "cpuReq", "100m"],
                    ["CPU limit", "cpuLim", "500m"],
                    ["Memory request", "memReq", "128Mi"],
                    ["Memory limit", "memLim", "512Mi"],
                  ].map(([lbl, key, ph]) => (
                    <div key={key}>
                      <label className={cn(hintCls, "mb-1 block")}>{lbl}</label>
                      <input type="text" value={(config as unknown as Record<string, string>)[key] ?? ""} placeholder={ph}
                        onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
                        className={inputCls} />
                    </div>
                  ))}
                </div>
              </details>

              {/* ── Feature flags / env overrides ──────────────────────── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium">Feature flags / env overrides</label>
                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, envVars: [...config.envVars, { name: "", value: "" }] })}
                    className="text-[11px] text-wxops-green hover:underline"
                  >+ Add variable</button>
                </div>
                <p className={hintCls}>Override or add env vars on the Darlane pod (e.g. <code className="font-mono">FEATURE_NEW_RANKING=&quot;true&quot;</code>).</p>
                {config.envVars.length === 0 && (
                  <p className="text-[11px] text-muted-foreground/50 italic">No overrides — Darlane pod inherits the main app env.</p>
                )}
                {config.envVars.map((ev, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input
                      type="text" placeholder="NAME"
                      value={ev.name}
                      onChange={(e) => {
                        const next = [...config.envVars];
                        next[i] = { ...ev, name: e.target.value };
                        setConfig({ ...config, envVars: next });
                      }}
                      className={cn(inputCls, "flex-1")}
                    />
                    <input
                      type="text" placeholder="value"
                      value={ev.value}
                      onChange={(e) => {
                        const next = [...config.envVars];
                        next[i] = { ...ev, value: e.target.value };
                        setConfig({ ...config, envVars: next });
                      }}
                      className={cn(inputCls, "flex-1")}
                    />
                    <button
                      type="button"
                      onClick={() => setConfig({ ...config, envVars: config.envVars.filter((_, j) => j !== i) })}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    ><X className="h-3.5 w-3.5" /></button>
                  </div>
                ))}

                {/* Feature flag explainer */}
                <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 space-y-1.5 text-[11px] mt-1">
                  <p className="font-semibold text-amber-600 dark:text-amber-400">How feature flags work with Darlane</p>
                  <p className="text-muted-foreground leading-relaxed">
                    Darlane runs the <span className="font-medium">same image</span> as your main deployment but with a different environment.
                    Variables defined here are injected only into the Darlane pod — the main deployment is untouched.
                    Your app reads them at startup with <code className="font-mono">os.getenv</code> / <code className="font-mono">process.env</code> and branches accordingly.
                  </p>
                  <div className="space-y-0.5 text-muted-foreground">
                    <p className="font-medium text-foreground/70">Common patterns:</p>
                    <p>· <code className="font-mono">FEATURE_X=true</code> — boolean gate checked in the app</p>
                    <p>· <code className="font-mono">RANKING_MODEL=v2</code> — swap algorithm variant at runtime</p>
                    <p>· <code className="font-mono">LOG_LEVEL=debug</code> — increase verbosity only on the debug pod</p>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    Combine with <span className="font-medium">Traffic weight</span> below to gradually roll the flagged variant
                    to real users, and enable <span className="font-medium">Sticky session</span> so each user consistently
                    sees the same variant throughout their session.
                  </p>
                </div>
              </div>

              {/* ── Traffic & A/B ───────────────────────────────────────── */}
              {ingressEnabled && (
                <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Traffic routing / A/B</p>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Traffic weight</label>
                    <p className={hintCls}>% of ingress traffic routed to the Darlane pod · <span className="font-mono">0</span> = debug only · <span className="font-mono">1–99</span> = A/B split · <span className="font-mono">100</span> = full canary</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="number" min={0} max={100}
                        value={config.trafficWeight}
                        onChange={(e) => setConfig({ ...config, trafficWeight: e.target.value })}
                        className={cn(inputCls, "w-20")}
                      />
                      <span className={hintCls}>%</span>
                    </div>
                  </div>
                  {parseInt(config.trafficWeight, 10) > 0 && (
                    <div className="space-y-3 pl-3 border-l border-border/50">
                      <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                        <input type="checkbox" checked={config.stickySession}
                          onChange={(e) => setConfig({ ...config, stickySession: e.target.checked })}
                          className="rounded border-border accent-wxops-green" />
                        <span className="font-medium">Sticky session</span>
                        <span className={hintCls}>— pin each user to the same backend per session</span>
                      </label>
                      {config.stickySession && (
                        <div className="pl-5 space-y-2">
                          <div>
                            <label className={cn(hintCls, "mb-1 block")}>Cookie name</label>
                            <input type="text" value={config.cookieName} placeholder="darlane-ab"
                              onChange={(e) => setConfig({ ...config, cookieName: e.target.value })}
                              className={cn(inputCls, "w-48")} />
                          </div>
                          <div className="flex items-center gap-6">
                            <div>
                              <label className={cn(hintCls, "mb-1 block")}>SameSite</label>
                              <select value={config.sameSite}
                                onChange={(e) => setConfig({ ...config, sameSite: e.target.value as "lax" | "strict" | "none" })}
                                className={cn(inputCls, "w-28")}>
                                <option value="lax">lax</option>
                                <option value="strict">strict</option>
                                <option value="none">none</option>
                              </select>
                            </div>
                            <label className="flex items-center gap-2 text-xs cursor-pointer select-none mt-4">
                              <input type="checkbox" checked={config.secure}
                                onChange={(e) => setConfig({ ...config, secure: e.target.checked })}
                                className="rounded border-border accent-wxops-green" />
                              <span className="font-medium">Secure</span>
                              <span className={hintCls}>— HTTPS only</span>
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Header routing ──────────────────────────────────── */}
                  <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                      <input type="checkbox" checked={config.headerRoutingEnabled}
                        onChange={(e) => setConfig({ ...config, headerRoutingEnabled: e.target.checked })}
                        className="rounded border-border accent-wxops-green" />
                      <span className="font-medium">Header routing</span>
                      <span className={hintCls}>— pin requests by header, bypasses traffic weight</span>
                    </label>
                    {config.headerRoutingEnabled && (
                      <div className="pl-5 space-y-2">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className={cn(hintCls, "mb-1 block")}>Header name</label>
                            <input type="text" value={config.headerRoutingHeader} placeholder="X-Target-Env"
                              onChange={(e) => setConfig({ ...config, headerRoutingHeader: e.target.value })}
                              className={inputCls} />
                          </div>
                          <div>
                            <label className={cn(hintCls, "mb-1 block")}>Header value</label>
                            <input type="text" value={config.headerRoutingValue} placeholder="darlane"
                              onChange={(e) => setConfig({ ...config, headerRoutingValue: e.target.value })}
                              className={inputCls} />
                          </div>
                        </div>
                        <p className={hintCls}>
                          Request with this exact header→value is always routed to the Darlane pod, regardless of{" "}
                          <span className="font-mono">trafficWeight</span>. Works with{" "}
                          <span className="font-mono">trafficWeight: 0</span> — real users see nothing, you target Darlane explicitly.
                        </p>
                        {config.headerRoutingHeader && config.headerRoutingValue && (
                          <pre className="rounded bg-muted/40 border border-border px-2 py-1.5 text-[10px] font-mono text-muted-foreground overflow-x-auto whitespace-pre">
                            {`curl -H "${config.headerRoutingHeader}: ${config.headerRoutingValue}" https://your-app.example.com/`}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>

                  {/* A/B testing explainer */}
                  <div className="rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2.5 space-y-1.5 text-[11px]">
                    <p className="font-semibold text-blue-600 dark:text-blue-400">How A/B routing works with Traefik</p>
                    <p className="text-muted-foreground leading-relaxed">
                      Traefik routes the first request randomly based on the weight above, then sets a
                      {" "}<span className="font-mono">{config.cookieName || "darlane-ab"}</span> cookie whose value is an opaque hash of the
                      selected backend. Every subsequent request that carries that cookie is pinned to the same pod —
                      the user never flips between variants mid-session.
                    </p>
                    <p className="text-muted-foreground leading-relaxed">
                      The cookie is owned by Traefik, not the app. Use <span className="font-medium">header routing</span> above
                      to bypass the weighted split and target the Darlane pod directly with a known header — no cookie guessing needed.
                    </p>
                    <a
                      href="https://doc.traefik.io/traefik/expose/kubernetes/advanced/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    >
                      Traefik advanced routing docs
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  </div>
                </div>
              )}

              {/* ── Advanced ────────────────────────────────────────────── */}
              <details className="group">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none list-none flex items-center gap-1">
                  <ChevronDown className="h-3.5 w-3.5 group-open:rotate-180 transition-transform" />
                  Advanced <span className="font-normal">(port overrides)</span>
                </summary>
                <div className="mt-3 grid grid-cols-2 gap-3 pl-4">
                  <div>
                    <label className={cn(hintCls, "mb-1 block")}>Container port</label>
                    <p className="text-[10px] text-muted-foreground/60 mb-1">If dev server uses a different port than the main app</p>
                    <input type="number" min={1} max={65535} value={config.containerPort} placeholder="8080"
                      onChange={(e) => setConfig({ ...config, containerPort: e.target.value })}
                      className={inputCls} />
                  </div>
                  <div>
                    <label className={cn(hintCls, "mb-1 block")}>Telemetry port</label>
                    <p className="text-[10px] text-muted-foreground/60 mb-1">OTEL collector port for A/B observability</p>
                    <input type="number" min={1} max={65535} value={config.telemetryPort} placeholder="4318"
                      onChange={(e) => setConfig({ ...config, telemetryPort: e.target.value })}
                      className={inputCls} />
                  </div>
                </div>
              </details>

              {/* ── Production safety ───────────────────────────────────── */}
              {env === "production" && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 space-y-2">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Production Darlane requires explicit confirmation
                  </p>
                  <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                    <input type="checkbox" checked={config.productionOverride}
                      onChange={(e) => setConfig({ ...config, productionOverride: e.target.checked })}
                      className="rounded border-amber-400 accent-amber-500" />
                    <span className="text-amber-700 dark:text-amber-400">I confirm this Darlane pod is intended for production</span>
                  </label>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
              <button onClick={onClose} disabled={submitting}
                className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button
                onClick={() => setStep(2)}
                disabled={env === "production" && !config.productionOverride}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors",
                  "text-wxops-green border-wxops-green/40 bg-wxops-green/5 hover:bg-wxops-green/10",
                  "disabled:opacity-40 disabled:cursor-not-allowed",
                )}>
                Review <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </>
        )}

        {/* Step 2: Review */}
        {step === 2 && (
          <>
            <div className="p-6 space-y-5 overflow-y-auto">
              <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold">
                    {mode === "reconfigure" ? "What will change" : "What will be patched"}
                  </p>
                  {mode === "reconfigure" && (
                    <div className="flex items-center gap-3 text-[10px]">
                      <span className="text-green-600 dark:text-green-400 font-semibold">+ added</span>
                      <span className="text-amber-500 dark:text-amber-400 font-semibold">~ changed</span>
                      <span className="text-red-500 dark:text-red-400 font-semibold">− removed</span>
                    </div>
                  )}
                </div>
                <p className={hintCls}>
                  <span className="font-mono">overlays/{env === "development" ? "dev" : env}/kustomization.yaml</span>
                </p>
                {/* Summary rows — value cell is flex so diff badge sits inline */}
                <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs">

                  <span className={hintCls}>Replicas</span>
                  <span className="font-mono flex items-center gap-2">
                    {config.replicas || "0"}
                    {mode === "reconfigure" && <DiffBadge status={diffStatus(originalConfig?.replicas ?? "0", config.replicas || "0", "0")} />}
                  </span>

                  <span className={hintCls}>TTL</span>
                  <span className="font-mono flex items-center gap-2">
                    {config.ttl}
                    {mode === "reconfigure" && <DiffBadge status={diffStatus(originalConfig?.ttl ?? "4h", config.ttl, "4h")} />}
                  </span>

                  {(config.command || (mode === "reconfigure" && originalConfig?.command)) && <>
                    <span className={hintCls}>Command</span>
                    <span className="font-mono flex items-center gap-2 break-all">
                      {config.command || <span className="text-muted-foreground/50 italic">sleep infinity</span>}
                      {mode === "reconfigure" && <DiffBadge status={diffStatus(originalConfig?.command ?? "", config.command, "")} />}
                    </span>
                  </>}

                  {(config.fileSync || (mode === "reconfigure" && originalConfig?.fileSync)) && <>
                    <span className={hintCls}>File sync</span>
                    <span className="font-mono flex items-center gap-2">
                      {config.fileSync
                        ? `${config.mountPath} · init: ${config.initFromImage ? "true" : "false"}`
                        : <span className="text-muted-foreground/50 italic">disabled</span>}
                      {mode === "reconfigure" && <DiffBadge status={diffStatus(
                        `${originalConfig?.fileSync}:${originalConfig?.mountPath ?? ""}:${originalConfig?.initFromImage ? "true" : "false"}`,
                        `${config.fileSync}:${config.mountPath}:${config.initFromImage ? "true" : "false"}`, "false::"
                      )} />}
                    </span>
                  </>}

                  {(config.cpuReq || config.cpuLim || (mode === "reconfigure" && (originalConfig?.cpuReq || originalConfig?.cpuLim))) && <>
                    <span className={hintCls}>CPU req / lim</span>
                    <span className="font-mono flex items-center gap-2">
                      {config.cpuReq || "—"} / {config.cpuLim || "—"}
                      {mode === "reconfigure" && <DiffBadge status={
                        diffStatus(`${originalConfig?.cpuReq ?? ""}/${originalConfig?.cpuLim ?? ""}`, `${config.cpuReq}/${config.cpuLim}`, "/")
                      } />}
                    </span>
                  </>}

                  {(config.memReq || config.memLim || (mode === "reconfigure" && (originalConfig?.memReq || originalConfig?.memLim))) && <>
                    <span className={hintCls}>Mem req / lim</span>
                    <span className="font-mono flex items-center gap-2">
                      {config.memReq || "—"} / {config.memLim || "—"}
                      {mode === "reconfigure" && <DiffBadge status={
                        diffStatus(`${originalConfig?.memReq ?? ""}/${originalConfig?.memLim ?? ""}`, `${config.memReq}/${config.memLim}`, "/")
                      } />}
                    </span>
                  </>}

                  {(() => {
                    const valid = config.envVars.filter((v) => v.name.trim());
                    const origCount = originalConfig?.envVars?.filter((v) => v.name.trim()).length ?? 0;
                    if (valid.length === 0 && origCount === 0) return null;
                    return <>
                      <span className={hintCls}>Env overrides</span>
                      <span className="font-mono flex items-center gap-2">
                        {valid.length > 0
                          ? `${valid.length} variable${valid.length !== 1 ? "s" : ""}`
                          : <span className="text-muted-foreground/50 italic">none</span>}
                        {mode === "reconfigure" && <DiffBadge status={diffStatus(String(origCount), String(valid.length), "0")} />}
                      </span>
                    </>;
                  })()}

                  {(() => {
                    const tw = parseInt(config.trafficWeight, 10);
                    const origTw = parseInt(originalConfig?.trafficWeight ?? "0", 10);
                    if ((isNaN(tw) || tw === 0) && origTw === 0) return null;
                    return <>
                      <span className={hintCls}>Traffic weight</span>
                      <span className="font-mono flex items-center gap-2">
                        {!isNaN(tw) && tw > 0 ? `${tw}% → Darlane` : <span className="text-muted-foreground/50 italic">disabled</span>}
                        {mode === "reconfigure" && <DiffBadge status={diffStatus(String(origTw), String(isNaN(tw) ? 0 : tw), "0")} />}
                      </span>
                      {(config.stickySession || (mode === "reconfigure" && originalConfig?.stickySession)) && <>
                        <span className={hintCls}>Sticky session</span>
                        <span className="font-mono flex items-center gap-2">
                          {config.stickySession
                            ? [
                                `cookie: ${config.cookieName || "darlane-ab"}`,
                                `sameSite: ${config.sameSite}`,
                                config.secure ? "secure" : "no-secure",
                              ].join(" · ")
                            : <span className="text-muted-foreground/50 italic">disabled</span>}
                          {mode === "reconfigure" && <DiffBadge status={diffStatus(
                            `${originalConfig?.stickySession}:${originalConfig?.cookieName ?? ""}:${originalConfig?.sameSite ?? "lax"}:${originalConfig?.secure}`,
                            `${config.stickySession}:${config.cookieName}:${config.sameSite}:${config.secure}`, "false::lax:false"
                          )} />}
                        </span>
                      </>}
                    </>;
                  })()}

                  {(config.headerRoutingEnabled || (mode === "reconfigure" && originalConfig?.headerRoutingEnabled)) && <>
                    <span className={hintCls}>Header routing</span>
                    <span className="font-mono flex items-center gap-2">
                      {config.headerRoutingEnabled
                        ? `${config.headerRoutingHeader || "X-Target-Env"}: ${config.headerRoutingValue || "darlane"}`
                        : <span className="text-muted-foreground/50 italic">disabled</span>}
                      {mode === "reconfigure" && <DiffBadge status={diffStatus(
                        `${originalConfig?.headerRoutingEnabled}:${originalConfig?.headerRoutingHeader ?? ""}:${originalConfig?.headerRoutingValue ?? ""}`,
                        `${config.headerRoutingEnabled}:${config.headerRoutingHeader}:${config.headerRoutingValue}`, "false::"
                      )} />}
                    </span>
                  </>}

                  {(config.containerPort || (mode === "reconfigure" && originalConfig?.containerPort)) && <>
                    <span className={hintCls}>Container port</span>
                    <span className="font-mono flex items-center gap-2">
                      {config.containerPort || <span className="text-muted-foreground/50 italic">removed</span>}
                      {mode === "reconfigure" && <DiffBadge status={diffStatus(originalConfig?.containerPort ?? "", config.containerPort, "")} />}
                    </span>
                  </>}

                  {(config.telemetryPort || (mode === "reconfigure" && originalConfig?.telemetryPort)) && <>
                    <span className={hintCls}>Telemetry port</span>
                    <span className="font-mono flex items-center gap-2">
                      {config.telemetryPort || <span className="text-muted-foreground/50 italic">removed</span>}
                      {mode === "reconfigure" && <DiffBadge status={diffStatus(originalConfig?.telemetryPort ?? "", config.telemetryPort, "")} />}
                    </span>
                  </>}

                  {env === "production" && <>
                    <span className={hintCls}>Production override</span>
                    <span className="font-mono text-amber-600 dark:text-amber-400 flex items-center gap-2">
                      confirmed
                      {mode === "reconfigure" && <DiffBadge status={diffStatus(String(originalConfig?.productionOverride ?? false), "true", "false")} />}
                    </span>
                  </>}
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">kustomization.yaml patch</p>
                <DiffYamlPreview
                  after={buildDarlanePreview(config)}
                  before={mode === "reconfigure" && originalConfig ? buildDarlanePreview(originalConfig) : undefined}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-border shrink-0">
              <button onClick={() => setStep(1)} disabled={submitting}
                className="inline-flex items-center gap-1 rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
              <button onClick={onSubmit} disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium transition-colors text-wxops-green border-wxops-green/40 bg-wxops-green/5 hover:bg-wxops-green/10 disabled:opacity-50">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Terminal className="h-4 w-4" />}
                {mode === "reconfigure"
                  ? (env === "development" ? "Apply changes" : "Open update PR")
                  : (env === "development" ? "Enable Darlane" : "Open Darlane PR")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
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
  const [originalOverlayConfig, setOriginalOverlayConfig] = useState<OverlayConfigState | undefined>(undefined);
  const [submitting, setSubmitting] = useState<Env | null>(null);
  const [showDeprecateDialog, setShowDeprecateDialog] = useState(false);
  const [deprecating, setDeprecating] = useState(false);
  const [darlaneWizardEnv, setDarlaneWizardEnv] = useState<Env | null>(null);
  const [darlaneWizardMode, setDarlaneWizardMode] = useState<"enable" | "reconfigure">("enable");
  const [darlaneConfig, setDarlaneConfig] = useState<DarlaneConfig>(defaultDarlaneConfig);
  const [originalDarlaneConfig, setOriginalDarlaneConfig] = useState<DarlaneConfig | undefined>(undefined);
  const [darlaneSubmitting, setDarlaneSubmitting] = useState(false);
  const [darlaneExpanded, setDarlaneExpanded] = useState<Env | null>(null);
  const [darlaneDisabling, setDarlaneDisabling] = useState<Env | null>(null);
  const [darlaneReconfiguring, setDarlaneReconfiguring] = useState<Env | null>(null);

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
      const mapped: OverlayConfigState = {
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
      };
      setOverlayConfig(mapped);
      setOriginalOverlayConfig(mapped);
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

    // Vault secrets — required on create-overlay only.
    // On update-overlay, users manage secrets directly in Vault UI.
    let vaultWritten = false;
    if (effectiveVaultEnabled && wizardMode === "create") {
      const vaultPairs = overlayConfig.vaultSecrets.filter(v => v.key);
      if (vaultPairs.length === 0) {
        toast.error("Vault secrets are required — add at least one secret before committing the overlay");
        setSubmitting(null);
        return;
      }
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

  async function handleSetupDarlane(env: Env) {
    setDarlaneSubmitting(true);
    const envKey = ENV_META[env].overlayKey;
    const body: Record<string, unknown> = { env: envKey, ttl: darlaneConfig.ttl };
    const r = parseInt(darlaneConfig.replicas, 10);
    if (!isNaN(r)) body.replicas = r;
    if (darlaneConfig.command.trim()) {
      body.command = darlaneConfig.command.trim().split(/\s+/);
    }
    if (darlaneConfig.fileSync) {
      body.fileSync = true;
      if (darlaneConfig.mountPath) body.mountPath = darlaneConfig.mountPath;
      body.initFromImage = darlaneConfig.initFromImage ? "true" : "false";
    }
    if (darlaneConfig.cpuReq)  body.resourcesCpuReq = darlaneConfig.cpuReq;
    if (darlaneConfig.cpuLim)  body.resourcesCpuLim = darlaneConfig.cpuLim;
    if (darlaneConfig.memReq)  body.resourcesMemReq = darlaneConfig.memReq;
    if (darlaneConfig.memLim)  body.resourcesMemLim = darlaneConfig.memLim;
    const validEnvVars = darlaneConfig.envVars.filter((v) => v.name.trim());
    if (validEnvVars.length > 0) body.envVars = validEnvVars;
    const tw = parseInt(darlaneConfig.trafficWeight, 10);
    if (!isNaN(tw)) body.trafficWeight = tw;
    if (darlaneConfig.stickySession && tw > 0) {
      body.stickySession = true;
      if (darlaneConfig.cookieName) body.cookieName = darlaneConfig.cookieName;
      body.sameSite = darlaneConfig.sameSite;
      body.secure = darlaneConfig.secure;
    }
    if (darlaneConfig.headerRoutingEnabled) {
      body.headerRoutingEnabled = true;
      if (darlaneConfig.headerRoutingHeader) body.headerRoutingHeader = darlaneConfig.headerRoutingHeader;
      if (darlaneConfig.headerRoutingValue)  body.headerRoutingValue  = darlaneConfig.headerRoutingValue;
    }
    if (darlaneConfig.containerPort) body.containerPort = parseInt(darlaneConfig.containerPort, 10);
    if (darlaneConfig.telemetryPort) body.telemetryPort = parseInt(darlaneConfig.telemetryPort, 10);
    if (darlaneConfig.productionOverride) body.productionOverride = true;
    try {
      const res = await fetch(
        `/api/catalog/entities/${encodeURIComponent(entityKind)}/${encodeURIComponent(entityName)}/darlane`,
        { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to enable Darlane");
      } else {
        if (data.committed) {
          toast.success("Darlane enabled — overlay committed to main");
          addNotification({ type: "pr_merged", title: "Darlane enabled", body: `${entityName} → ${ENV_META[env].label}` });
        } else {
          toast.success("Darlane PR opened — platform-team will review");
          addNotification({ type: "pr_opened", title: "Darlane PR opened", body: data.prTitle ?? `${entityName} → ${ENV_META[env].label}` });
        }
        setDarlaneWizardEnv(null);
        setDarlaneConfig(defaultDarlaneConfig);
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
      setDarlaneSubmitting(false);
    }
  }

  async function openReconfigureDarlane(env: Env) {
    setDarlaneReconfiguring(env);
    try {
      const res = await fetch(
        `/api/catalog/entities/${encodeURIComponent(entityKind)}/${encodeURIComponent(entityName)}/overlay/${encodeURIComponent(env)}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        toast.error("Could not load current Darlane config");
        return;
      }
      const cfg = await res.json();
      const loaded: DarlaneConfig = {
        replicas:            cfg.darlaneReplicas != null ? String(cfg.darlaneReplicas) : "0",
        command:             (cfg.darlaneCommand ?? []).join(" "),
        fileSync:            cfg.darlaneFileSync ?? false,
        mountPath:           cfg.darlaneMountPath || "/app",
        initFromImage:       cfg.darlaneInitFromImage !== "false",
        ttl:                 cfg.darlaneTTL || "4h",
        cpuReq:              cfg.darlaneCpuReq ?? "",
        cpuLim:              cfg.darlaneCpuLim ?? "",
        memReq:              cfg.darlaneMemReq ?? "",
        memLim:              cfg.darlaneMemLim ?? "",
        envVars:             cfg.darlaneEnvVars ?? [],
        trafficWeight:       cfg.darlaneTrafficWeight != null ? String(cfg.darlaneTrafficWeight) : "0",
        stickySession:       cfg.darlaneStickySession ?? false,
        cookieName:          cfg.darlaneCookieName ?? "",
        sameSite:            (cfg.darlaneSameSite as "lax" | "strict" | "none") || "lax",
        secure:                cfg.darlaneSecure ?? true,
        headerRoutingEnabled:  cfg.darlaneHeaderRoutingEnabled ?? false,
        headerRoutingHeader:   cfg.darlaneHeaderRoutingHeader || "X-Target-Env",
        headerRoutingValue:    cfg.darlaneHeaderRoutingValue  || "darlane",
        containerPort:       cfg.darlaneContainerPort != null ? String(cfg.darlaneContainerPort) : "",
        telemetryPort:       cfg.darlaneTelemetryPort != null ? String(cfg.darlaneTelemetryPort) : "",
        productionOverride:  cfg.darlaneProductionOverride ?? false,
      };
      setDarlaneConfig(loaded);
      setOriginalDarlaneConfig(loaded);
      setDarlaneWizardMode("reconfigure");
      setDarlaneWizardEnv(env);
    } catch {
      toast.error("Network error loading Darlane config");
    } finally {
      setDarlaneReconfiguring(null);
    }
  }

  async function handleDisableDarlane(env: Env) {
    setDarlaneDisabling(env);
    const overlayKey = ENV_META[env].overlayKey;
    try {
      const res = await fetch(
        `/api/catalog/entities/${encodeURIComponent(entityKind)}/${encodeURIComponent(entityName)}/darlane`,
        { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ env: overlayKey, disable: true }) },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to disable Darlane");
      } else {
        if (data.committed) {
          toast.success("Darlane disabled — committed to main");
          addNotification({ type: "pr_merged", title: "Darlane disabled", body: `${entityName} → ${ENV_META[env].label}` });
        } else {
          toast.success("Darlane disable PR opened — platform-team will review");
          addNotification({ type: "pr_opened", title: "Darlane disable PR opened", body: data.prTitle ?? `${entityName} → ${ENV_META[env].label}` });
        }
        setDarlaneExpanded(null);
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
      setDarlaneDisabling(null);
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

  // Derive K8s namespace for Darlane debug commands.
  // team prop = owner without "group:" (e.g. "wxops:rocket-team")
  const dsOrg = team.includes(":") ? team.split(":")[0] : team;
  const dsNamespace = dsOrg === "platform-team" ? "platform" : `tenant-${dsOrg}`;

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

          // Derive whether the action strip should be shown at all
          const showActionStrip =
            overlayExists ||
            (!isDeprecated && canAct && (needsOverlayPR || needsConfirm));

          return (
            <div key={env} className={cn("px-4 py-3", isCurrent && meta.bg)}>
              <div className="flex items-center gap-3 min-h-[2.25rem]">

                {/* ── Info strip (read-only) ──────────────────────────────── */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className={cn("h-2 w-2 rounded-full shrink-0", meta.dot)} />
                  <span className={cn("text-sm font-medium shrink-0", isCurrent ? meta.text : "text-foreground")}>
                    {meta.label}
                  </span>

                  {/* Deployment state */}
                  {done && (
                    <span className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold shrink-0",
                      meta.bg, meta.border, meta.text,
                    )}>
                      <span className={cn("h-1.5 w-1.5 rounded-full animate-pulse", meta.dot)} />
                      Live
                    </span>
                  )}
                  {deployedBelow && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/60 shrink-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
                      Deployed
                    </span>
                  )}

                  {/* Pending notices */}
                  {prPending && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium shrink-0">
                      <Clock className="h-3 w-3" /> PR #{openPR} open
                    </span>
                  )}
                  {needsConfirm && canAct && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium shrink-0">
                      <AlertTriangle className="h-3 w-3" /> Confirm pending
                    </span>
                  )}

                  {/* Version tag */}
                  {tag && (
                    <span
                      className={cn(
                        "ml-1 inline-flex items-center rounded border px-1.5 py-0.5 shrink-0",
                        "font-mono text-[10px] font-medium leading-none",
                        meta.bg, meta.border, meta.text,
                      )}
                      title={tag.tag}
                    >
                      {shortTag(tag.tag)}
                    </span>
                  )}
                </div>

                {/* ── Divider ─────────────────────────────────────────────── */}
                {showActionStrip && (
                  <div className="h-4 w-px bg-border/60 shrink-0" />
                )}

                {/* ── Action strip (all interactive) ──────────────────────── */}
                {showActionStrip && (
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Vault external link */}
                    {overlayExists && status.vaultAddr && status.vaultEnabled && (
                      <a
                        href={`${status.vaultAddr}/ui/vault/secrets/${status.vaultKvMount ?? "secret"}/kv/${encodeURIComponent(`${team}/${entityName}/${overlayKey}/env`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`${team}/${entityName}/${overlayKey}/env`}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <KeyRound className="h-3 w-3" />
                        Vault
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}

                    {/* Edit overlay */}
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

                    {/* Create overlay */}
                    {!isDeprecated && canAct && needsOverlayPR && (
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
                        Create overlay <ChevronRight className="h-3 w-3" />
                      </button>
                    )}

                    {/* Confirm lifecycle */}
                    {!isDeprecated && canAct && needsConfirm && (
                      <button
                        onClick={() => handleConfirm(env)}
                        disabled={isSubmitting}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                          meta.text, meta.bg, meta.border,
                        )}
                      >
                        {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                        Confirm
                      </button>
                    )}

                    {/* Darlane — setup */}
                    {overlayExists && canAct && !overlay.darlaneEnabled && (
                      <button
                        onClick={() => { setDarlaneConfig(defaultDarlaneConfig); setOriginalDarlaneConfig(undefined); setDarlaneWizardMode("enable"); setDarlaneWizardEnv(env); }}
                        className="inline-flex items-center gap-1 rounded-md border border-wxops-green/40 bg-wxops-green/5 px-2 py-1 text-[11px] font-medium text-wxops-green hover:bg-wxops-green/10 transition-colors"
                      >
                        <Terminal className="h-3 w-3" /> Darlane
                      </button>
                    )}

                    {/* Darlane — active */}
                    {overlayExists && overlay.darlaneEnabled && (
                      <button
                        onClick={() => setDarlaneExpanded(darlaneExpanded === env ? null : env)}
                        className="inline-flex items-center gap-1 rounded-md border border-wxops-green/40 bg-wxops-green/10 px-2 py-1 text-[11px] font-medium text-wxops-green hover:bg-wxops-green/15 transition-colors"
                      >
                        <Terminal className="h-3 w-3" />
                        Darlane
                        <span className="h-1.5 w-1.5 rounded-full bg-wxops-green" />
                        <ChevronDown className={cn("h-3 w-3 transition-transform", darlaneExpanded === env && "rotate-180")} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Darlane inline debug commands */}
              {overlayExists && overlay.darlaneEnabled && darlaneExpanded === env && (
                <div className="mt-2 rounded-lg border border-wxops-green/20 bg-wxops-green/5 px-3 py-2.5 space-y-1.5">
                  <p className="text-[10px] font-semibold text-wxops-green uppercase tracking-wider mb-1">Debug commands</p>
                  {(() => {
                    const darlaneDeployment = overlayKey === "dev"
                      ? `${entityName}-darlane`
                      : `${entityName}-${overlayKey}-darlane`;
                    const syncEnvFlag = overlayKey === "dev" ? "" : ` --env ${overlayKey}`;

                    const renderCmd = ({ label, cmd }: { label: string; cmd: string }) => (
                      <div key={label} className="flex items-center gap-2 group/cmd">
                        <span className="text-[10px] text-muted-foreground w-24 shrink-0">{label}</span>
                        <code className="flex-1 rounded bg-muted/40 px-2 py-0.5 text-[11px] font-mono text-foreground overflow-x-auto">{cmd}</code>
                        <button
                          onClick={() => { navigator.clipboard.writeText(cmd); toast.success("Copied"); }}
                          className="shrink-0 opacity-0 group-hover/cmd:opacity-100 rounded px-1.5 py-0.5 text-[10px] border border-border text-muted-foreground hover:text-foreground transition-all"
                        >copy</button>
                      </div>
                    );

                    return (
                      <>
                        {[
                          { label: "Exec",         cmd: `kubectl -n ${dsNamespace} exec -it deployment/${darlaneDeployment} -- bash` },
                          { label: "Port-forward", cmd: `kubectl -n ${dsNamespace} port-forward deployment/${darlaneDeployment} 8080:8080` },
                          { label: "Mirrord",      cmd: `mirrord exec --target deployment/${darlaneDeployment} --target-namespace ${dsNamespace} -- <cmd>` },
                        ].map(renderCmd)}
                        <div className="border-t border-wxops-green/10 pt-1.5 mt-0.5 space-y-1.5">
                          <p className="text-[10px] font-medium text-muted-foreground/80">wxops CLI — file sync</p>
                          {[
                            { label: "Sync",         cmd: `wxops darlane sync ${entityName}${syncEnvFlag}` },
                            { label: "Sync (paths)", cmd: `wxops darlane sync ${entityName} --local ./src --remote /app/src${syncEnvFlag}` },
                          ].map(renderCmd)}
                        </div>
                      </>
                    );
                  })()}
                  <p className="text-[10px] text-muted-foreground/70 italic pt-0.5">
                    Use <span className="font-medium not-italic text-foreground/60">Reconfigure</span> below to change replicas or TTL —
                    ArgoCD will revert any manual <code className="font-mono">kubectl scale</code>.
                  </p>
                  {env !== "development" && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      Staging/production pods are on spoke clusters — set the correct kubectl context first.
                    </p>
                  )}
                  {canAct && (
                    <div className="pt-2 mt-0.5 border-t border-wxops-green/10 flex items-center gap-2">
                      <button
                        onClick={() => openReconfigureDarlane(env)}
                        disabled={darlaneReconfiguring === env}
                        className="inline-flex items-center gap-1.5 rounded-md border border-wxops-green/30 bg-wxops-green/5 px-2.5 py-1 text-[11px] font-medium text-wxops-green hover:bg-wxops-green/10 transition-colors disabled:opacity-50"
                      >
                        {darlaneReconfiguring === env
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Pencil className="h-3 w-3" />}
                        Reconfigure
                      </button>
                      <button
                        onClick={() => handleDisableDarlane(env)}
                        disabled={darlaneDisabling === env}
                        className="inline-flex items-center gap-1.5 rounded-md border border-red-300 dark:border-red-800/50 bg-red-50 dark:bg-red-950/20 px-2.5 py-1 text-[11px] font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50"
                      >
                        {darlaneDisabling === env
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <XCircle className="h-3 w-3" />}
                        {env === "development" ? "Turn off" : "Open disable PR"}
                      </button>
                    </div>
                  )}
                </div>
              )}

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
        originalConfig={originalOverlayConfig}
        team={team}
        appName={entityName}
        ingressEnabled={effectiveIngressEnabled || effectiveCertEnabled}
        vaultEnabled={effectiveVaultEnabled}
        databaseEnabled={effectiveDatabaseEnabled}
        certEnabled={effectiveCertEnabled}
        config={overlayConfig}
        setConfig={setOverlayConfig}
        submitting={submitting === wizardEnv}
        onClose={() => { setWizardEnv(null); setWizardMode("create"); setOverlayConfig(defaultConfig); setOriginalOverlayConfig(undefined); }}
        onSubmit={() => handleCreateOverlay(wizardEnv)}
      />
    )}

    {/* Darlane setup wizard — rendered outside the panel div for full-viewport backdrop */}
    {darlaneWizardEnv && (
      <DarlaneWizardModal
        env={darlaneWizardEnv}
        entityKind={entityKind}
        entityName={entityName}
        mode={darlaneWizardMode}
        originalConfig={originalDarlaneConfig}
        config={darlaneConfig}
        setConfig={setDarlaneConfig}
        submitting={darlaneSubmitting}
        ingressEnabled={status.ingressEnabled}
        onClose={() => { setDarlaneWizardEnv(null); setDarlaneConfig(defaultDarlaneConfig); setOriginalDarlaneConfig(undefined); }}
        onSubmit={() => handleSetupDarlane(darlaneWizardEnv)}
      />
    )}
    </>
  );
}
