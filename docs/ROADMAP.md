# WxOps Portal — Roadmap

> Living document. Updated as features ship.
> Last updated: 2026-06-29 (corrected version attribution).

---

## Delivered

### v0.1.0 — Identity & Multi-Cluster Access

Single OIDC login via Pinniped Supervisor for all spoke clusters.

- PKCE/OIDC flow with Pinniped Supervisor as the federation point
- RFC 8693 token exchange for spoke cluster tokens
- Concierge mTLS credential issuance per cluster
- Cluster registry backed by Kubernetes Secrets (hub) or static JSON
- Session management with AES-256-GCM encrypted cookies
- Cluster views: namespaces, pods, deployments, identity, kubeconfig download
- Service catalog phase 1 — entity model, Gitea-backed with 5-min TTL cache
- Container build pipeline (multi-stage Docker)

### v0.1.1 — CI/CD Pipeline Setup

- Gitea Actions CI workflow (build, lint, test, container push)
- Registry cache for container builds
- Release workflow with git-cliff changelog generation
- Push event filtering (tag-based releases only)

### v0.1.2 — Operations Readiness

- Health check endpoints for liveness/readiness probes
- Documentation refinement and release workflow fixes

### v0.1.3 — Service Catalog

Full catalog UI with entity relationships and visualization.

- 7 entity kinds: System, Component, API, Resource, Group, User, Doc
- Entity detail pages with metadata, relationships, annotations
- System overview pages with component grouping
- Lifecycle filter tabs (production, development, experimental, deprecated)
- Per-system dependency graph (Mermaid v11, dark canvas, zoom-to-cursor)
- OpenAPI spec rendering (swagger-ui-dist, dark mode)
- Doc viewer with type badges (RFC, ADR, Runbook)
- Mermaid diagram rendering in documentation
- Spec resolution: inline definition → relative path → Gitea auth → plain HTTP
- `CATALOG_LOCAL_DIR` + example catalog for zero-dependency local testing

### v0.1.4 — Catalog UI & Visualization

UI refinements to the service catalog.

- Mermaid diagram improvements (zoom-to-cursor, dark canvas, better layout)
- Graph panel polish (relationship edges, node labels, overflow handling)
- Entity card layout refinements
- Sidebar and navigation cleanup

### v0.2.0 — Golden-Path Scaffolding & Developer Experience

Full golden-path scaffolding pipeline, CI/CD and package visibility, activity
tracking, lifecycle webhook, cluster namespace scoping, and edit-config UI.

**Golden-path scaffolding:**
- Project creation wizard (template → config → features → create)
- Git-flow branching: `develop` (default) → `staging` → `main`
- Template system with `template.yaml` metadata/defaults/recommends
- Runtime selector (language, version, package manager per template)
- XTenantApp + XTenantDatabase manifest generation
- ExternalSecret generation (vault env + database credentials)
- Catalog entity auto-generation (Component, Resource, API, System)
- Vault secret write (create/update only — no read, no delete)
- Import existing Gitea repos into catalog
- Scaffold progress screen with per-step timing
- Template caching (3-layer: backend in-memory, BFF revalidate, sessionStorage)
- Branch protection: develop (direct push), staging/main (PR required), main bot whitelist
- CI bot identity (`GITEA_BOT_USERNAME` / `GITEA_BOT_EMAIL`) injected into CI files
- Org-only team filter — sub-teams excluded from scaffold wizard dropdowns
- Dev bypass auth (`DEV_BYPASS_AUTH=true`) — skip OIDC for local development

**Config management via PR:**
- Edit-config wizard — update XTenantApp platform features through a diff-review UI
- Matches scaffold wizard layout (`rounded-xl border` cards, `lg:grid-cols-2`, pill step badges)
- `templateId` preserved on update — backend rebuilds the full manifest without losing it
- Gitops-infra PR URLs hidden from all API responses

**Kustomize / ArgoCD Image Updater integration:**
- `image` field changed to plain `"repo:tag"` string — matches XTenantApp CRD schema
- Kustomize overlay structure: `base/` + `overlays/dev/` with `image-transformer.yaml`
  so Image Updater can patch `spec/parameters/image` on the XTenantApp CRD
- `images:` block removed from generated `kustomization.yaml` — Image Updater owns
  that section; having a static value caused a reset-to-`latest` fight on every reconcile
