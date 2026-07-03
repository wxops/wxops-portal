"use client";

import { useState } from "react";
import { toast } from "sonner";
import { addNotification } from "@/lib/notifications";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { StepRepository } from "./step-repository";
import { StepTemplate, type TemplateInfo } from "./step-template";
import { StepAppConfig, validateResources } from "./step-app-config";
import { YAMLPreview } from "./yaml-preview";
import { SuccessPanel } from "./success-panel";
import { CreationProgress, type CreationResult } from "./creation-progress";

export interface WizardState {
  step: 1 | 2 | 3;
  // Step 1
  appName: string;
  team: string;
  description: string;
  // Step 2
  templateId: string;
  runtimeVersion: string;
  packageManager: string;
  // Step 3 — essentials
  appFlavor: string;
  containerPort: number | null;

  domain: string;
  // Step 3 — platform feature toggles (base manifest)
  reloader: boolean;
  vaultSecrets: boolean;
  databaseSecrets: boolean;
  certManager: boolean;
  // certClusterIssuer intentionally absent — ClusterIssuer is set per-env in the Promote flow.
  ssoAuth: boolean;
  apiEnabled: boolean;
  apiType: string;
  openapiPath: string;
  monitoringEnabled: boolean;
  metricsPath: string;
  // Step 3 — advanced (base-level, env-agnostic)
  ingressEnabled: boolean;
  livenessPath: string;
  readinessPath: string;
  rolloutType: string;
  devSpaceEnabled: boolean;
  // Database — only extensions are project-level; name/tier/cluster go in the Promote flow.
  dbExtensions: string[];
  // Plain env vars
  envVars: Array<{ key: string; value: string }>;
  // Annotations & Labels
  podAnnotations: Array<{ key: string; value: string }>;
  extraLabels: Array<{ key: string; value: string }>;
}

interface SuccessData {
  repoUrl: string;
  status: string;
  appName: string;
  team: string;
}

interface ProjectWizardProps {
  groups: string[];
  username: string;
}

const INITIAL_STATE: WizardState = {
  step: 1,
  appName: "",
  team: "",
  description: "",
  templateId: "",
  runtimeVersion: "",
  packageManager: "",
  appFlavor: "webapp",
  containerPort: null,

  domain: "",
  reloader: false,
  vaultSecrets: false,
  databaseSecrets: false,
  certManager: false,
  ssoAuth: false,
  apiEnabled: false,
  apiType: "openapi",
  openapiPath: "",
  monitoringEnabled: false,
  metricsPath: "/metrics",
  ingressEnabled: false,
  livenessPath: "/healthz",
  readinessPath: "/readyz",
  rolloutType: "RollingUpdate",
  devSpaceEnabled: false,
  dbExtensions: ["uuid-ossp", "pgcrypto"],
  envVars: [],
  podAnnotations: [],
  extraLabels: [],
};

const STEPS = [
  { num: 1 as const, label: "Team & Repo" },
  { num: 2 as const, label: "Template" },
  { num: 3 as const, label: "App Config" },
];

function applyTemplateDefaults(tmpl: TemplateInfo): Partial<WizardState> {
  const p: Partial<WizardState> = {};
  const rt = tmpl.runtime;
  if (rt) {
    if (rt.version?.default) p.runtimeVersion = rt.version.default;
    if (rt.packageManager?.default) p.packageManager = rt.packageManager.default;
  }
  const d = tmpl.defaults;
  if (d) {
    if (d.port) p.containerPort = d.port;
    if (d.healthPath) {
      p.livenessPath = d.healthPath;
      p.readinessPath = d.healthPath;
    }
    if (d.livenessPath) p.livenessPath = d.livenessPath;
    if (d.readinessPath) p.readinessPath = d.readinessPath;
    if (d.metricsPath) { p.monitoringEnabled = true; p.metricsPath = d.metricsPath; }
  }
  const r = tmpl.recommends;
  if (r) {
    if (r.vault) p.vaultSecrets = true;
    if (r.database) p.databaseSecrets = true;
    if (r.api) { p.apiEnabled = true; if (r.apiType) p.apiType = r.apiType; }
    if (r.ingress) p.ingressEnabled = true;
    if (r.monitoring) p.monitoringEnabled = true;
  }
  return p;
}

