"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { Pencil, LinkIcon, Eye, Loader2, GitBranch, Plus, FileText, Database, Globe, ChevronDown, Trash2, AlertTriangle, Settings } from "lucide-react";
import type { Entity } from "@/lib/types";
import { EntityEditPanel } from "./entity-edit-panel";
import { AddLinkModal } from "./add-link-modal";
import { DocContentEditorModal } from "./doc-content-editor-modal";
import { EditDomainModal } from "./edit-domain-modal";

const PLATFORM_TEAM = "platform-team";

interface EntityActionsProps {
  entity: Entity;
  userGroups: string[];
}

function canEdit(entity: Entity, groups: string[]): boolean {
  if (groups.some((g) => g === PLATFORM_TEAM)) return true;
  const owner = entity.spec.owner ?? "";
  const team = owner.includes(":") ? owner.split(":")[1] : owner;
  return !!team && groups.some((g) => g.toLowerCase() === team.toLowerCase());
}

export function EntityActions({ entity, userGroups }: EntityActionsProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [contentEditorOpen, setContentEditorOpen] = useState(false);
  const [domainOpen, setDomainOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerPos, setRegisterPos] = useState<{ top: number; right: number } | null>(null);
  const registerBtnRef = useRef<HTMLButtonElement>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [allEntities, setAllEntities] = useState<Entity[]>([]);

  const editable = canEdit(entity, userGroups);
  const isDraft = entity.kind === "Doc" && entity.spec.draft === true;
  const isPlatformTeam = userGroups.some((g) => g === PLATFORM_TEAM);
  const hasScaffoldConfig = entity.kind === "Component" && !!entity.metadata.annotations?.["wxops.cloud/template-id"];
  const canRegister = ["Component", "System", "Resource", "API"].includes(entity.kind);
  const entityRef = `${entity.kind.toLowerCase()}:${entity.metadata.namespace || "default"}/${entity.metadata.name}`;

  const registerOptions = canRegister
    ? [
        { kind: "Doc", icon: FileText, label: "Document", description: "RFC, ADR, or Runbook" },
        ...(entity.kind === "Component" || entity.kind === "System"
          ? [
              { kind: "Resource", icon: Database, label: "Resource", description: "Database, cache, or vault" },
              { kind: "API", icon: Globe, label: "API", description: "OpenAPI, AsyncAPI, or gRPC" },
            ]
          : []),
      ]
    : [];

  useEffect(() => {
    if (!editOpen) return;
    fetch("/api/catalog/entities", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        setAllEntities(data.entities ?? []);
      })
      .catch(() => {});
  }, [editOpen]);

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const updated: Entity = {
        ...entity,
        spec: { ...entity.spec, draft: false },
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
      toast.success("Document published");
      router.refresh();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setPublishing(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/catalog/entities/${entity.kind}/${entity.metadata.name}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      toast.success(data.status ?? `${entity.kind}/${entity.metadata.name} deleted`);
      router.push("/dashboard/catalog");
    } catch (err) {
      toast.error(String(err));
    } finally {
      setDeleting(false);
      setDeleteConfirm(false);
    }
  };

  if (!editable) return null;

  return (
    <>
      <div className="flex items-center gap-2">
        {isDraft && (
          <button
            type="button"
            onClick={handlePublish}
            disabled={publishing}
            className="flex items-center gap-1.5 rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-60"
          >
            {publishing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            Publish
          </button>
        )}
        {entity.kind === "System" && (
          <button
            type="button"
            onClick={() => setDomainOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/50"
          >
            <Globe className="h-3.5 w-3.5" />
            {entity.spec.domain ? `Domain: ${entity.spec.domain}` : "Set Domain"}
          </button>
        )}
        {entity.kind === "Doc" && (
          <button
            type="button"
            onClick={() => setContentEditorOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/50"
          >
            <GitBranch className="h-3.5 w-3.5" />
            Edit Content
          </button>
        )}
        {hasScaffoldConfig && (
          <Link
            href={`/dashboard/catalog/${entity.kind}/${entity.metadata.name}/edit-config`}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/50"
          >
            <Settings className="h-3.5 w-3.5" />
            Edit Config
          </Link>
        )}
        {canRegister && (
          <button
            ref={registerBtnRef}
            type="button"
            onClick={() => {
              if (!registerOpen && registerBtnRef.current) {
                const rect = registerBtnRef.current.getBoundingClientRect();
                setRegisterPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
              }
              setRegisterOpen((v) => !v);
            }}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/50"
          >
            <Plus className="h-3.5 w-3.5" />
            Register
            <ChevronDown className="h-3 w-3" />
          </button>
        )}
        {registerOpen && registerPos && createPortal(
          <>
            <div className="fixed inset-0 z-30" onClick={() => setRegisterOpen(false)} />
            <div
              className="fixed z-40 w-56 rounded-lg border border-border bg-background shadow-lg py-1"
              style={{ top: registerPos.top, right: registerPos.right }}
            >
              {registerOptions.map((opt) => (
                <Link
                  key={opt.kind}
                  href={`/dashboard/catalog/register?kind=${opt.kind}&relatedTo=${entityRef}`}
                  onClick={() => setRegisterOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                >
                  <opt.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="font-medium text-xs">{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground">{opt.description}</p>
                  </div>
                </Link>
              ))}
            </div>
          </>,
          document.body,
        )}
        <button
          type="button"
          onClick={() => setLinkOpen(true)}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/50"
        >
          <LinkIcon className="h-3.5 w-3.5" />
          Add Link
        </button>
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="flex items-center gap-1.5 rounded-md bg-wxops-purple/10 border border-wxops-purple/30 px-2.5 py-1.5 text-xs font-medium text-wxops-purple transition-colors hover:bg-wxops-purple/20"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </button>
        {isPlatformTeam && (
          <button
            type="button"
            onClick={() => setDeleteConfirm(true)}
            className="flex items-center gap-1.5 rounded-md border border-destructive/30 px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        )}
      </div>

      {/* Delete confirmation */}
      {deleteConfirm && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteConfirm(false)} />
          <div className="relative w-full max-w-sm rounded-xl border bg-background shadow-xl p-5 space-y-4">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <h3 className="text-sm font-semibold">Delete Entity</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete{" "}
              <span className="font-mono font-medium text-foreground">
                {entity.kind}/{entity.metadata.name}
              </span>
              ? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirm(false)}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted/50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
              >
                {deleting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  "Delete"
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {editOpen && (
        <EntityEditPanel
          entity={entity}
          allEntities={allEntities}
          onClose={() => setEditOpen(false)}
        />
      )}
      {linkOpen && (
        <AddLinkModal entity={entity} onClose={() => setLinkOpen(false)} />
      )}
      {contentEditorOpen && (
        <DocContentEditorModal entity={entity} onClose={() => setContentEditorOpen(false)} />
      )}
      {domainOpen && (
        <EditDomainModal entity={entity} onClose={() => setDomainOpen(false)} />
      )}
    </>
  );
}
