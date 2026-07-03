"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { addNotification } from "@/lib/notifications";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  ExternalLink,
  Loader2,
  Server,
} from "lucide-react";
import type { Entity } from "@/lib/types";

interface ImportWizardProps {
  groups: string[];
  username: string;
}

interface Repo {
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
}

const COMPONENT_TYPES = [
  { value: "service", label: "Service", description: "Backend service or microservice" },
  { value: "website", label: "Website", description: "User-facing web application" },
  { value: "library", label: "Library", description: "Shared library or package" },
  { value: "pipeline", label: "Pipeline", description: "Data or CI/CD pipeline" },
];

const LIFECYCLES = [
  { value: "experimental", label: "Experimental" },
  { value: "development", label: "Development" },
  { value: "production", label: "Production" },
  { value: "deprecated", label: "Deprecated" },
];

export function ImportWizard({ groups, username }: ImportWizardProps) {
  void username;

  const [step, setStep] = useState<1 | 2>(1);
  const [team, setTeam] = useState("");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposPage, setReposPage] = useState(1);
  const [reposTotal, setReposTotal] = useState(0);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);

  // Step 2 fields
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [componentType, setComponentType] = useState("service");
  const [lifecycle, setLifecycle] = useState("experimental");
  const [system, setSystem] = useState("");
  const [tags, setTags] = useState("");
  const [allEntities, setAllEntities] = useState<Entity[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ kind: string; name: string } | null>(null);

  const systemNames = useMemo(
    () => allEntities.filter((e) => e.kind === "System").map((e) => e.metadata.name),
    [allEntities],
  );

  const fetchRepos = useCallback(async (owner: string) => {
    if (!owner) return;
    setLoadingRepos(true);
    setReposPage(1);
    try {
      const res = await fetch(`/api/scaffold/repos?owner=${encodeURIComponent(owner)}&page=1&limit=50`, {
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "Failed to load repos");
        setRepos([]);
        setReposTotal(0);
        return;
      }
      const data = await res.json();
      setRepos(data.repos ?? []);
      setReposTotal(data.total ?? 0);
    } catch {
      toast.error("Failed to load repos");
      setRepos([]);
      setReposTotal(0);
    } finally {
      setLoadingRepos(false);
    }
  }, []);

  const handleLoadMoreRepos = async () => {
    if (!team) return;
    const nextPage = reposPage + 1;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/scaffold/repos?owner=${encodeURIComponent(team)}&page=${nextPage}&limit=50`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      setRepos((prev) => [...prev, ...(data.repos ?? [])]);
      setReposPage(nextPage);
      setReposTotal(data.total ?? 0);
    } catch {
      toast.error("Failed to load more repos");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleTeamChange = (newTeam: string) => {
    setTeam(newTeam);
    setSelectedRepo(null);
    if (newTeam) fetchRepos(newTeam);
  };

  useEffect(() => {
    fetch("/api/catalog/entities", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        setAllEntities(data.entities ?? []);
      })
      .catch(() => {});
  }, []);

  const handleRepoSelect = (repo: Repo) => {
    setSelectedRepo(repo);
    setName(repo.name.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
    setTitle(repo.name);
    setStep(2);
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSubmitting(true);
    try {
      const entity: Entity = {
        apiVersion: "backstage.io/v1alpha1",
        kind: "Component",
        metadata: {
          name,
          title: title || undefined,
          description: description || undefined,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          annotations: {
            "gitea/source-location": `${team}/${selectedRepo!.name}`,
          },
          links: [
            {
              url: selectedRepo!.html_url,
              title: "Repository",
              type: "repository",
            },
          ],
        },
        spec: {
          type: componentType,
          lifecycle,
          owner: `group:${team}`,
          system: system || undefined,
        },
      };

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

      setSuccess({ kind: "Component", name });
      toast.success("Project imported to catalog");
      addNotification({
        type: "project_imported",
        title: "Project imported",
        body: name,
      });
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Success ──
  if (success) {
    return (
      <div className="mx-auto max-w-lg text-center space-y-6 py-12">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
          <CheckCircle className="h-8 w-8 text-green-500" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Project Imported</h2>
          <p className="mt-1 text-muted-foreground">
            <span className="font-mono text-foreground">{success.name}</span> has been added to the catalog.
          </p>
        </div>
        <div className="flex justify-center gap-3">
          <Link
            href={`/dashboard/catalog/Component/${success.name}`}
            className="rounded-lg bg-wxops-purple px-4 py-2 text-sm font-medium text-white hover:bg-wxops-purple/90"
          >
            View in Catalog
          </Link>
          <Link
            href="/dashboard/scaffold"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50"
          >
            Back to Scaffold
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4">
          <Link href="/dashboard/scaffold" className="hover:text-foreground">Scaffold</Link>
          <span>/</span>
          <span className="text-foreground font-medium">Import Existing</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight">Import Existing Project</h1>
        <p className="text-muted-foreground mt-1">
          Add an existing Gitea repository to the service catalog.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-3 text-sm">
        <span className={`flex items-center gap-1.5 font-medium ${step === 1 ? "text-wxops-purple" : "text-muted-foreground"}`}>
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${step === 1 ? "bg-wxops-purple text-white" : "bg-muted"}`}>1</span>
          Select Repo
        </span>
        <span className="h-px flex-1 bg-border" />
        <span className={`flex items-center gap-1.5 font-medium ${step === 2 ? "text-wxops-purple" : "text-muted-foreground"}`}>
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${step === 2 ? "bg-wxops-purple text-white" : "bg-muted"}`}>2</span>
          Catalog Metadata
        </span>
      </div>

      {/* ── Step 1: Team & Repo ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Team</label>
            <select
              value={team}
              onChange={(e) => handleTeamChange(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
            >
              {groups.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>

          {loadingRepos && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading repositories...
            </div>
          )}

          {!loadingRepos && repos.length === 0 && team && (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No repositories found for <span className="font-mono">{team}</span>.
              <p className="text-xs mt-1">Requires Gitea configuration (GITEA_URL).</p>
            </div>
          )}

          {!loadingRepos && repos.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Showing {repos.length} of {reposTotal} repositories
              </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {repos.map((repo) => (
                <button
                  key={repo.name}
                  type="button"
                  onClick={() => handleRepoSelect(repo)}
                  className="rounded-lg border border-border p-4 text-left transition-all hover:border-wxops-purple/40 hover:bg-wxops-purple/5"
                >
                  <div className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium text-sm truncate">{repo.name}</span>
                  </div>
                  {repo.full_name && (
                    <p className="text-xs text-muted-foreground font-mono mt-1 truncate">
                      {repo.full_name}
                    </p>
                  )}
                </button>
              ))}
            </div>
              {repos.length < reposTotal && (
                <button
                  type="button"
                  onClick={handleLoadMoreRepos}
                  disabled={loadingMore}
                  className="w-full rounded-lg border border-dashed border-border py-2.5 text-sm text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loadingMore ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Loading…</>
                  ) : (
                    `Load more (${reposTotal - repos.length} remaining)`
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Step 2: Metadata ── */}
      {step === 2 && selectedRepo && (
        <div className="space-y-5">
          <div className="rounded-lg border border-border bg-muted/30 p-3 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Server className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-mono text-sm truncate">{selectedRepo.full_name}</span>
            </div>
            <a
              href={selectedRepo.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline flex items-center gap-1 shrink-0"
            >
              <ExternalLink className="h-3 w-3" />
              Open
            </a>
          </div>

          <div className="rounded-xl border border-border p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Name <span className="text-destructive">*</span></label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-"))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wxops-purple/50 resize-none"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium mb-1.5">Type</label>
                <select
                  value={componentType}
                  onChange={(e) => setComponentType(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
                >
                  {COMPONENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {COMPONENT_TYPES.find((t) => t.value === componentType)?.description}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Lifecycle</label>
                <select
                  value={lifecycle}
                  onChange={(e) => setLifecycle(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
                >
                  {LIFECYCLES.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">
                System <span className="text-muted-foreground font-normal text-xs">(optional)</span>
              </label>
              <select
                value={system}
                onChange={(e) => setSystem(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
              >
                <option value="">None</option>
                {systemNames.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">
                Tags <span className="text-muted-foreground font-normal text-xs">(comma-separated)</span>
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="go, rest, payments"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !name.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-wxops-purple px-5 py-2 text-sm font-medium text-white hover:bg-wxops-purple/90 disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  Import to Catalog
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
