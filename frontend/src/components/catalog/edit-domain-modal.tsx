"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X, Loader2, Globe } from "lucide-react";
import type { Entity } from "@/lib/types";

const DOMAIN_SUGGESTIONS = [
  { value: "finance", description: "Payment processing, billing, accounting" },
  { value: "logistics", description: "Shipping, inventory, supply chain" },
  { value: "platform", description: "Internal developer platform, infrastructure" },
  { value: "identity", description: "Authentication, authorization, SSO" },
  { value: "data", description: "Data pipelines, analytics, ML" },
  { value: "communication", description: "Notifications, messaging, email" },
];

interface EditDomainModalProps {
  entity: Entity;
  onClose: () => void;
}

export function EditDomainModal({ entity, onClose }: EditDomainModalProps) {
  const router = useRouter();
  const [domain, setDomain] = useState(entity.spec.domain ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated: Entity = {
        ...entity,
        spec: { ...entity.spec, domain: domain || undefined },
      };
      const res = await fetch(
        `/api/catalog/entities/${entity.kind}/${entity.metadata.name}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(updated),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      toast.success(domain ? `Domain set to "${domain}"` : "Domain removed");
      onClose();
      router.refresh();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-xl border bg-background shadow-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-wxops-purple" />
            <h3 className="text-sm font-semibold">Set Domain</h3>
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
          Assign a business domain to group related systems together.
        </p>

        <div>
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="e.g. finance, logistics, platform"
            autoFocus
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
          />
        </div>

        {/* Quick suggestions */}
        <div className="flex flex-wrap gap-1.5">
          {DOMAIN_SUGGESTIONS.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => setDomain(d.value)}
              title={d.description}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-mono transition-colors ${
                domain === d.value
                  ? "border-wxops-purple bg-wxops-purple/10 text-wxops-purple"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
              }`}
            >
              {d.value}
            </button>
          ))}
        </div>

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
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-wxops-purple px-3 py-1.5 text-sm font-medium text-white hover:bg-wxops-purple/90 disabled:opacity-60"
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
