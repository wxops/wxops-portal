"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  Box,
  Globe,
  Database,
  FileText,
  Server,
  Loader2,
  CheckCircle,
  ArrowLeft,
  EyeOff,
} from "lucide-react";
import type { Entity } from "@/lib/types";

interface RegisterEntityFormProps {
  groups: string[];
  username: string;
  initialKind?: string;
  initialRelatedTo?: string;
}

type EntityKind =
  | "Component"
  | "API"
  | "Resource"
  | "Doc"
  | "System";

const KINDS: Array<{
  kind: EntityKind;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
}> = [
  {
    kind: "Component",
    icon: Box,
    label: "Component",
    description: "Service, website, or library",
  },
  {
    kind: "API",
    icon: Globe,
    label: "API",
    description: "OpenAPI, AsyncAPI, or gRPC interface",
  },
  {
    kind: "Resource",
    icon: Database,
    label: "Resource",
    description: "Database, cache, queue, or vault",
  },
  {
    kind: "Doc",
    icon: FileText,
    label: "Document",
    description: "RFC, ADR, or runbook",
  },
  {
    kind: "System",
    icon: Server,
    label: "System",
    description: "Group of related components",
  },
];

const COMPONENT_TYPES = [
  { value: "service", label: "Service", description: "Backend service or microservice" },
  { value: "website", label: "Website", description: "User-facing web application" },
  { value: "library", label: "Library", description: "Shared library or package" },
  { value: "pipeline", label: "Pipeline", description: "Data or CI/CD pipeline" },
];
const API_TYPES = [
  { value: "openapi", label: "OpenAPI", description: "REST API described by OpenAPI/Swagger spec" },
  { value: "asyncapi", label: "AsyncAPI", description: "Event-driven API described by AsyncAPI spec" },
  { value: "grpc", label: "gRPC", description: "gRPC service with Protocol Buffers" },
];
const RESOURCE_TYPES = [
  { value: "database", label: "Database", description: "Relational or NoSQL database" },
  { value: "cache", label: "Cache", description: "In-memory cache (Redis, Memcached)" },
  { value: "queue", label: "Queue", description: "Message queue or event stream" },
  { value: "vault", label: "Vault", description: "Secret management store" },
  { value: "s3", label: "S3", description: "Object storage bucket" },
];
const DOC_TYPES = [
  { value: "rfc", label: "RFC", description: "Request for Comments — proposes a design or process change" },
  { value: "adr", label: "ADR", description: "Architecture Decision Record — documents a key decision" },
  { value: "documentation", label: "Documentation", description: "General reference or guide" },
];
const DOC_STATUSES = [
  { value: "proposed", label: "Proposed", description: "Initial draft, open for discussion" },
  { value: "under-review", label: "Under Review", description: "Being reviewed by stakeholders" },
  { value: "accepted", label: "Accepted", description: "Approved and active" },
  { value: "deprecated", label: "Deprecated", description: "No longer current, kept for reference" },
  { value: "superseded", label: "Superseded", description: "Replaced by a newer document" },
];
const LIFECYCLES = [
  { value: "experimental", label: "Experimental", description: "Newly created, not yet validated or deployed" },
  { value: "development", label: "Development", description: "Actively being built and tested in dev/staging" },
  { value: "production", label: "Production", description: "Running in production, serving real traffic" },
  { value: "deprecated", label: "Deprecated", description: "Being decommissioned, avoid new dependencies" },
];

