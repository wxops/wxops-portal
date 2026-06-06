# WxOps Portal — Implementation Plan

This document tracks the phased implementation plan for the portal. It sits alongside `CHANGELOG.md` (what shipped) and `README.md` (what the portal does). Use it to understand what is coming, why, and in what order.

---

**Table of Contents**
- [WxOps Portal — Implementation Plan](#wxops-portal--implementation-plan)
  - [Phase Overview](#phase-overview)
  - [Delivery Tracks](#delivery-tracks)
  - [Phase 1 — Identity \& Multi-Cluster Access `done`](#phase-1--identity--multi-cluster-access-done)
  - [Phase 2.1 — Service Catalog Foundation `done`](#phase-21--service-catalog-foundation-done)
  - [Phase 3 — Project Scaffold `next` · target v0.2.x](#phase-3--project-scaffold-next--target-v02x)
    - [3.1 — Core ProjectClaim with resource selection](#31--core-projectclaim-with-resource-selection)
    - [3.2 — Project search and import (cross-cluster migration)](#32--project-search-and-import-cross-cluster-migration)
    - [3.3 — DevSpace Tunneling integration](#33--devspace-tunneling-integration)
  - [Phase 4 — CLI `next` · target v0.3.x](#phase-4--cli-next--target-v03x)
    - [Core commands](#core-commands)
    - [Distribution and auth](#distribution-and-auth)
    - [Files to create](#files-to-create)
  - [Phase 2.2 — Catalog Usability `planned` · target v0.4.x](#phase-22--catalog-usability-planned--target-v04x)
    - [2.2.1 — Search and multi-filter](#221--search-and-multi-filter)
    - [2.2.2 — Team ownership view](#222--team-ownership-view)
    - [2.2.3 — Catalog completeness score](#223--catalog-completeness-score)
  - [Phase 2.3 — Operational Depth `planned` · target v0.4.x](#phase-23--operational-depth-planned--target-v04x)
    - [2.3.1 — Kubernetes workload linkage](#231--kubernetes-workload-linkage)
    - [2.3.2 — Component-level dependency graph](#232--component-level-dependency-graph)
    - [2.3.3 — Health status roll-up](#233--health-status-roll-up)
  - [Phase 2.4 — Catalog Write Path `planned` · target v0.5.x](#phase-24--catalog-write-path-planned--target-v05x)
    - [2.4.1 — Service onboarding wizard](#241--service-onboarding-wizard)
    - [2.4.2 — Entity editing](#242--entity-editing)
  - [Phase 5 — Platform Intelligence `future` · target v1.x](#phase-5--platform-intelligence-future--target-v1x)
  - [Backlog — Version \& Package Intelligence](#backlog--version--package-intelligence)
    - [B.1 — Deployed version tracking per environment](#b1--deployed-version-tracking-per-environment)
    - [B.2 — SBOM linking and display](#b2--sbom-linking-and-display)
    - [B.3 — Cross-service dependency impact query](#b3--cross-service-dependency-impact-query)
    - [B.4 — Shared internal library tracking](#b4--shared-internal-library-tracking)
  - [Decisions and constraints](#decisions-and-constraints)

---

## Phase Overview

| Phase | Target version | Theme | Status |
|---|---|---|---|
| 1 — Identity & Multi-Cluster Access | v0.1.0 | One login for all spoke clusters | `done` |
| 2.1 — Service Catalog Foundation | v0.1.x | Entity browser, relationship graph, API docs, dark mode | `done` |
| 3 — Project Scaffold | v0.2.x | Core ProjectClaim, resource selection, project import/migration | `next` |
| 4 — CLI | v0.3.x | `wxops` binary — scaffold, tunnel, catalog, CI/CD usable | `next` |
| 2.2 — Catalog Usability | v0.4.x | Search, team ownership, completeness scoring | `planned` |
| 2.3 — Operational Depth | v0.4.x | Live K8s linkage, component graph, health roll-up | `planned` |
| 2.4 — Catalog Write Path | v0.5.x | Register and edit services via portal | `planned` |
| 5 — Platform Intelligence | v1.x | Cost attribution, compliance status, aggregate health | `future` |

> **Backlog** (post-MVP, no version target yet): Phase 2.5 — Version & Package Intelligence (SBOM, dependency drift, CVE impact query). See the Backlog section at the bottom.

---

## Delivery Tracks

The plan splits into two parallel tracks after Phase 2.1. The **MVP track** ships the core platform workflow (scaffold a project, operate it from the CLI) as fast as possible. The **catalog track** deepens the service catalog for teams with growing inventories. Both tracks converge at Phase 5.

```
done  ─── Phase 1 ─── Phase 2.1
                          │
           ┌──────────────┴────────────────────┐
     MVP track                          Catalog track
   (ship first)                       (after MVP ships)
  Phase 3 (Scaffold)                Phase 2.2 (Usability)
  Phase 4 (CLI)                     Phase 2.3 (Ops depth)
       │                            Phase 2.4 (Write path)
       └──────────────┬─────────────────────────┘
                 Phase 5 (Platform Intelligence)
```

---

## Phase 1 — Identity & Multi-Cluster Access `done`

**Goal:** A single OIDC login via Pinniped Supervisor that grants access to every registered spoke cluster. No per-cluster credential prompts, no kubeconfig duplication.

**Delivered:**
- PKCE/OIDC flow with Pinniped Supervisor as the federation point
- RFC 8693 token exchange for spoke cluster tokens
- Concierge mTLS credential issuance per cluster
- Cluster registry backed by Kubernetes Secrets (hub cluster) or a static JSON file
- Session management with AES-256-GCM encrypted cookies
- Kubernetes resource views: clusters, namespaces, pods, deployments, identity, kubeconfig download

---

## Phase 2.1 — Service Catalog Foundation `done`

**Goal:** A read-only service catalog backed by Gitea (or a local directory) that surfaces every platform entity with full relationship context and embedded API documentation.

**Delivered:**
- Backstage-compatible YAML entity schema (`backstage.io/v1alpha1`)
- Entity kinds: System, Component, API, Resource, Group, User, Doc
- Catalog list page with kind tabs, lifecycle badges, tag chips
- Entity detail page: metadata, tags, annotations, relationships, links
- Per-system dependency graph (Mermaid v11, dark canvas, zoom-to-cursor)
- OpenAPI spec rendering (swagger-ui-dist, dark mode overrides)
- Markdown doc rendering for Doc entities
- Spec resolution priority: inline definition → relative path → Gitea auth → plain HTTP
- `SWAGGER_ENABLED` flag to gate the live swagger endpoint
- Gitea-backed catalog with 5-minute TTL cache; local-dir fallback for dev
- `CATALOG_LOCAL_DIR` + example catalog for zero-dependency local testing

---

## Phase 3 — Project Scaffold `next` · target v0.2.x

**Goal:** A developer opens the portal, fills a form, and gets a fully provisioned project — namespace, RBAC, Vault mount, database, repository, and an ArgoCD application — without writing a single YAML file or filing a ticket. The portal also lets teams search existing projects across clusters and import them, closing the migration loop.

This phase establishes the GitOps write path that Phase 2.4 (catalog write) will later reuse.

### 3.1 — Core ProjectClaim with resource selection

**Problem:** Provisioning a new project today means writing a dozen YAML files, knowing the Crossplane CRD schema, and waiting for ArgoCD to sync. There is no self-service path.

**How it works:**
1. Developer fills the scaffold form: project name, owning team, target cluster, desired resources
2. Portal backend validates the claim and commits a `ProjectClaim` CR to `gitops-infra` via Gitea
3. ArgoCD detects the new file, Crossplane/Helm reconciles the declared resources
4. Portal polls the `ProjectClaim` status and shows a live provisioning progress view

**ProjectClaim CR schema:**
```yaml
apiVersion: platform.wxops.io/v1alpha1
kind: ProjectClaim
metadata:
  name: payments-service
  namespace: wxops-system
spec:
  team: payments-team
  cluster: prod-cluster          # must match a registered cluster ID
  resources:
    core:                        # always provisioned — namespace + RBAC
      namespace: payments
      serviceAccount: payments-sa
    vault:
      enabled: true
      mountPath: payments/secrets
    database:
      enabled: true
      engine: postgres           # postgres | mysql
      size: small                # small | medium | large (maps to Crossplane composite size)
    cache:
      enabled: false
    queue:
      enabled: false
      engine: nats               # nats | kafka
    gitRepository:
      enabled: true
      name: payments-service
      visibility: private
```

**Core resources** (always provisioned, no checkbox needed):
- Namespace with standard labels (`team`, `project`, `managed-by: wxops`)
- ServiceAccount + RoleBinding scoped to the namespace

**Optional resource modules** (each is a Crossplane Composite or Helm release):
- `vault` — Vault namespace mount + read/write policy + Kubernetes auth role
- `database` — Crossplane `PostgreSQLInstance` or `MySQLInstance`
- `cache` — Helm Redis StatefulSet in the project namespace
- `queue` — NATS JetStream stream or Kafka topic via Crossplane
- `gitRepository` — Gitea repo via the Gitea API (reuses the existing `gitea.Client`)

**Files to create/change:**
- `backend/internal/scaffold/claim.go` — `ProjectClaim` struct, YAML serialiser, validation
- `backend/internal/handlers/scaffold.go` — `CreateProject`, `GetProjectStatus` handlers
- `backend/internal/server/server.go` — register `POST /api/v1/scaffold/projects`, `GET /api/v1/scaffold/projects/:name/status`
- `backend/internal/gitea/client.go` — add `CreateFile`, `CreatePullRequest` methods (shared with Phase 2.4)
- `frontend/src/app/dashboard/scaffold/new/page.tsx` — multi-step form: name/team → cluster → resource modules → preview → submit
- `frontend/src/components/scaffold/resource-selector.tsx` — card-based resource checkboxes with descriptions and size options
- `frontend/src/components/scaffold/claim-preview.tsx` — live YAML preview that updates as the form changes
- `frontend/src/components/scaffold/provision-progress.tsx` — polling status view: shows each resource module as pending / provisioning / ready / failed
- `frontend/src/app/dashboard/scaffold/page.tsx` — project list: all claims the session user's team owns, with status
- `docs/scaffold.md` — new doc: ProjectClaim schema, Crossplane composites required, Gitea token scope

**Dependencies:**
- Crossplane installed in the hub cluster with composites for each resource type
- `GITEA_TOKEN` must have `repository:write` scope (currently only read scope is required)
- ArgoCD watching `gitops-infra/projects/` for new `ProjectClaim` files

### 3.2 — Project search and import (cross-cluster migration)

**Problem:** Teams often have services already running in a cluster that were provisioned manually or by a different tool. There is no way to represent these in the portal, migrate them to a new cluster, or bring them under GitOps control without starting from scratch.

**How it works:**
1. Developer opens "Import existing project" in the scaffold section
2. They select a cluster and optionally filter by namespace name or label
3. The portal queries the cluster for namespaces that look like project namespaces (labelled or named by convention)
4. The developer selects a namespace; the portal inspects its resources (deployments, services, PVCs, secrets, ConfigMaps, Vault roles) and builds a draft `ProjectClaim` that describes what it found
5. The developer reviews and edits the draft, then submits it — this commits the claim to `gitops-infra` and registers the project under portal management
6. To **migrate** a project to a second cluster: after import, the developer changes `spec.cluster` to the target cluster and submits a new claim; the same provisioning flow from 3.1 runs against the new cluster

**Discovery heuristics (what the portal looks for):**
- Namespace labels: `team`, `app.kubernetes.io/managed-by`, `project`
- Deployments → infer `spec.type: service` entries
- PersistentVolumeClaims with storage class names → infer `database` or `cache` resource modules
- Vault `ServiceAccount` annotations (`vault.hashicorp.com/role`) → infer `vault` module
- Gitea API: check if a repo with the same name exists under the team org → infer `gitRepository`

**Scope:**
- New backend endpoint: `GET /api/v1/scaffold/discover?cluster=<id>&namespace=<name>` — returns a draft `ProjectClaim` JSON inferred from live cluster state
- The draft is editable in the same form as 3.1 before submission
- Imported projects get a catalog `Component` stub auto-generated alongside the claim (same PR)

**Files to create/change:**
- `backend/internal/scaffold/discover.go` — resource discovery logic: inspect namespace via K8s API, build draft claim
- `backend/internal/handlers/scaffold.go` — add `DiscoverProject` handler
- `backend/internal/server/server.go` — register `GET /api/v1/scaffold/discover`
- `frontend/src/app/dashboard/scaffold/import/page.tsx` — import flow: cluster picker → namespace search → draft review → submit

### 3.3 — DevSpace Tunneling integration

**Problem:** Local development against a real cluster requires manually juggling `kubectl port-forward` across multiple services, using the right kubeconfig context, and repeating this every time a pod restarts. DevSpace solves this natively but requires knowing the exact cluster context and namespace — information the portal already has.

**What DevSpace Tunneling provides:**
- `devspace tunnel` opens a reverse proxy from the local machine into a pod in the cluster
- Combined with DevSpace's hot-reload (`devspace dev`), it lets a developer run one service locally while all its dependencies (database, cache, queue, other services) are the real cluster equivalents — without a full local stack

**Integration scope:**

*Portal (UI):*
- Each project in the scaffold section has a "Dev tunnel" button
- Clicking it generates a `devspace.yaml` pre-configured for that project (cluster context, namespace, service ports) and shows a copy-paste quickstart for `devspace dev` or `devspace tunnel`
- New backend endpoint: `GET /api/v1/scaffold/projects/:name/devspace-config` — returns a ready-to-use `devspace.yaml` populated from the project's claim and the cluster's kubeconfig endpoint

*CLI (Phase 4):*
- `wxops tunnel <project-name>` — the CLI fetches the devspace config from the portal and pipes it directly to `devspace tunnel`, handling cluster auth transparently
- The CLI already handles token exchange (Phase 1); it injects the short-lived credential into the devspace invocation so the developer never touches kubeconfig manually

**DevSpace config template the portal generates:**
```yaml
version: v2beta1
name: <project-name>

pipelines:
  dev:
    run: |-
      create_deployments --all
      start_dev app

dev:
  app:
    imageSelector: <registry>/<project-name>
    devImage: ghcr.io/loft-sh/devspace-containers/go:1.21
    sync:
      - path: ./
    terminal:
      command: ./devspace_start.sh

# Populated by wxops portal — do not edit cluster/namespace manually
vars:
  CLUSTER_ID: <cluster-id>
  NAMESPACE: <namespace>
  KUBECONFIG_ENDPOINT: <portal-base-url>/api/v1/clusters/<cluster-id>/kubeconfig
```

**Files to create/change:**
- `backend/internal/scaffold/devspace.go` — `devspace.yaml` template builder
- `backend/internal/handlers/scaffold.go` — add `GetDevspaceConfig` handler
- `backend/internal/server/server.go` — register `GET /api/v1/scaffold/projects/:name/devspace-config`
- `frontend/src/components/scaffold/devspace-quickstart.tsx` — modal with generated config + copy button + DevSpace install link
- `docs/scaffold.md` — document the tunnel workflow and DevSpace prerequisite

---

## Phase 4 — CLI `next` · target v0.3.x

**Goal:** A `wxops` binary that mirrors the portal's capabilities for terminal users and CI/CD pipelines. Phase 4 ships alongside or immediately after Phase 3 — the scaffold and tunnel commands are the primary reason the CLI exists.

### Core commands

```
wxops login                              # PKCE flow → ~/.wxops/credentials
wxops logout

wxops clusters list                      # list registered clusters
wxops clusters use <id>                  # set active cluster (writes ~/.wxops/config)
wxops clusters kubeconfig <id>           # print kubeconfig to stdout for piping

wxops catalog list [--kind=] [--owner=]  # list catalog entities
wxops catalog get <kind> <name>          # print entity detail as JSON or YAML

wxops scaffold new                       # interactive project creation (mirrors portal form)
wxops scaffold import <cluster> <ns>     # import existing namespace → draft ProjectClaim
wxops scaffold list                      # list all ProjectClaims the user's team owns
wxops scaffold status <project>          # poll and print provisioning status

wxops tunnel <project>                   # fetch devspace config + invoke devspace tunnel
wxops tunnel config <project>            # print devspace.yaml to stdout (no devspace required)
```

### Distribution and auth

- Single statically-linked binary; no runtime dependencies
- Config stored at `~/.wxops/` (credentials, active cluster, portal URL)
- `wxops login` opens the browser for the PKCE flow, exchanges the code, and stores the encrypted session token
- CI usage: `WXOPS_TOKEN=<token> wxops scaffold status <project>` — token overrides interactive login
- Releases published to Gitea as binary attachments; install script: `curl -sSL <portal>/install.sh | sh`

### Files to create

- `cli/` — new top-level directory, Go module `github.com/wxops/wxops-portal-v2/cli`
- `cli/cmd/root.go`, `cli/cmd/login.go`, `cli/cmd/clusters.go`, `cli/cmd/catalog.go`, `cli/cmd/scaffold.go`, `cli/cmd/tunnel.go`
- `cli/internal/client/` — HTTP client that reuses the same `/api/v1/*` endpoints as the portal frontend
- `cli/internal/config/` — `~/.wxops/` config file reader/writer
- `.gitea/workflows/release-cli.yaml` — build matrix (linux/amd64, linux/arm64, darwin/amd64, darwin/arm64, windows/amd64) and attach binaries to the Gitea release
- `docs/cli.md` — command reference, install instructions, CI/CD usage examples

---

## Phase 2.2 — Catalog Usability `planned` · target v0.4.x

**Goal:** Make the catalog useful beyond ~20 entities. Right now the list is a flat table with no way to search, filter, or understand who owns what.

### 2.2.1 — Search and multi-filter

**Problem:** With 50+ entities the list is unusable without search.

**Scope:**
- Full-text search across entity name, title, description, and tags — client-side filter over the already-fetched JSON (no new backend endpoint needed at this scale)
- Filter chips: kind, lifecycle, owner (group), tags — multi-select, URL-preserved so links are shareable
- Empty state with clear messaging when filters produce zero results

**Files to change:**
- `frontend/src/app/dashboard/catalog/page.tsx` — add filter state, URL sync via `useSearchParams`
- `frontend/src/components/catalog/entity-filters.tsx` — new filter bar component
- `backend/internal/handlers/catalog.go` — optionally extend `ListEntities` to accept `?owner=` and `?tag=` query params for server-side pre-filtering (reduces payload on large catalogs)

### 2.2.2 — Team ownership view

**Problem:** Group entity detail pages exist but don't answer the primary question: "what does this team own and consume?"

**Scope:**
- Group detail page gets an "Owns" section: all entities where `spec.owner` matches the group name
- "Depends on" cross-reference: all APIs this group's components consume
- Pure frontend join — no new backend endpoint needed; entities are already in cache

**Files to change:**
- `frontend/src/app/dashboard/catalog/[kind]/[name]/page.tsx` — add ownership section for `kind === "Group"`
- Pass all entities as a prop and filter client-side; or add `GET /api/v1/catalog/entities?owner=group:X` to the backend

### 2.2.3 — Catalog completeness score

**Problem:** There is no signal about catalog quality. Teams don't know if their entries are missing descriptions, owners, or links.

**Scope:**
- Per-entity completeness score (0–100) based on weighted checklist:
  - Has `metadata.description` (+20)
  - Has `spec.owner` (+20)
  - Has at least one `metadata.links` entry (+20)
  - Has `metadata.tags` (+15)
  - Has `spec.lifecycle` set (+15)
  - For API kind: has openapi spec link or inline definition (+10)
- Score rendered as a coloured ring or progress bar on the entity list row and detail page header
- No backend change needed — score is computed client-side from entity JSON

**Files to change:**
- `frontend/src/lib/catalog-score.ts` — new scoring function
- `frontend/src/app/dashboard/catalog/page.tsx` — add score column to list
- `frontend/src/app/dashboard/catalog/[kind]/[name]/page.tsx` — add score badge to header

---

## Phase 2.3 — Operational Depth `planned` · target v0.4.x

**Goal:** Bridge the gap between catalog metadata and live platform state. Turn the catalog from a documentation tool into an operational tool.

### 2.3.1 — Kubernetes workload linkage

**Scope:**
- Add `annotations: kubernetes.io/cluster: <cluster-id>` and `kubernetes.io/deployment: <name>` to the Component entity schema
- On the component detail page, fetch live workload data from the existing cluster API: pod count, current image tag, last deployment timestamp, ready/degraded/unknown health
- No new backend endpoints needed — `GET /api/v1/clusters/:id/deployments` already exists

**Files to change:**
- `frontend/src/app/dashboard/catalog/[kind]/[name]/page.tsx` — add `WorkloadStatus` section for Component kind
- `frontend/src/components/catalog/workload-status.tsx` — new component
- `docs/service-catalog.md` — document the two new annotation keys

### 2.3.2 — Component-level dependency graph

**Scope:**
- On the Component detail page, render a focused Mermaid graph: the component in the centre, its `dependsOn` resources and `providesApis` APIs, and any consumers discovered via reverse `consumesApis` scan across all entities
- Reuse `MermaidDiagram` and `GraphPanel`; only a new diagram-builder function is needed

**Files to change:**
- `frontend/src/app/dashboard/catalog/[kind]/[name]/page.tsx` — add `ComponentGraph` section
- `frontend/src/components/catalog/component-graph.tsx` — new focused diagram builder

### 2.3.3 — Health status roll-up

**Scope:**
- Annotation: `wxops/health-probe: https://my-service/healthz`
- New backend endpoint: `GET /api/v1/catalog/entities/:kind/:name/health` — backend fetches the probe URL and returns `{status: "healthy"|"degraded"|"unknown", latency_ms: int}`; 2-second timeout, not cached

**Files to change:**
- `backend/internal/handlers/catalog.go` — add `HealthProbe` handler
- `backend/internal/server/server.go` — register the new route
- `frontend/src/components/catalog/health-badge.tsx` — live polling badge
- `docs/service-catalog.md` — document `wxops/health-probe`

---

## Phase 2.4 — Catalog Write Path `planned` · target v0.5.x

**Goal:** Teams can register and update their services through the portal without writing YAML manually. This reuses the Gitea write client built in Phase 3.1.

### 2.4.1 — Service onboarding wizard

**Scope:**
- Multi-step form: entity kind → name/description/tags → owner/lifecycle → links/APIs
- Preview: render the YAML the form would produce before committing
- On submit: open a Gitea PR with the new entity YAML (reuses `gitea.CreateFile` / `gitea.CreatePullRequest` from Phase 3.1)

**Files to change:**
- `backend/internal/handlers/catalog.go` — add `CreateEntity` handler
- `frontend/src/app/dashboard/catalog/new/page.tsx` — new multi-step form page
- `frontend/src/components/catalog/entity-form.tsx` — form component

### 2.4.2 — Entity editing

**Scope:**
- Edit button on entity detail pages, gated to entities the session user owns (based on `spec.owner` matching their group membership from `/auth/me`)
- Same form as onboarding, pre-populated with existing values; produces a Gitea PR with the diff

---

## Phase 5 — Platform Intelligence `future` · target v1.x

**Goal:** Aggregate signals from across the platform and surface them alongside catalog entities.

- Cost attribution per service: query Prometheus node-exporter / cAdvisor labels that match catalog entity names
- Compliance status: Vault policy coverage, RBAC audit, pod security standards per namespace
- Aggregate health roll-up: platform-wide dashboard rolling up the health probes from Phase 2.3.3
- ArgoCD sync status alongside catalog entries

---

## Backlog — Version & Package Intelligence

No version target. Revisit after Phase 4 ships.

**Why backlogged:** High value for large platform teams but requires SBOM generation to be wired into every team's CI pipeline before the portal features are useful. The prerequisite work (CI changes across all repos) is outside the portal itself. Revisit once the scaffold + CLI track gives teams a standard pipeline template that can include `syft` generation by default.

### B.1 — Deployed version tracking per environment

Add `spec.version` and `spec.environments` to the Component schema. Compare declared version against the live K8s image tag (available after Phase 2.3.1 ships). Surface version drift with a warning badge.

### B.2 — SBOM linking and display

Annotation `wxops/sbom-url` pointing to a CycloneDX or SPDX JSON file in the catalog repo (generated by `syft` in CI). Backend resolves and serves it; frontend renders a searchable dependency table.

### B.3 — Cross-service dependency impact query

`GET /api/v1/catalog/packages?name=X&version=<range>` scans all cached SBOMs and returns affected entities. Portal UI at `/dashboard/catalog/packages` — answers "which services ship a vulnerable version of library X?" in seconds.

### B.4 — Shared internal library tracking

Model internal SDKs as `Component` entities with `spec.type: library`. Show reverse-lookup consumers and their pinned versions on the library entity page.

---

## Decisions and constraints

| Decision | Rationale |
|---|---|
| Scaffold before catalog write path | Phase 3 establishes the Gitea write client (`CreateFile`, `CreatePullRequest`); Phase 2.4 reuses it — no duplication |
| CLI ships with scaffold, not before | The CLI's primary value is `wxops scaffold` and `wxops tunnel`; shipping without those commands makes it a kubeconfig wrapper that duplicates `kubectl` |
| ProjectClaim committed to Gitea, not applied directly | ArgoCD as the reconciler means every project has a full audit trail and can be rolled back with `git revert` |
| Import/discovery infers, never assumes | The discovery heuristics in Phase 3.2 build a draft that the developer must review — the portal never auto-submits a claim inferred from live state |
| DevSpace as external dependency | The portal generates the config and the CLI invokes DevSpace; DevSpace itself is not vendored. This keeps the tunnel feature lightweight and benefits from DevSpace's own maintenance |
| Catalog is read-only until Phase 2.4 | GitOps discipline: catalog source of truth lives in Gitea, not the portal DB |
| No Backstage runtime | We borrow the YAML schema for ecosystem compatibility, not the runtime; this keeps the stack to Go + Next.js |
| Client-side filtering first | The catalog will rarely exceed a few hundred entities per deployment; client-side filtering avoids a new query layer and keeps the backend stateless |
| Health probes via backend | Direct browser → service probing hits CORS and network policy boundaries; backend proxy is cleaner and auditable |
| SBOM work deferred to backlog | SBOM generation needs to be standardised in CI across all team repos first; building the portal reader before that is premature |
| CycloneDX preferred over SPDX | Better tooling support across Go (`cyclonedx-gomod`), Node (`cdxgen`), and container images (`syft`); SPDX accepted but secondary |
| Library-as-Component, not a separate kind | Reusing the Component kind with `spec.type: library` avoids schema drift and lets libraries appear in the same dependency graph as services |
