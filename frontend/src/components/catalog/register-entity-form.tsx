"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import yaml from "js-yaml";
import { addNotification } from "@/lib/notifications";
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
  Eye,
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
  const [reviewing, setReviewing] = useState(false);
  const [pendingDraft, setPendingDraft] = useState(false);
  const [success, setSuccess] = useState<{ kind: string; name: string } | null>(null);
  const [allEntities, setAllEntities] = useState<Entity[]>([]);

  // Common fields
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const topLevelGroups = groups.filter((g) => !g.includes(":"));
  const [owner, setOwner] = useState(
    topLevelGroups[0] ? `group:${topLevelGroups[0]}` : "",
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
        .filter((e) => ["Component", "Resource", "API"].includes(e.kind))
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
    setOwner(topLevelGroups[0] ? `group:${topLevelGroups[0]}` : "");
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
    setOwner(topLevelGroups[0] ? `group:${topLevelGroups[0]}` : "");
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
      entity.spec.system = system || undefined;
      entity.spec.contentUrl = contentUrl || undefined;
      entity.spec.relatedTo = relatedTo.length > 0 ? relatedTo : undefined;
    }

    return entity;
  };

  // Live YAML — updates as the user types (drives the right-side preview panel).
  const liveYAML = useMemo(() => {
    if (!kind) return "";
    try {
      const entity = buildEntity();
      if (kind === "Doc") entity.spec.draft = pendingDraft;
      return yaml.dump(entity, { lineWidth: 80, noRefs: true });
    } catch {
      return "# error generating preview";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, name, title, description, tags, owner, lifecycle, entityType, system, domain,
      docType, docStatus, contentUrl, relatedTo, pendingDraft]);

  const handleReview = (asDraft = false) => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setPendingDraft(asDraft);
    setReviewing(true);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const entity = buildEntity();
      if (kind === "Doc") entity.spec.draft = pendingDraft;
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
      addNotification({
        type: "pr_opened",
        title: `${kind} registered`,
        body: name,
      });
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
  const FORM_STEPS = [
    { num: 1 as const, label: "Details" },
    { num: 2 as const, label: "Review" },
  ];
  const currentStep = reviewing ? 2 : 1;

  return (
    <div className="space-y-6">
      <div>
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4">
          <Link href="/dashboard/catalog" className="hover:text-foreground">
            Catalog
          </Link>
          <span>/</span>
          <button
            type="button"
            onClick={() => { setReviewing(false); setKind(null); }}
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

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {FORM_STEPS.map(({ num, label }) => (
          <div key={num} className="flex items-center gap-2">
            {num > 1 && (
              <div className={cn("h-px w-8", currentStep >= num ? "bg-wxops-purple" : "bg-border")} />
            )}
            <div className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              currentStep === num
                ? "bg-wxops-purple/10 text-wxops-purple"
                : currentStep > num
                  ? "bg-muted text-foreground"
                  : "bg-muted/50 text-muted-foreground",
            )}>
              <span className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                currentStep === num
                  ? "bg-wxops-purple text-white"
                  : currentStep > num
                    ? "bg-foreground/20 text-foreground"
                    : "bg-border text-muted-foreground",
              )}>
                {num}
              </span>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Two-column: form left, live YAML right */}
      <div className="grid gap-6 lg:grid-cols-2 items-start">

      {/* ── Left: form or review summary ── */}
      <div className="rounded-xl border border-border p-6 space-y-5">

        {/* Review summary — shown on step 2 instead of the form */}
        {reviewing && (
          <div className="space-y-3">
            <p className="text-sm font-semibold">Ready to register?</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Review the YAML on the right. Click <strong>Confirm</strong> to commit it to the
              catalog{kind !== "Doc" ? " via a PR" : " directly"}.
            </p>
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1 text-xs font-mono">
              <div><span className="text-muted-foreground">kind:</span> {kind}</div>
              <div><span className="text-muted-foreground">name:</span> {name}</div>
              {title && <div><span className="text-muted-foreground">title:</span> {title}</div>}
              {owner && <div><span className="text-muted-foreground">owner:</span> {owner}</div>}
              {system && <div><span className="text-muted-foreground">system:</span> {system}</div>}
              {kind === "Doc" && <div><span className="text-muted-foreground">draft:</span> {pendingDraft ? "true" : "false"}</div>}
            </div>
          </div>
        )}

        {/* Form fields — hidden on step 2 */}
        {!reviewing && (<>
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
            {groups
              .filter((g) => !g.includes(":"))
              .map((g) => (
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
            <FormField label="System" hint="Optional — the system this document belongs to">
              <select
                value={system}
                onChange={(e) => setSystem(e.target.value)}
                className={inputClass}
              >
                <option value="">None</option>
                {systemNames.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
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

            {/* Related components/resources/APIs */}
            <FormField label="Related To" hint="Components, resources, or APIs this doc describes">
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
                  <option value="">Select a component, resource, or API...</option>
                  {relatedToOptions
                    .filter((r) => !relatedTo.includes(r))
                    .map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                </select>
                <p className="text-[10px] text-muted-foreground">
                  Link this document to the components, resources, and APIs it describes.
                </p>
              </div>
            </FormField>
          </>
        )}

        </>)}{/* end !reviewing fields */}
      </div>

      {/* ── Right: live YAML preview ── */}
      <div className="rounded-xl border border-border bg-muted/20 p-5 space-y-3 lg:sticky lg:top-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Eye className="h-4 w-4 text-wxops-purple" />
          {reviewing ? "Confirm YAML" : "Live Preview"}
          {kind === "Doc" && reviewing && (
            <span className={cn(
              "ml-auto text-xs rounded-full px-2 py-0.5 font-medium",
              pendingDraft
                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
            )}>
              {pendingDraft ? "Draft" : "Published"}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {reviewing
            ? "This exact YAML will be committed to the catalog."
            : "Updates as you fill in the form."}
        </p>
        {liveYAML ? (
          <pre className="overflow-auto rounded-md border bg-background p-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap max-h-[60vh]">
            {liveYAML}
          </pre>
        ) : (
          <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
            Fill in the form to see the entity YAML.
          </div>
        )}
      </div>

      </div>{/* end two-column grid */}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => reviewing ? setReviewing(false) : setKind(null)}
          className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50"
        >
          <ArrowLeft className="h-4 w-4" />
          {reviewing ? "Back to Edit" : "Back"}
        </button>

        {reviewing ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-1.5 rounded-lg bg-wxops-purple px-5 py-2 text-sm font-medium text-white hover:bg-wxops-purple/90 disabled:opacity-60"
          >
            {submitting ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Submitting...</>
            ) : kind === "Doc" ? (
              pendingDraft ? "Save as Draft" : "Publish"
            ) : (
              `Confirm & Register`
            )}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            {kind === "Doc" && (
              <button
                type="button"
                onClick={() => handleReview(true)}
                disabled={!name.trim()}
                className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50 disabled:opacity-60"
              >
                <EyeOff className="h-4 w-4" />
                Save as Draft
              </button>
            )}
            <button
              type="button"
              onClick={() => handleReview(false)}
              disabled={!name.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-wxops-purple px-5 py-2 text-sm font-medium text-white hover:bg-wxops-purple/90 disabled:opacity-60"
            >
              <Eye className="h-4 w-4" />
              {kind === "Doc" ? "Review & Publish" : `Review ${kindMeta.label}`}
            </button>
          </div>
        )}
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
