"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle,
  Circle,
  Loader2,
  XCircle,
  AlertTriangle,
  ArrowLeft,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WizardState } from "./project-wizard";

export interface CreationResult {
  repoUrl: string;
  status: string;
  appName: string;
  team: string;
}

interface CreationProgressProps {
  state: WizardState;
  onSuccess: (result: CreationResult) => void;
  onBack: () => void;
}

interface StepDef {
  id: number;
  label: string;
  description: string;
}

type StepStatus = "pending" | "running" | "done" | "failed";

function buildSteps(state: WizardState): StepDef[] {
  const steps: StepDef[] = [
    { id: 1, label: "Checking availability", description: "Verifying project name is unique across repo and GitOps config" },
    { id: 2, label: "Creating repository", description: `Setting up ${state.team}/${state.appName} on Gitea` },
    { id: 3, label: "Bootstrapping template", description: "Pushing template to develop, creating staging & main branches" },
    { id: 4, label: "Preparing GitOps config", description: "Committing XTenantApp, ExternalSecrets, and catalog entities" },
    { id: 5, label: "Opening review PR", description: "Creating pull request for platform review" },
  ];
  if (state.vaultSecrets && state.vaultEnvVars.some((v) => v.key)) {
    steps.push({ id: 6, label: "Writing secrets", description: "Storing environment variables in Vault" });
  }
  return steps;
}

// Minimum time each step stays in "running" state so the user can read the label.
const STEP_MIN_DISPLAY: Record<number, number> = {
  1: 1500,  // Validation — fast on backend but user needs to see it
  2: 3000,  // Create repo + branches — involves multiple Gitea API calls
  3: 5000,  // Template fetch + substitution + push — heaviest step
  4: 3000,  // GitOps branch + commit manifests
  5: 2000,  // Open PR
  6: 1500,  // Vault write
};

function buildSubmitBody(state: WizardState): Record<string, unknown> {
  return {
    appName: state.appName,
    team: state.team,
    description: state.description,
    templateId: state.templateId,
    runtimeVersion: state.runtimeVersion || undefined,
    packageManager: state.packageManager || undefined,
    appFlavor: state.appFlavor,
    containerPort: state.containerPort ?? undefined,
    replicas: state.replicas ?? undefined,
    domain: state.domain || undefined,
    reloader: state.reloader,
    vaultSecrets: state.vaultSecrets,
    databaseSecrets: state.databaseSecrets,
    certManager: state.certManager,
    certClusterIssuer: state.certManager ? state.certClusterIssuer : undefined,
    ssoAuth: state.ssoAuth,
    apiEnabled: state.apiEnabled,
    apiType: state.apiEnabled ? state.apiType : undefined,
    openapiPath: state.apiEnabled ? state.openapiPath : undefined,
    monitoringEnabled: state.monitoringEnabled,
    metricsPath: state.monitoringEnabled ? state.metricsPath : undefined,
    ingressEnabled: state.ingressEnabled,
    ingressHost: state.ingressHost || undefined,
    resourcesCpuReq: state.resourcesCpuReq || undefined,
    resourcesCpuLim: state.resourcesCpuLim || undefined,
    resourcesMemReq: state.resourcesMemReq || undefined,
    resourcesMemLim: state.resourcesMemLim || undefined,
    livenessPath: state.livenessPath || undefined,
    readinessPath: state.readinessPath || undefined,
    rolloutType: state.rolloutType || undefined,
    devSpaceEnabled: state.devSpaceEnabled,
    vaultEnvVars: state.vaultEnvVars.filter((p) => p.key),
    dbName: state.dbName || undefined,
    dbExtensions: state.dbExtensions.length > 0 ? state.dbExtensions : undefined,
    dbTier: state.dbTier || undefined,
    dbEnvironment: state.databaseSecrets ? state.dbEnvironment || "dev" : undefined,
    dbClusterRef: state.databaseSecrets && state.dbTier === "shared" && state.dbClusterRef ? state.dbClusterRef : undefined,
    dbClusterNamespace: state.databaseSecrets && state.dbTier === "shared" && state.dbClusterNamespace ? state.dbClusterNamespace : undefined,
    dbReclaimPolicy: state.databaseSecrets && state.dbReclaimPolicy !== "retain" ? state.dbReclaimPolicy : undefined,
    dedicatedCluster: state.databaseSecrets && state.dbTier === "dedicated" ? {
      instances: state.dbDedicatedInstances || 1,
      storageSize: state.dbDedicatedStorageSize || "1Gi",
      postgresVersion: state.dbDedicatedPostgresVersion || 16,
      enablePooler: state.dbDedicatedEnablePooler,
      namespace: state.dbDedicatedNamespace || undefined,
    } : undefined,
    envVars: state.envVars.filter((p) => p.key),
    podAnnotations: state.podAnnotations.filter((p) => p.key),
    extraLabels: state.extraLabels.filter((p) => p.key),
  };
}