export function ProjectWizard({ groups, username }: ProjectWizardProps) {
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [creating, setCreating] = useState(false);
  const [success, setSuccess] = useState<SuccessData | null>(null);
  const [templateList, setTemplateList] = useState<TemplateInfo[]>([]);

  const patch = (p: Partial<WizardState>) =>
    setState((prev) => ({ ...prev, ...p }));

  const canNext = (): boolean => {
    switch (state.step) {
      case 1:
        return !!state.team && !!state.appName;
      case 2:
        return !!state.templateId;
      case 3:
        return true;
      default:
        return false;
    }
  };

  const handleCreate = () => {
    const resourceError = validateResources(state);
    if (resourceError) {
      toast.error(resourceError);
      return;
    }
    setCreating(true);
  };

  // Suppress unused-variable lint — username reserved for PR body attribution.
  void username;

  if (success) {
    return <SuccessPanel {...success} />;
  }

  if (creating) {
    return (
      <CreationProgress
        state={state}
        onSuccess={(result: CreationResult) => {
          setCreating(false);
          setSuccess(result);
          toast.success("Project scaffolded successfully");
          addNotification({
            type: "scaffold_created",
            title: "Project scaffolded",
            body: `${result.team}/${result.appName}`,
          });
        }}
        onBack={() => setCreating(false)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New Project</h1>
        <p className="text-muted-foreground mt-1">
          Fill out the wizard to scaffold a new project end-to-end.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map(({ num, label }) => (
          <div key={num} className="flex items-center gap-2">
            {num > 1 && (
              <div
                className={cn(
                  "h-px w-8",
                  state.step >= num ? "bg-wxops-purple" : "bg-border",
                )}
              />
            )}
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                state.step === num
                  ? "bg-wxops-purple/10 text-wxops-purple"
                  : state.step > num
                    ? "bg-muted text-foreground"
                    : "bg-muted/50 text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                  state.step === num
                    ? "bg-wxops-purple text-white"
                    : state.step > num
                      ? "bg-foreground/20 text-foreground"
                      : "bg-border text-muted-foreground",
                )}
              >
                {num}
              </span>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Main content: form + YAML preview */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border p-6">
          {state.step === 1 && (
            <StepRepository state={state} groups={groups} onChange={patch} />
          )}
          {state.step === 2 && (
            <StepTemplate state={state} onChange={patch} onTemplateLoaded={setTemplateList} />
          )}
          {state.step === 3 && (
            <StepAppConfig state={state} onChange={patch} isPlatformTeam={groups.some((g) => g === "platform-team")} />
          )}
        </div>

        {state.step >= 2 && (
          <div className="rounded-xl border border-border p-6 bg-muted/20">
            <p className="mb-3 text-sm font-medium">Live Preview</p>
            <YAMLPreview state={state} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={state.step === 1}
          onClick={() =>
            patch({ step: (state.step - 1) as WizardState["step"] })
          }
          className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/50 disabled:opacity-40 disabled:pointer-events-none"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        {state.step < 3 ? (
          <button
            type="button"
            disabled={!canNext()}
            onClick={() => {
              const nextStep = (state.step + 1) as WizardState["step"];
              if (state.step === 2 && state.templateId) {
                const tmpl = templateList.find((t) => t.name === state.templateId);
                const defaults = tmpl ? applyTemplateDefaults(tmpl) : {};
                patch({ step: nextStep, ...defaults });
              } else {
                patch({ step: nextStep });
              }
            }}
            className="flex items-center gap-1.5 rounded-lg bg-wxops-purple px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-wxops-purple/90 disabled:opacity-40 disabled:pointer-events-none"
          >
            Next
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleCreate}
            className="flex items-center gap-1.5 rounded-lg bg-wxops-purple px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-wxops-purple/90"
          >
            Create Project
          </button>
        )}
      </div>
    </div>
  );
}
