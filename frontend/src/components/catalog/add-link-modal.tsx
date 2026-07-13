"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X, Loader2 } from "lucide-react";
import type { Entity } from "@/lib/types";

interface AddLinkModalProps {
  entity: Entity;
  onClose: () => void;
}

const LINK_TYPES = [
  { value: "documentation", label: "Documentation", description: "General docs or wiki page" },
  { value: "runbook", label: "Runbook", description: "Operational runbook or playbook" },
  { value: "rfc", label: "RFC", description: "Request for Comments proposal" },
  { value: "adr", label: "ADR", description: "Architecture Decision Record" },
  { value: "dashboard", label: "Dashboard", description: "Monitoring or observability dashboard" },
  { value: "repository", label: "Repository", description: "Source code repository" },
  { value: "openapi", label: "OpenAPI Spec", description: "OpenAPI / Swagger specification" },
];

export function AddLinkModal({ entity, onClose }: AddLinkModalProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState("documentation");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSave = async () => {
    if (!url.trim()) {
      toast.error("URL is required");
      return;
    }

    setSaving(true);
    try {
      const updated: Entity = {
        ...entity,
        metadata: {
          ...entity.metadata,
          links: [
            ...(entity.metadata.links ?? []),
            { url: url.trim(), title: title.trim() || undefined, type },
          ],
        },
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

      toast.success("Link added");
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
      <div className="relative w-full max-w-md rounded-xl border bg-background shadow-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Add Link to {entity.metadata.name}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">URL</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              autoFocus
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Runbook, Dashboard, etc."
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
            >
              {LINK_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            {type && (
              <p className="mt-1 text-[11px] text-muted-foreground leading-tight">
                {LINK_TYPES.find((t) => t.value === type)?.description}
              </p>
            )}
          </div>
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
            disabled={saving || !url.trim()}
            className="flex items-center gap-1.5 rounded-md bg-wxops-purple px-3 py-1.5 text-sm font-medium text-white hover:bg-wxops-purple/90 disabled:opacity-60"
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Adding...
              </>
            ) : (
              "Add Link"
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
