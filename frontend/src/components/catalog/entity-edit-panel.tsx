"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import yaml from "js-yaml";
import { X, Loader2, Plus, Trash2, ArrowLeft, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entity, EntityLink } from "@/lib/types";

interface EntityEditPanelProps {
  entity: Entity;
  allEntities: Entity[];
  onClose: () => void;
}

const LINK_TYPES = [
  { value: "documentation", label: "Documentation", description: "General docs or wiki page" },
  { value: "repository", label: "Repository", description: "Source code repository" },
  { value: "rfc", label: "RFC", description: "Request for Comments proposal" },
  { value: "adr", label: "ADR", description: "Architecture Decision Record" },
  { value: "runbook", label: "Runbook", description: "Operational runbook or playbook" },
  { value: "dashboard", label: "Dashboard", description: "Monitoring or observability dashboard" },
  { value: "openapi", label: "OpenAPI Spec", description: "OpenAPI / Swagger specification" },
  { value: "gitea", label: "Gitea", description: "Link to Gitea repository" },
];

const LIFECYCLES = [
  { value: "experimental", label: "Experimental", description: "Newly created, not yet validated or deployed" },
  { value: "development", label: "Development", description: "Actively being built and tested in dev/staging" },
  { value: "production", label: "Production", description: "Running in production, serving real traffic" },
  { value: "deprecated", label: "Deprecated", description: "Being decommissioned, avoid new dependencies" },
];