- ArgoCD Image Updater CR at `tenants/{team}/{appName}.yaml` with `metadata.name: {appName}`
- Overlay patch strips `appName`, `namespace`, `image` (inherit from base via `omitempty`)

**Observability:**
- CI/CD status card (Gitea Actions workflow runs, 30s auto-refresh)
- Releases card (git releases + container images from package registry)
- Packages card (dependency tracking: go.mod, package.json, requirements.txt, pyproject.toml)
- Entity-to-repo resolver via `gitea/source-location` annotation

**Activity feed:**
- Two-tier loading (5 recent items fast, expand to full paginated view)
- Filtered by `portal-managed` Gitea label — only portal-created PRs
- Role-scoped: tenant teams see only their own PRs

**Lifecycle webhook:**
- CI workflow lives in `gitops-infra` repo, not in the scaffolded project
- Fires on merge to `tenants-apps/**/overlays/dev/kustomization.yaml` → promotes lifecycle to `development`
- `PORTAL_EXTERNAL_URL` removed — CI uses `PORTAL_URL` from Gitea repo secrets
- Team managers (`{team}:Managers`) can promote lifecycle alongside `platform-team`

**Cluster views:**
- Namespace listing derived from Pinniped group membership — K8s list-namespaces is
  all-or-nothing; Gitea OIDC groups (`orgName:teamName`) map to `tenant-{orgName}`
- Platform-team users fall through to K8s API to see all namespaces
- Identity card reload button — re-fetches WhoAmI and refreshes pods/deployments
  without a full browser reload

**Performance:**
- Progressive page loading (Suspense streaming on entity detail)
- Documents section streams independently via async server component
- Entity/catalog pagination (server-side page/limit)

---

## Pending

| Task | Priority | Description |
|------|----------|-------------|
| E2E scaffold test | High | Full scaffold → CI → deploy cycle with real Gitea |
| Template quality | High | One solid Go template with working CI, health checks, monitoring |
| XTenantApp Composition | High | Crossplane Composition that reliably provisions end-to-end |
| Import wizard pagination | Low | "Load More" for repo listing |

---

## Next — v0.3.0: Platform Visibility

Make the platform observable. Show what's deployed where.

| Feature | Description | Effort |
|---------|-------------|--------|
| Git-based version comparison | Compare latest tags across develop/staging/main per entity | Small |
| Entity environment row | Show version per branch on entity detail page | Small |
| ArgoCD ApplicationSet update | Point at `overlays/*` directories | Config |
| Catalog search & multi-filter | Full-text search, filter by kind/lifecycle/owner/tags | Medium |
| Team ownership view | Group detail page: what does this team own and consume? | Small |
| Cluster namespace aggregation | "All my namespaces" selector merging resources from multiple tenant namespaces | Small |

---

## Planned — v0.4.0: Environment Promotion

Per-environment visibility and controlled promotion.

| Feature | Description |
|---------|-------------|
| ArgoCD status via Pinniped | Read Application CRs using user's K8s credentials (RBAC-scoped) |
| Crossplane XR status | Read XTenantApp/XTenantDatabase conditions via same auth |
| Environment panel | Side-by-side env status (sync, health, image, last deploy) |
| Lifecycle-driven promotion | Changing lifecycle to staging/prod creates overlay + PR |
| Role-gated promotion | Only platform-team/PM can promote to staging/production |
| K8s workload linkage | Live pod count, image tag, health from cluster API |
| Catalog completeness score | Per-entity quality score (description, owner, links, tags) |

### Lifecycle promotion model

```
experimental ──(PR merge)──► development ──(platform-team/managers)──► staging ──(PM)──► production
```

See [cross-environment-promotion.md](cross-environment-promotion.md) for full design.

---

## Planned — v0.5.0: CLI & DevSpace

Terminal-first developer experience and local development tunneling.

| Feature | Description |
|---------|-------------|
| `wxops` CLI binary | scaffold, catalog, tunnel, clusters commands |
| `wxops login` | PKCE flow → `~/.wxops/credentials` |
| `wxops scaffold new` | Interactive project creation (mirrors portal form) |
| `wxops tunnel <project>` | Fetch DevSpace config + invoke tunnel to cluster |
| `wxops catalog list/get` | Query catalog from terminal or CI/CD pipelines |
| CI token support | `WXOPS_TOKEN` env var for non-interactive usage |
| Cross-platform release | linux/amd64, linux/arm64, darwin/amd64, darwin/arm64, windows |

