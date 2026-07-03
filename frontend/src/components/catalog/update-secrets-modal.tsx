"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X, Loader2, Upload } from "lucide-react";
import type { Entity } from "@/lib/types";
import { KeyValueEditor, type KVPair } from "@/components/scaffold/key-value-editor";

interface UpdateSecretsModalProps {
  entity: Entity;
  targetEnv: "dev" | "staging" | "production";
  onClose: () => void;
}

export function UpdateSecretsModal({ entity, targetEnv, onClose }: UpdateSecretsModalProps) {
  const [envVars, setEnvVars] = useState<KVPair[]>([{ key: "", value: "" }]);
  const [submitting, setSubmitting] = useState(false);

  const team = entity.spec.owner?.includes(":")
    ? entity.spec.owner.split(":")[1]
    : entity.spec.owner ?? "";
  // Derive appName from the vault path annotation (format: team/appName/dev/env) rather than
  // entity.metadata.name — vault Resource entities are named "{appName}-vault" in the
  // catalog, not "{appName}", so using the entity name would cause a repo-not-found error.
  const rawVaultPath = entity.metadata.annotations?.["wxops.cloud/vault-path"];
  const appName = rawVaultPath
    ? rawVaultPath.split("/")[1] ?? entity.metadata.name
    : entity.metadata.name;
  const vaultPath = `${team}/${appName}/${targetEnv}/env`;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = async () => {
    const filtered = envVars.filter((p) => p.key);
    if (filtered.length === 0) {
      toast.error("Add at least one env var");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/scaffold/secrets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          team,
          appName,
          targetEnv,
          envVars: filtered,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }

      toast.success(`Secrets written to ${vaultPath}`);
      onClose();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl border bg-background shadow-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">
              Update Vault Secrets —{" "}
              <span className="capitalize">{targetEnv}</span>
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">
              {vaultPath}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          This will <strong>replace all secrets</strong> at the vault path.
          Upload a .env file or enter key-value pairs manually.
        </p>

        <KeyValueEditor
          pairs={envVars}
          onChange={setEnvVars}
          keyPlaceholder="SECRET_KEY"
          valuePlaceholder="secret-value"
          allowImport
          secret
        />

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted/50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-1.5 rounded-md bg-wxops-purple px-3 py-1.5 text-sm font-medium text-white hover:bg-wxops-purple/90 disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Writing...
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5" />
                Write Secrets
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