export function EntityEditPanel({
  entity,
  allEntities,
  onClose,
}: EntityEditPanelProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  // Metadata
  const [title, setTitle] = useState(entity.metadata.title ?? "");
  const [description, setDescription] = useState(
    entity.metadata.description ?? "",
  );
  const [tags, setTags] = useState((entity.metadata.tags ?? []).join(", "));
  const [lifecycle, setLifecycle] = useState(entity.spec.lifecycle ?? "");
  const [links, setLinks] = useState<EntityLink[]>([
    ...(entity.metadata.links ?? []),
  ]);
  const [annotations, setAnnotations] = useState<
    Array<{ key: string; value: string }>
  >(
    Object.entries(entity.metadata.annotations ?? {}).map(([key, value]) => ({
      key,
      value,
    })),
  );

  // System
  const [domain, setDomain] = useState(entity.spec.domain ?? "");

  // Doc
  const [draft, setDraft] = useState(entity.spec.draft ?? false);
  const [contentUrl, setContentUrl] = useState(entity.spec.contentUrl ?? "");

  // Relationships
  const [system, setSystem] = useState(entity.spec.system ?? "");
  const [dependsOn, setDependsOn] = useState<string[]>([
    ...(entity.spec.dependsOn ?? []),
  ]);
  const [providesApis, setProvidesApis] = useState<string[]>([
    ...(entity.spec.providesApis ?? []),
  ]);
  const [consumesApis, setConsumesApis] = useState<string[]>([
    ...(entity.spec.consumesApis ?? []),
  ]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Build ref options from allEntities
  const entityRefs = useMemo(() => {
    return allEntities.map((e) => {
      const ns = e.metadata.namespace || "default";
      return `${e.kind.toLowerCase()}:${ns}/${e.metadata.name}`;
    });
  }, [allEntities]);

  const systemNames = useMemo(() => {
    return allEntities
      .filter((e) => e.kind === "System")
      .map((e) => e.metadata.name);
  }, [allEntities]);

  const buildUpdatedEntity = (): Entity => {
    const updated: Entity = {
      ...entity,
      metadata: {
        ...entity.metadata,
        title: title || undefined,
        description: description || undefined,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        links: links.filter((l) => l.url),
        annotations: Object.fromEntries(
          annotations.filter((a) => a.key).map((a) => [a.key, a.value]),
        ),
      },
      spec: {
        ...entity.spec,
        lifecycle: lifecycle || undefined,
        system: system || undefined,
        domain: entity.kind === "System" ? (domain || undefined) : entity.spec.domain,
        dependsOn: dependsOn.filter(Boolean),
        providesApis: providesApis.filter(Boolean),
        consumesApis: consumesApis.filter(Boolean),
        draft: entity.kind === "Doc" ? draft : undefined,
        contentUrl: entity.kind === "Doc" ? (contentUrl || undefined) : entity.spec.contentUrl,
      },
    };
    if (!updated.spec.dependsOn?.length) delete updated.spec.dependsOn;
    if (!updated.spec.providesApis?.length) delete updated.spec.providesApis;
    if (!updated.spec.consumesApis?.length) delete updated.spec.consumesApis;
    return updated;
  };

  const previewYAML = useMemo(() => {
    if (!reviewing) return "";
    try {
      return yaml.dump(buildUpdatedEntity(), { lineWidth: 80, noRefs: true });
    } catch {
      return "# error generating preview";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewing, title, description, tags, lifecycle, links, annotations, system, domain, dependsOn, providesApis, consumesApis, draft, contentUrl]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = buildUpdatedEntity();
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

      toast.success("Entity updated");
      onClose();
      router.refresh();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  const showRelationships = ["Component", "API", "Resource"].includes(
    entity.kind,
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-background border-l border-border shadow-xl overflow-y-auto animate-in slide-in-from-right">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-5 py-3">
          <h2 className="text-sm font-semibold">
            Edit {entity.kind}: {entity.metadata.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Review preview ──────────────────────────────────────── */}
        {reviewing && (
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <Eye className="h-4 w-4 text-wxops-purple" />
              <span className="font-medium">Review Changes</span>
            </div>
            <p className="text-xs text-muted-foreground">
              This is the YAML that will be committed. Review before submitting.
            </p>
            <pre className="overflow-auto rounded-md border bg-muted/30 p-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap max-h-[60vh]">
              {previewYAML}
            </pre>
          </div>
        )}

        {/* ── Edit form ──────────────────────────────────────────── */}
        <div className={cn("p-5 space-y-5", reviewing && "hidden")}>
          {/* ── Metadata ──────────────────────────────────────────── */}
          <SectionHeading>Metadata</SectionHeading>

          <Field label="Title">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={entity.metadata.name}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
            />
          </Field>

          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wxops-purple/50 resize-none"
            />
          </Field>

          <Field label="Tags" hint="Comma-separated">
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="go, rest, payments"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
            />
          </Field>

          {entity.spec.lifecycle !== undefined && (
            <Field label="Lifecycle">
              <select
                value={lifecycle}
                onChange={(e) => setLifecycle(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
              >
                <option value="">—</option>
                {LIFECYCLES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
              <SelectHint items={LIFECYCLES} value={lifecycle} />
            </Field>
          )}

          {/* ── Domain (System only) ────────────────────────────── */}
          {entity.kind === "System" && (
            <Field label="Domain" hint="Business domain">
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="e.g. finance, logistics, platform"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
              />
              <p className="mt-1 text-[11px] text-muted-foreground leading-tight">
                Groups related systems under a business domain.
              </p>
            </Field>
          )}

          {/* ── Doc visibility ──────────────────────────────────── */}
          {entity.kind === "Doc" && (
            <Field label="Visibility">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setDraft(true)}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                    draft
                      ? "border-yellow-400 bg-yellow-50 text-yellow-800 dark:border-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400"
                      : "border-border text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  Draft
                </button>
                <button
                  type="button"
                  onClick={() => setDraft(false)}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                    !draft
                      ? "border-green-400 bg-green-50 text-green-800 dark:border-green-600 dark:bg-green-900/20 dark:text-green-400"
                      : "border-border text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  Published
                </button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground leading-tight">
                {draft
                  ? "Only visible to your team. Publish when ready for others to see."
                  : "Visible to everyone with access to this system or service."}
              </p>
            </Field>
          )}

          {/* ── Content URL (Doc only) ───────────────────────────── */}
          {entity.kind === "Doc" && (
            <Field label="Content URL" hint="Path or URL to markdown source">
              <input
                type="text"
                value={contentUrl}
                onChange={(e) => setContentUrl(e.target.value)}
                placeholder="team/docs/rfc-001.md or https://..."
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
              />
              <p className="mt-1 text-[11px] text-muted-foreground leading-tight">
                Relative path in the catalog repo or an absolute URL to the markdown file.
              </p>
            </Field>
          )}

          {/* ── Relationships ─────────────────────────────────────── */}
          {showRelationships && (
            <>
              <SectionHeading>Relationships</SectionHeading>

              <Field label="System">
                <EntityRefSelect
                  value={system}
                  onChange={setSystem}
                  options={systemNames}
                  placeholder="Select a system..."
                />
              </Field>

              <RefArrayEditor
                label="Depends On"
                hint="Components and resources this entity depends on"
                items={dependsOn}
                onChange={setDependsOn}
                suggestions={entityRefs}
                filterKinds={["component", "resource"]}
              />

              <RefArrayEditor
                label="Provides APIs"
                hint="APIs exposed by this entity"
                items={providesApis}
                onChange={setProvidesApis}
                suggestions={entityRefs}
                filterKinds={["api"]}
              />

              <RefArrayEditor
                label="Consumes APIs"
                hint="APIs consumed by this entity"
                items={consumesApis}
                onChange={setConsumesApis}
                suggestions={entityRefs}
                filterKinds={["api"]}
              />
            </>
          )}

          {/* ── Links ─────────────────────────────────────────────── */}
          <SectionHeading>Links</SectionHeading>
          {links.map((link, i) => (
            <div key={i} className="flex gap-2 items-start">
              <div className="flex-1 space-y-1.5">
                <input
                  type="text"
                  value={link.url}
                  onChange={(e) => {
                    const next = [...links];
                    next[i] = { ...next[i], url: e.target.value };
                    setLinks(next);
                  }}
                  placeholder="https://..."
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
                />
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={link.title ?? ""}
                    onChange={(e) => {
                      const next = [...links];
                      next[i] = { ...next[i], title: e.target.value };
                      setLinks(next);
                    }}
                    placeholder="Title"
                    className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
                  />
                  <select
                    value={link.type ?? ""}
                    onChange={(e) => {
                      const next = [...links];
                      next[i] = { ...next[i], type: e.target.value };
                      setLinks(next);
                    }}
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
                  >
                    <option value="">Type...</option>
                    {LINK_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLinks(links.filter((_, j) => j !== i))}
                className="mt-1 rounded-md p-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setLinks([
                ...links,
                { url: "", title: "", type: "documentation" },
              ])
            }
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
            Add link
          </button>

          {/* ── Annotations ───────────────────────────────────────── */}
          <SectionHeading>Annotations</SectionHeading>
          {annotations.map((ann, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="text"
                value={ann.key}
                onChange={(e) => {
                  const next = [...annotations];
                  next[i] = { ...next[i], key: e.target.value };
                  setAnnotations(next);
                }}
                placeholder="key"
                className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
              />
              <input
                type="text"
                value={ann.value}
                onChange={(e) => {
                  const next = [...annotations];
                  next[i] = { ...next[i], value: e.target.value };
                  setAnnotations(next);
                }}
                placeholder="value"
                className="flex-[2] rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
              />
              <button
                type="button"
                onClick={() =>
                  setAnnotations(annotations.filter((_, j) => j !== i))
                }
                className="rounded-md p-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setAnnotations([...annotations, { key: "", value: "" }])
            }
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
            Add annotation
          </button>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 border-t bg-background px-5 py-3 flex items-center justify-between gap-2">
          {reviewing ? (
            <>
              <button
                type="button"
                onClick={() => setReviewing(false)}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted/50"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Edit
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
                    Submitting...
                  </>
                ) : (
                  "Confirm & Submit"
                )}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted/50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setReviewing(true)}
                className="flex items-center gap-1.5 rounded-md bg-wxops-purple px-3 py-1.5 text-sm font-medium text-white hover:bg-wxops-purple/90"
              >
                <Eye className="h-3.5 w-3.5" />
                Review Changes
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────────────────── */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2 border-t border-border">
      {children}
    </p>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">
        {label}
        {hint && (
          <span className="ml-1 text-muted-foreground font-normal text-xs">
            ({hint})
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

function SelectHint({
  items,
  value,
}: {
  items: Array<{ value: string; description: string }>;
  value: string;
}) {
  const desc = items.find((i) => i.value === value)?.description;
  if (!desc) return null;
  return (
    <p className="mt-1 text-[11px] text-muted-foreground leading-tight">{desc}</p>
  );
}

function EntityRefSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function RefArrayEditor({
  label,
  hint,
  items,
  onChange,
  suggestions,
  filterKinds,
}: {
  label: string;
  hint: string;
  items: string[];
  onChange: (items: string[]) => void;
  suggestions: string[];
  filterKinds: string[];
}) {
  const filtered = useMemo(
    () =>
      suggestions.filter((ref) =>
        filterKinds.some((k) => ref.startsWith(k + ":")),
      ),
    [suggestions, filterKinds],
  );

  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    if (!query) return filtered.slice(0, 8);
    const q = query.toLowerCase();
    return filtered.filter((r) => r.toLowerCase().includes(q)).slice(0, 8);
  }, [filtered, query]);

  const add = (ref: string) => {
    if (ref && !items.includes(ref)) {
      onChange([...items, ref]);
    }
    setQuery("");
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">
        {label}
        <span className="ml-1 text-muted-foreground font-normal text-xs">
          ({hint})
        </span>
      </p>

      {/* Current refs */}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((ref) => (
            <span
              key={ref}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-mono"
            >
              {ref}
              <button
                type="button"
                onClick={() => onChange(items.filter((r) => r !== ref))}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Autocomplete input */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches.length > 0) {
              e.preventDefault();
              add(matches[0]);
            }
          }}
          placeholder={`Search ${filterKinds.join("/")} entities...`}
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
        />
        {query && matches.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-background shadow-lg max-h-40 overflow-y-auto">
            {matches.map((ref) => (
              <button
                key={ref}
                type="button"
                onClick={() => add(ref)}
                className={cn(
                  "w-full px-2.5 py-1.5 text-left text-xs font-mono hover:bg-muted/50 transition-colors",
                  items.includes(ref) && "opacity-40",
                )}
              >
                {ref}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