---

## Backlog — Enterprise & Intelligence

Not scheduled. Prioritized by real usage feedback.

| Feature | Description |
|---------|-------------|
| Promotion workflow UI | "Promote to staging" button with config diff and approval chain |
| Multi-cluster status | Per-cluster ArgoCD Application status via hub-spoke |
| Audit trail | SOC2-ready: who promoted what, when, with approval chain |
| Scorecard / maturity | Production readiness (monitoring, docs, tests, SLOs) |
| Cost tracking | Resource usage per environment from metrics API |
| Self-service actions | Restart, scale, rollback via portal (RBAC-controlled) |
| Custom environments | qa, perf, canary beyond dev/staging/prod |
| Database per environment | Separate XTenantDatabase CRs per env |
| SBOM linking | CycloneDX/SPDX from CI, searchable dependency table |
| Dependency impact query | "Which services ship a vulnerable version of library X?" |
| Health probe roll-up | Platform-wide dashboard from per-entity health checks |
| Template marketplace | Browse, preview, compare golden-path templates |
| Project import/migration | Discover existing namespaces, infer ProjectClaim, migrate cross-cluster |
| Compliance status | Vault policy coverage, RBAC audit, pod security per namespace |

---

## Architecture Decisions

Key decisions that shape all future work.

| Decision | Resolution | Rationale |
|----------|-----------|-----------|
| Scaffold default lifecycle | `experimental` | Service isn't deployed until gitops PR merges |
| experimental → development | Automatic on PR merge | Merge = deployed to dev = lifecycle is development |
| Promotion to staging/prod | Platform-team or team Managers only | Security gate, not developer self-service |
| Portal cluster access | User's Pinniped token | RBAC-scoped, zero additional credentials |
| Gitops PR URLs | Not exposed to developers | Devs don't have gitops-infra access |
| Activity filtering | Gitea label `portal-managed` | Only portal PRs, not all gitops-infra changes |
| DB secret naming | `{appName}-db-creds` default | Matches XTenantApp secretsFrom schema |
| Config per environment | Kustomize overlays | Portal reads plain YAML, no rendering engine |
| XTenantApp image field | Plain `"repo:tag"` string | CRD schema simplicity; Image Updater patches via `image-transformer.yaml` |
| Image Updater placement | `tenants/{team}/{appName}.yaml` | Separated from Kustomize manifests; clean ArgoCD control-plane view |
| Namespace from Pinniped groups | `orgName:teamName` → `tenant-{orgName}` | K8s list-namespaces is all-or-nothing; group-derived is RBAC-safe |
| Demotion behavior | Updates lifecycle only, keeps overlay | Removing overlay tears down environment |
| Portal writes to cluster | Never | Config changes go through Gitea PR only |
| Vault from portal | Create/update only | Prevent secret exposure and accidental deletion |
| No Backstage runtime | Borrow YAML schema, not the runtime | Keeps stack to Go + Next.js, no plugin ecosystem |
| Catalog source of truth | Git (Gitea), not portal DB | GitOps discipline, audit trail via git history |
| Client-side filtering first | Catalog rarely exceeds hundreds of entities | Avoids query layer, keeps backend stateless |
| ProjectClaim via Gitea PR | Not applied directly to cluster | ArgoCD reconciles, full audit trail, `git revert` for rollback |

---

## Reference Documents

| Document | Purpose |
|----------|---------|
| [README.md](../README.md) | System overview, quick start, doc index |
| [architecture.md](architecture.md) | Auth model, Pinniped, hub-spoke topology |
| [platform-engineering-rationale.md](platform-engineering-rationale.md) | Why Crossplane + Portal + Golden Path |
| [cross-environment-promotion.md](cross-environment-promotion.md) | Per-environment config, lifecycle promotion |
| [golden-path-git-flow.md](golden-path-git-flow.md) | Branch model, CI pipeline, image lifecycle |
| [lifecycle-webhook.md](lifecycle-webhook.md) | CI webhook for lifecycle promotion, trust chain |
| [documentation-strategy.md](documentation-strategy.md) | ADR, RFC, Runbook strategy |
| [service-catalog.md](service-catalog.md) | Entity kinds, relationships |
| [catalog-user-guide.md](catalog-user-guide.md) | YAML field reference, examples |