export function RegisterEntityForm({ groups, username, initialKind, initialRelatedTo }: RegisterEntityFormProps) {
  const router = useRouter();
  const [kind, setKind] = useState<EntityKind | null>(
    initialKind && KINDS.some((k) => k.kind === initialKind)
      ? (initialKind as EntityKind)
      : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ kind: string; name: string } | null>(null);
  const [allEntities, setAllEntities] = useState<Entity[]>([]);

  // Common fields
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [owner, setOwner] = useState(
    groups[0] ? `group:${groups[0]}` : "",
  );
  const [lifecycle, setLifecycle] = useState("experimental");
  const [entityType, setEntityType] = useState(
    initialKind === "Resource" ? "database" : initialKind === "API" ? "openapi" : "",
  );
  const [system, setSystem] = useState(() => {
    if (!initialRelatedTo) return "";
    if (initialRelatedTo.startsWith("system:")) {
      return initialRelatedTo.split("/").pop() ?? "";
    }
    return "";
  });

  // System-specific
  const [domain, setDomain] = useState("");

  // Doc-specific
  const [docType, setDocType] = useState("documentation");
  const [docStatus, setDocStatus] = useState("proposed");
  const [contentUrl, setContentUrl] = useState("");
  const shortUser = username.includes("@") ? username.split("@")[0] : username;
  const [author] = useState(`user:${shortUser}`);
  const [relatedTo, setRelatedTo] = useState<string[]>(
    initialRelatedTo ? [initialRelatedTo] : [],
  );

  void router;

  useEffect(() => {
    fetch("/api/catalog/entities", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        const entities: Entity[] = data.entities ?? [];
        setAllEntities(entities);

        // Auto-set owner from the source entity when navigating via relatedTo
        if (initialRelatedTo) {
          const refName = initialRelatedTo.includes("/")
            ? initialRelatedTo.split("/").pop()!
            : initialRelatedTo;
          const sourceEntity = entities.find(
            (e) => e.metadata.name === refName,
          );
          if (sourceEntity?.spec.owner) {
            setOwner(sourceEntity.spec.owner);
          }
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const systemNames = useMemo(
    () => allEntities.filter((e) => e.kind === "System").map((e) => e.metadata.name),
    [allEntities],
  );

  const relatedToOptions = useMemo(
    () =>
      allEntities
        .filter((e) => ["Component", "System", "Resource", "API"].includes(e.kind))
        .map((e) => {
          const ns = e.metadata.namespace || "default";
          return `${e.kind.toLowerCase()}:${ns}/${e.metadata.name}`;
        }),
    [allEntities],
  );

  const resetFields = () => {
    setName("");
    setTitle("");
    setDescription("");
    setTags("");
    setOwner(groups[0] ? `group:${groups[0]}` : "");
    setLifecycle("experimental");
    setEntityType("");
    setSystem("");
    setDomain("");
    setDocType("documentation");
    setDocStatus("proposed");
    setContentUrl("");
    setRelatedTo([]);
  };

  const handleKindSelect = (k: EntityKind) => {
    setKind(k);
    resetFields();
    setOwner(groups[0] ? `group:${groups[0]}` : "");
    if (k === "Component") setEntityType("service");
    if (k === "API") setEntityType("openapi");
    if (k === "Resource") setEntityType("database");
  };

  const buildEntity = (): Entity => {
    const apiVersion =
      kind === "Doc" ? "wxops.cloud/v1alpha1" : "backstage.io/v1alpha1";

    const entity: Entity = {
      apiVersion,
      kind: kind!,
      metadata: {
        name,
        title: title || undefined,
        description: description || undefined,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      },
      spec: {},
    };

    if (["Component", "API", "Resource", "System", "Doc"].includes(kind!)) {
      entity.spec.owner = owner || undefined;
    }
    if (["Component", "API", "Resource"].includes(kind!)) {
      entity.spec.lifecycle = lifecycle;
      entity.spec.type = entityType;
      entity.spec.system = system || undefined;
    }
    if (kind === "System") {
      entity.spec.domain = domain || undefined;
    }
    if (kind === "Doc") {
      entity.spec.docType = docType;
      entity.spec.docStatus = docStatus;
      entity.spec.author = author || undefined;
      entity.spec.contentUrl = contentUrl || undefined;
      entity.spec.relatedTo = relatedTo.length > 0 ? relatedTo : undefined;
    }

    return entity;
  };

  const handleSubmit = async (asDraft = false) => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSubmitting(true);
    try {
      const entity = buildEntity();
      if (kind === "Doc") {
        entity.spec.draft = asDraft;
      }
      const res = await fetch("/api/catalog/entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(entity),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }

      setSuccess({ kind: kind!, name });
      toast.success(`${kind} registered`);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Success view ──
  if (success) {
    return (
      <div className="mx-auto max-w-lg text-center space-y-6 py-12">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
          <CheckCircle className="h-8 w-8 text-green-500" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Entity Registered</h2>
          <p className="mt-1 text-muted-foreground">
            <span className="font-mono text-foreground">
              {success.kind}/{success.name}
            </span>{" "}
            has been added to the catalog.
          </p>
        </div>
        <div className="flex justify-center gap-3">
          <Link
            href={`/dashboard/catalog/${success.kind}/${success.name}`}
            className="rounded-lg bg-wxops-purple px-4 py-2 text-sm font-medium text-white hover:bg-wxops-purple/90"
          >
            View Entity
          </Link>
          <button
            type="button"
            onClick={() => {
              setSuccess(null);
              setKind(null);
            }}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50"
          >
            Register Another
          </button>
        </div>
      </div>
    );
  }

  // ── Kind selection ──
  if (!kind) {
    return (
      <div className="space-y-6">
        <div>
          <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4">
            <Link href="/dashboard/catalog" className="hover:text-foreground">
              Catalog
            </Link>
            <span>/</span>
            <span className="text-foreground font-medium">Register</span>
          </nav>
          <h1 className="text-2xl font-bold tracking-tight">Register Entity</h1>
          <p className="text-muted-foreground mt-1">
            Choose the type of entity you want to add to the catalog.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {KINDS.map(({ kind: k, icon: Icon, label, description: desc }) => (
            <button
              key={k}
              type="button"
              onClick={() => handleKindSelect(k)}
              className="rounded-xl border border-border p-5 text-left transition-all hover:border-wxops-purple/40 hover:bg-wxops-purple/5"
            >
              <Icon className="h-5 w-5 text-wxops-purple mb-2" />
              <p className="font-medium text-sm">{label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Entity form ──
  const kindMeta = KINDS.find((k) => k.kind === kind)!;
  const KindIcon = kindMeta.icon;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4">
          <Link href="/dashboard/catalog" className="hover:text-foreground">
            Catalog
          </Link>
          <span>/</span>
          <button
            type="button"
            onClick={() => setKind(null)}
            className="hover:text-foreground"
          >
            Register
          </button>
          <span>/</span>
          <span className="text-foreground font-medium">{kind}</span>
        </nav>

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-wxops-purple/10">
            <KindIcon className="h-5 w-5 text-wxops-purple" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Register {kindMeta.label}
            </h1>
            <p className="text-sm text-muted-foreground">{kindMeta.description}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border p-6 space-y-5">
        {/* Name */}
        <FormField label="Name" required>
          <input
            type="text"
            value={name}
            onChange={(e) =>
              setName(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9-]/g, "-")
                  .replace(/-+/g, "-"),
              )
            }
            placeholder="my-entity-name"
            className={cn(inputClass, "font-mono")}
          />
        </FormField>

        {/* Title */}
        <FormField label="Title">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Human-readable title"
            className={inputClass}
          />
        </FormField>

        {/* Description */}
        <FormField label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="What is this entity?"
            className={cn(inputClass, "resize-none")}
          />
        </FormField>

        {/* Tags */}
        <FormField label="Tags" hint="Comma-separated">
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="go, rest, payments"
            className={cn(inputClass, "font-mono")}
          />
        </FormField>

        {/* Owner — determines which tenant directory the entity belongs to */}
        <FormField label="Owner" hint="Tenant team that owns this entity">
          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className={inputClass}
          >
            <option value="">Select owner...</option>
            {groups.map((g) => (
              <option key={g} value={`group:${g}`}>
                group:{g}
              </option>
            ))}
          </select>
        </FormField>


        {/* Type + Lifecycle + System — for Component, API, Resource */}
        {["Component", "API", "Resource"].includes(kind) && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Type">
                <select
                  value={entityType}
                  onChange={(e) => setEntityType(e.target.value)}
                  className={inputClass}
                >
                  {(kind === "Component"
                    ? COMPONENT_TYPES
                    : kind === "API"
                      ? API_TYPES
                      : RESOURCE_TYPES
                  ).map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <SelectHint
                  items={kind === "Component" ? COMPONENT_TYPES : kind === "API" ? API_TYPES : RESOURCE_TYPES}
                  value={entityType}
                />
              </FormField>

              <FormField label="Lifecycle">
                <select
                  value={lifecycle}
                  onChange={(e) => setLifecycle(e.target.value)}
                  className={inputClass}
                >
                  {LIFECYCLES.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <SelectHint items={LIFECYCLES} value={lifecycle} />
              </FormField>
            </div>

            <FormField label="System" hint="Optional">
              <select
                value={system}
                onChange={(e) => setSystem(e.target.value)}
                className={inputClass}
              >
                <option value="">None</option>
                {systemNames.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </FormField>
          </>
        )}

        {/* System-specific */}
        {kind === "System" && (
          <FormField label="Domain" hint="Business domain grouping related systems">
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="e.g. finance, logistics, platform"
              className={cn(inputClass, "font-mono")}
            />
            <p className="mt-1 text-[11px] text-muted-foreground leading-tight">
              Groups related systems under a business domain — e.g. finance, logistics, platform.
            </p>
          </FormField>
        )}

        {/* Doc-specific fields */}
        {kind === "Doc" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Document Type">
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                  className={inputClass}
                >
                  {DOC_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <SelectHint items={DOC_TYPES} value={docType} />
              </FormField>
              <FormField label="Status">
                <select
                  value={docStatus}
                  onChange={(e) => setDocStatus(e.target.value)}
                  className={inputClass}
                >
                  {DOC_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <SelectHint items={DOC_STATUSES} value={docStatus} />
              </FormField>
            </div>
            <FormField label="Author" hint="From your login session">
              <div className="flex items-center rounded-md border border-border bg-muted/30 px-3 py-2 text-sm font-mono text-muted-foreground">
                {author}
              </div>
            </FormField>
            <FormField label="Content URL" hint="Relative path or absolute URL to markdown">
              <input
                type="text"
                value={contentUrl}
                onChange={(e) => setContentUrl(e.target.value)}
                placeholder="rocket-team/docs/rfcs/rfc-001.md"
                className={cn(inputClass, "font-mono")}
              />
            </FormField>

            {/* Related systems/components */}
            <FormField label="Related To" hint="Link this doc to systems or services">
              <div className="space-y-2">
                {relatedTo.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {relatedTo.map((ref) => (
                      <span
                        key={ref}
                        className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-mono"
                      >
                        {ref}
                        <button
                          type="button"
                          onClick={() => setRelatedTo(relatedTo.filter((r) => r !== ref))}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value && !relatedTo.includes(e.target.value)) {
                      setRelatedTo([...relatedTo, e.target.value]);
                    }
                  }}
                  className={inputClass}
                >
                  <option value="">Select a system or service...</option>
                  {relatedToOptions
                    .filter((r) => !relatedTo.includes(r))
                    .map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                </select>
                <p className="text-[10px] text-muted-foreground">
                  Link this document to the systems and services it describes.
                </p>
              </div>
            </FormField>
          </>
        )}



      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setKind(null)}
          className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="flex items-center gap-2">
          {kind === "Doc" && (
            <button
              type="button"
              onClick={() => handleSubmit(true)}
              disabled={submitting || !name.trim()}
              className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50 disabled:opacity-60"
            >
              <EyeOff className="h-4 w-4" />
              Save as Draft
            </button>
          )}
          <button
            type="button"
            onClick={() => handleSubmit(false)}
            disabled={submitting || !name.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-wxops-purple px-5 py-2 text-sm font-medium text-white hover:bg-wxops-purple/90 disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Registering...
              </>
            ) : kind === "Doc" ? (
              "Publish"
            ) : (
              `Register ${kindMeta.label}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wxops-purple/50";

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

function FormField({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
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