export function CreationProgress({ state, onSuccess, onBack }: CreationProgressProps) {
  const steps = buildSteps(state);
  const [statuses, setStatuses] = useState<Map<number, StepStatus>>(
    () => new Map(steps.map((s) => [s.id, "pending" as StepStatus])),
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [failedStepId, setFailedStepId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  const updateStep = (id: number, status: StepStatus) => {
    setStatuses((prev) => new Map(prev).set(id, status));
  };

  const runCreation = async () => {
    const body = buildSubmitBody(state);

    type ApiResult = { ok: boolean; data: Record<string, unknown>; status: number };
    const resultRef: { current: ApiResult | null } = { current: null };
    const apiPromise = fetch("/api/scaffold/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      const r: ApiResult = { ok: res.ok, data, status: res.status };
      resultRef.current = r;
      return r;
    }).catch((err) => {
      const r: ApiResult = { ok: false, data: { error: String(err) }, status: 0 };
      resultRef.current = r;
      return r;
    });

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // Walk through steps. Each step stays "running" for at least its minimum
    // display time. If the API finishes mid-step we reconcile immediately
    // after the minimum wait. If the animation outruns the API, the last
    // step holds on "running" until the API responds.
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const snapshot = resultRef.current;

      // API already returned with a failure at or before this step — stop.
      if (snapshot && !snapshot.ok) {
        const serverFailed = (snapshot.data.failedStep as number) ?? 0;
        if (serverFailed > 0 && serverFailed <= step.id) break;
      }

      updateStep(step.id, "running");
      const minDisplay = STEP_MIN_DISPLAY[step.id] ?? 2000;

      // Wait the minimum display time.
      await sleep(minDisplay);

      // If this is the last step (or second-to-last and API is still running),
      // hold on "running" until the API finishes — never show "done" prematurely.
      const isLastStep = i === steps.length - 1;
      const nextIsLast = i === steps.length - 2;
      if ((isLastStep || nextIsLast) && !resultRef.current) {
        // Poll until API responds, checking every 500ms.
        while (!resultRef.current) {
          await sleep(500);
        }
      }

      // Check if API failed at this step after waiting.
      const latest = resultRef.current;
      if (latest && !latest.ok) {
        const serverFailed = (latest.data.failedStep as number) ?? 0;
        if (serverFailed > 0 && serverFailed <= step.id) break;
      }

      // If API is done and succeeded, and we've shown this step long enough, mark done.
      // If API is still running, only mark done if we haven't reached the final steps.
      if (latest && latest.ok) {
        updateStep(step.id, "done");
      } else if (!latest && !isLastStep) {
        updateStep(step.id, "done");
      } else if (latest && latest.ok === false) {
        break;
      } else {
        // API still in flight on last step — hold running, will reconcile below.
        updateStep(step.id, "done");
      }
    }

    // Wait for API if animation somehow finished first.
    const result = await apiPromise;

    if (result.ok) {
      for (const step of steps) updateStep(step.id, "done");
      await sleep(600);
      onSuccess({
        repoUrl: result.data.repoUrl as string,
        status: (result.data.status as string) ?? "Project created",
        appName: result.data.appName as string,
        team: result.data.team as string,
      });
    } else {
      const serverFailed = (result.data.failedStep as number) ?? 0;
      const errorText = (result.data.error as string) ?? `HTTP ${result.status}`;

      for (const step of steps) {
        if (serverFailed > 0 && step.id < serverFailed) {
          updateStep(step.id, "done");
        } else if (serverFailed > 0 && step.id === serverFailed) {
          updateStep(step.id, "failed");
        }
      }

      if (serverFailed === 0) {
        for (const step of steps) {
          const current = statuses.get(step.id);
          if (current !== "done") {
            updateStep(step.id, "failed");
            setFailedStepId(step.id);
            break;
          }
        }
      } else {
        setFailedStepId(serverFailed);
      }
      setErrorMsg(errorText);
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    runCreation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const progress = steps.filter((s) => statuses.get(s.id) === "done").length;
  const total = steps.length;
  const pct = Math.round((progress / total) * 100);
  const isRunning = !errorMsg && progress < total;
  const isFailed = !!errorMsg;

  const handleCopyError = () => {
    if (!errorMsg) return;
    const failedStep = steps.find((s) => s.id === failedStepId);
    const text = [
      `Project: ${state.team}/${state.appName}`,
      `Template: ${state.templateId}`,
      `Failed at: ${failedStep?.label ?? "Unknown step"}`,
      `Error: ${errorMsg}`,
      `Time: ${new Date().toISOString()}`,
    ].join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mx-auto max-w-lg space-y-6 py-4">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold">
          {isFailed ? "Creation Failed" : isRunning ? "Creating Project..." : "Finishing Up..."}
        </h2>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono text-foreground">{state.team}/{state.appName}</span>
          {isRunning && " — do not close this page"}
        </p>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{isRunning ? "In progress" : isFailed ? "Failed" : "Complete"}</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted/50 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500 ease-out",
              isFailed ? "bg-red-500" : "bg-wxops-purple",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Step list */}
      <div className="rounded-xl border border-border bg-muted/10 p-4">
        <div className="space-y-0">
          {steps.map((step, idx) => {
            const status = statuses.get(step.id) ?? "pending";
            return (
              <div key={step.id}>
                <div className="flex items-start gap-3 py-2.5">
                  {/* Status icon */}
                  <div className="mt-0.5 shrink-0">
                    {status === "done" && (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    )}
                    {status === "running" && (
                      <Loader2 className="h-5 w-5 text-wxops-purple animate-spin" />
                    )}
                    {status === "failed" && (
                      <XCircle className="h-5 w-5 text-red-500" />
                    )}
                    {status === "pending" && (
                      <Circle className="h-5 w-5 text-muted-foreground/40" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "text-sm font-medium",
                        status === "done" && "text-green-600 dark:text-green-400",
                        status === "running" && "text-foreground",
                        status === "failed" && "text-red-600 dark:text-red-400",
                        status === "pending" && "text-muted-foreground/60",
                      )}
                    >
                      {step.label}
                    </p>
                    <p
                      className={cn(
                        "text-xs mt-0.5 leading-tight",
                        status === "pending" ? "text-muted-foreground/40" : "text-muted-foreground",
                      )}
                    >
                      {step.description}
                    </p>

                    {/* Error details inline under failed step */}
                    {status === "failed" && errorMsg && (
                      <div className="mt-2 rounded-md border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/10 px-3 py-2">
                        <p className="text-xs text-red-700 dark:text-red-300 font-mono break-all leading-relaxed">
                          {errorMsg}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Connector line */}
                {idx < steps.length - 1 && (
                  <div className="ml-2.5 h-2 border-l border-border" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Error actions */}
      {isFailed && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-800/30 bg-amber-50 dark:bg-amber-900/10 px-3 py-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              Copy the error details below and share them with the platform team.
              {failedStepId && failedStepId >= 2 && (
                <> The repository may have been partially created — the platform team can clean it up.</>
              )}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Config
            </button>
            <button
              type="button"
              onClick={handleCopyError}
              className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
            >
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy Error Details"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
