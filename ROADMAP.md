# WxOps Portal — Roadmap

> Living document. Updated as features ship.
> Last updated: 2026-08-20

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
- ArgoCD Image Updater CR at `tenants/{team}/{appName}-image-updater.yaml`
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

### v0.2.1 — Scaffolding & Catalog Fixes

- Image Updater CR naming fixed: `metadata.name` → `{team}-{appName}`, NamePatterns → `{team}-{appName}-{dev|staging|production}` (removed erroneous `tenants-apps-` prefix)
- Nginx routing corrected: `/api/v1/` → Go, `/api/` → Next.js BFF (longest-prefix match)
- Vault secret update allowed from catalog entity page

### v0.3.0 — Platform Visibility

Lifecycle promotion becomes fully UI-driven. Every service's path from `experimental` to
`production` is now tracked, role-gated, and auditable without touching the CLI.
Paired with a FlexSearch-powered command palette, the catalog scales from dozens to
hundreds of entities without losing navigability.

**★ Lifecycle promotion UI** *(headline feature)*

The promotion model replaces the removed ArgoCD webhook. Lifecycle is no longer an
editable field — it is a consequence of verified infrastructure state.

```
experimental ──(overlay PR)──► development ──(managers/platform-team)──► staging ──► production
     │                                                                                     │
     └──────────────────────── deprecated (removal PR, entity locked) ────────────────────┘
```

- `experimental` = catalog entity only; nothing deployed. Scaffold no longer generates `overlays/dev/`.
- Two-step flow per environment: (1) Create overlay PR → platform-team merges; (2) Confirm — portal verifies overlay is on `main` then updates lifecycle.
- Inline overlay config: replicas, ingress host, CPU/memory limits, Vault secrets
- Database overlay config: shared or dedicated CNPG tier, per-environment naming
  (`{appName}-{env}-db`), XTenantDatabase env mapping (`production` → `prod`),
  PgBouncer pooler enabled by default (matches CRD default), dedicated cluster
  always in `cnpg-system` namespace
- Vault secrets: required on create-overlay; optional (update specific keys only) on update-overlay
- Deprecation: writes `wxops.cloud/deprecated-*` annotations, opens `[Deprecate]` removal PR, locks entity
- Permission matrix: experimental→development = any team member; development→staging/production = platform-team or Managers
- `GET /api/v1/catalog/entities/:kind/:name/promostatus` — overlay existence + open PRs + tag status
- `POST /api/v1/catalog/entities/:kind/:name/promote` — actions: `create-overlay` | `update-overlay` | `confirm`
- `POST /api/v1/catalog/entities/:kind/:name/deprecate`
- `POST /api/v1/webhooks/promote/:kind/:name` removed

**★ Global command palette (Ctrl+K / Cmd+K)** *(headline feature)*

Find any entity without leaving the keyboard — instant access across the full catalog.

- FlexSearch `Document` index built client-side on first open (`tokenize: "forward"` for prefix match)
- Searches name, title, description, and tags across all entity kinds simultaneously
- 5-min TTL matching backend cache; concurrent-open deduplication
- Keyboard navigation: ↑↓ to move, Enter to navigate, Esc to dismiss
- Kind color badges and lifecycle hints on each result row
- Sidebar "Search…" button triggers the same palette

**Catalog search & filtering:**
- Full-text search (`?search=`) across name, title, description, tags — backend in-process
- Owner filter (`?owner=`) — strips `group:` prefix, case-insensitive
- Kind filter pills (All / System / Component / API / Resource / Group / Doc)
- Lifecycle filter moved to client-side — full dataset fetched once, tab counts always accurate
- Cache invalidation webhook (`POST /api/v1/webhooks/catalog/refresh`, Bearer token)
- `GET /api/v1/catalog/entities/:kind/:name/versions` — latest image tag per environment

**Supporting features:**
- Environment versions card: latest dev / staging / production tag per entity; container image rows color-coded by environment
- Team ownership view: Group detail page shows APIs owned, Resources owned, and APIs consumed by the team's components
- Session notifications: bell icon, `sessionStorage`-backed; background poll detects catalog merges
- Dark mode: Dracula-inspired palette — `#282a36` background, lavender `#bd93f9` accents, `#6272a4` muted text
- Import wizard pagination: "Load More" for teams with > 50 repos
- Doc entity: direct commit to main, author-scoped draft visibility, `docStatus` editing, `relatedTo` editing

### v0.3.1 — Portal UI Polish

Entity detail layout redesign, docs-as-drawer, and build-time version stamping.

**Entity detail page restructure:**
- Two-column layout: operational content (CI/CD, runtime, promotion, releases) on the left; metadata sidebar (relationships, links, annotations, scaffold info) on the right
- Relationships card redesigned — grouped by type (Depends On, Provides API, Consumes API, Related To, Members, Children) with color-coded dot indicators and linked `kind/name` chips instead of flat label+badge rows
- Dead code removed: `fetchAllEntities`, `RelatedDocsSection`, `DocsSkeleton`, `RefList` server components replaced by lazy client-side drawer

**Documentation drawer:**
- "Show Documents" button in the header actions row (same level as Edit / Edit Config)
- Slide-in panel rendered via `ReactDOM.createPortal` into `document.body` — escapes the `page-enter` CSS animation's transform containing block so the drawer covers the full viewport
- Grouped by type: RFC (violet), ADR (blue), Doc (purple) with per-group count and color badges
- Lazy-fetched on first open; subsequent opens use cached result
- Draft badge, doc status badge, author line per card; empty state with "Create Document" CTA

**Build-time version stamping:**
- `NEXT_PUBLIC_APP_VERSION` baked into the JS bundle via Dockerfile `ARG`/`ENV` at `docker build` time
- CI derives version from the git tag (`v0.3.1` → `0.3.1`) and passes it as `--build-arg APP_VERSION=<semver>` — `package.json` is intentionally NOT updated to avoid invalidating the Next.js/Turbopack build cache on local dev restarts
- Portal version shown in the user dropdown (topbar) as `WxOps Portal vX.Y.Z`
- Settings page: Runtime section removed (version visible in topbar); Account section footer split into two icons — `Shield` for OIDC identity, `Server` for Kubernetes RBAC via Pinniped
- Profile menu item removed from topbar dropdown (duplicate of Settings)

**CI workflow:**
- `ARGOCD_URL` org-level variable documented in workflow header comment
- `docker/build-push-action` receives `NEXT_PUBLIC_ARGOCD_URL` and `APP_VERSION` as build-args
  — *superseded in v0.5.0: `ARGOCD_URL` became runtime backend config and the build-arg was removed*
- Changelog commit message updated to `chore(release): update changelog for <tag>`

---

## Shipped — v0.4.1: Darlane Sync Improvements & CLI Download Proxy

Post-release patch addressing the `darlane sync` delete bug and hardening
the inner-loop DX. Also adds authenticated CLI binary downloads through the
portal so developers never need direct Gitea access.

### `wxops darlane sync` — Enhanced File Sync

| Fix / Feature | Detail |
|---|---|
| **Delete propagation (bug fix)** | Files and directories deleted locally are now removed from the pod on the next flush via `kubectl exec rm -rf`. Previously only `Write`/`Create`/`Rename` events were handled; `Remove` was silently ignored. |
| Initial full sync | On startup the tool syncs all non-excluded files to the pod before incremental events begin. Suppressed with `--no-initial-sync`. |
| Max-debounce cap (2 s) | A continuous burst no longer blocks syncs indefinitely — flush fires at the 2-second mark regardless of incoming events. |
| kubectl retry | Both sync and delete calls are retried up to 3 times (2 s delay) so the session survives a pod restart mid-watch. |
| Cleaner output | Consistent `↑  synced` / `✗  deleted` prefixes; file names listed inline (up to 5, then `… and N more`); errors to stderr. |
| Graceful SIGINT/SIGTERM | `signal.NotifyContext` — `Ctrl-C` flushes any pending batch then prints `stopped.` before exiting. |

### CLI Download Proxy

| Fix / Feature | Detail |
|---|---|
| `GET /api/v1/cli/download/:platform` | New protected backend endpoint that calls the Gitea releases API with the service-account token and streams the latest `wxops-*` binary back to the authenticated browser session. Users never need direct Gitea access. |
| Overview page download card | Platform links in the CLI card now point to `/api/v1/cli/download/{platform}` with architecture labels. |
| `GITEA_PORTAL_OWNER` / `GITEA_PORTAL_REPO` | Two new optional env vars (defaults: `GITEA_CATALOG_OWNER` / `wxops-portal-v2`). |

### nginx Cookie Buffer Fix

| Fix | Detail |
|---|---|
| `proxy_buffer_size 32k` on `/auth/` | nginx's default 4 k proxy buffer was too small for the AES-256-GCM Pinniped session cookie (id_token + access_token + refresh_token ≈ 3–4 kB), causing a 502 `upstream sent too big header` error on `/auth/callback` in K8s deployments. Fixed by adding `proxy_buffer_size 32k; proxy_buffers 4 32k;` to the `/auth/` location block. |
| `X-Forwarded-Proto` preservation | Added `map $http_x_forwarded_proto $real_proto` so nginx passes the Ingress controller's `X-Forwarded-Proto: https` header upstream rather than overwriting it with the internal `http` scheme. |
| Cookie `Secure` flag | Backend now detects HTTPS from `X-Forwarded-Proto` header (`secure := c.GetHeader("X-Forwarded-Proto") == "https"`) so the `Secure` flag is set correctly in production without hardcoding. |

---

## Shipped — v0.4.3: `wxops update` Self-Update Command

Closes the last gap in the CLI lifecycle: developers can now keep the binary
current without Gitea access, a manual download, or curl flags.

### `wxops update`

| Feature | Detail |
|---|---|
| Version check | `GET /api/v1/cli/version` returns the latest tag. If the installed version already matches, the command exits immediately with "Already up to date." |
| Platform detection | Detects the running OS and architecture at compile time (`runtime.GOOS`/`runtime.GOARCH`) — no flags needed. |
| Atomic replace | Binary is downloaded to a temp file in the same directory as the current executable (same filesystem as the target, so rename is guaranteed atomic). Executable bit set before rename. |
| Symlink-safe | `filepath.EvalSymlinks` is called before writing so the real file is replaced, not the symlink. |
| Dev build guard | Binaries stamped with `dev` (local builds without `-ldflags`) always show the prompt and never silently overwrite. |
| `--yes` / `-y` flag | Skips the `[y/N]` confirmation for scripted use (e.g. provisioning scripts, onboarding automation). |
| Content-length check | If the server sends `Content-Length`, the downloaded byte count is verified before the rename. An incomplete download is rejected and the temp file cleaned up. |

### Portal-side requirements

| Requirement | Status |
|---|---|
| `GET /api/v1/cli/version` — returns `{"version":"vX.Y.Z"}` | ✓ Shipped in v0.4.2 |
| `GET /api/v1/cli/download/:platform` — streams binary | ✓ Shipped in v0.4.1 |

The `wxops update` command is purely a client-side addition — no new backend endpoints.

---

## Pending (infrastructure — not portal code)

These are blocked on platform-side work, not portal development.

| Task | Owner | Description |
|------|-------|-------------|
| Template quality | Platform team | One solid Go template with working CI, health checks, Prometheus metrics. The portal reads and applies templates correctly; the template *content* itself needs to be production-grade. |
| XTenantApp Composition | Platform team | Crossplane `Composition` (the CR that interprets an `XTenantApp` and provisions namespace, RBAC, networking, ingress). The portal generates the CR correctly; the Composition needs to reliably reconcile end-to-end before scaffold can be trusted in production. |
| **Prometheus cardinality guards** | Platform team | `sampleLimit`, `targetLimit`, `labelLimit` are all `0` (unlimited) with `retention: 120h`. One high-cardinality label on one tenant service is a platform-wide incident. Highest-value/lowest-effort item in this table. |
| **Alloy `cluster` label is hardcoded** | Platform team | `cluster = "kubeweekend"` is stamped statically in three places. Cosmetic with one cluster; load-bearing and *wrong* the moment a second cluster ships logs. Must be parameterised **before** hub-spoke, not after. |
| **Ingest reachable from spokes** | Platform team | Loki/Tempo/Prometheus/Pyroscope are `ClusterIP` with no ingress, so a spoke's Alloy cannot reach them. Requires a deliberate decision (ingress+auth, private path, or hub gateway) — Loki runs `auth_enabled: false`, so a public endpoint would accept writes from anyone. |
| **Loki has no tenant isolation** | Platform team | `auth_enabled: false` means every namespace's logs share one unpartitioned store. Grafana Editors can query across tenants; the portal's links are scoped by convention only. Disclosed in security-assurance.md §4c. |
| Misleading `prometheus.io/scrape` example | Platform team | The `XTenantApp` example file shows those annotations commented out under `podAnnotations`, implying they work. Prometheus Operator ignores them without an `additionalScrapeConfig`, which does not exist. Remove or correct the example so nobody follows it. |
| DCGM / GPU exporter | Platform team | No GPU exporter deployed, so GPU utilisation metrics do not exist. Pure deployment task — unrelated to application instrumentation. |

> **Note — Template Quality vs XTenantApp Composition:**
> These are *infrastructure* items, not portal feature work. Template Quality = the
> actual template files (Go boilerplate, Dockerfile, Gitea Actions workflow, health
> endpoint) need a production-grade pass. XTenantApp Composition = the Crossplane
> side that *receives* the manifest the portal generates and provisions real cluster
> resources. Neither requires portal code changes.

---

## Shipped — v0.4.0: Darlane & `wxops` CLI & Wire with Doc Site

> Full implementation docs: [`docs/darlane/darlane.md`](docs/darlane/darlane.md), [`docs/cli/cli.md`](docs/cli/cli.md)

**Darlane — per-environment parallel debug pods**

| Feature | Status |
|---------|--------|
| On-demand, overlay-driven Darlane config (not scaffold-time) | ✓ Shipped |
| JSON 6902 `op: add` patch to `spec.parameters.darlane` in overlay kustomization | ✓ Shipped |
| `POST /api/v1/catalog/entities/{kind}/{name}/darlane` handler | ✓ Shipped |
| Dev env: direct commit to `main`; staging/prod: PR with `portal-managed` label | ✓ Shipped |
| Permission gate: team member for dev; manager or platform-team for staging/prod | ✓ Shipped |
| `promostatus` returns `darlaneEnabled` per env (read live from overlay) | ✓ Shipped |
| Promotion panel: "Enable Darlane" button + 2-step wizard + patch preview | ✓ Shipped |
| Inline copy-paste kubectl / mirrord debug commands when Darlane is active | ✓ Shipped |
| XR schema contract defined (see `docs/darlane/darlane.md`) | ✓ Shipped |
| `trafficWeight` / A/B split | Deferred — schema field reserved |
| TTL enforcement in composition | Deferred — portal writes the hint; composition team implements |
| `productionOverride` — debug pods in production | Deferred — field reserved, portal never sets it |
| `GET /api/v1/cli/version` - Add endpoint for checking latest CLI versioning for downloaded | ✓ Shipped |
| Wire UI for docs to docs-site built by [Docusaurus](https://docusaurus.io/) | ✓ Shipped |

**`wxops` CLI binary**

| Feature | Status |
|---------|--------|
| `wxops login --portal <url>` — PKCE browser flow | ✓ Shipped |
| `wxops catalog list [--kind] [--lifecycle]` | ✓ Shipped |
| `wxops catalog get <kind> <name>` | ✓ Shipped |
| `wxops debug <service> [--env]` — live Darlane status + kubectl/mirrord commands | ✓ Shipped |
| `wxops darlane sync` — fsnotify watch + tar-pipe into pod | ✓ Shipped |
| `wxops darlane exec` — interactive pod shell | ✓ Shipped |
| `wxops darlane port-forward` — local port → pod | ✓ Shipped |
| `wxops version` | ✓ Shipped |
| `WXOPS_TOKEN` + `WXOPS_PORTAL_URL` env vars for CI/CD | ✓ Shipped |
| Cross-platform binaries: linux/darwin × amd64/arm64 | ✓ Shipped |
| `Makefile` targets for local build/install/cross-compile | ✓ Shipped |
| `wxops scaffold new` — interactive project creation | Deferred to v0.5.0 |
| `wxops darlane enable` — write Darlane config from CLI | Deferred to v0.5.0 |

**Deferred to v0.5.0+**

| Feature | Description |
|---------|-------------|
| Feature Flags (OpenFeature / Flagd) | `FlagConfiguration` CRD scaffold + flag management UI panel |
| A/B Testing (Argo Rollouts) | Rollout CR scaffold + "Promote canary" PR button |
| `wxops scaffold new` | Interactive project creation from CLI (mirrors portal wizard) |
| `wxops darlane enable` | Write Darlane config and open PR from CLI |
| Runtime observability | ArgoCD sync/health status + Crossplane XR conditions via Pinniped; Alertmanager active alerts surfaced per service; deep links to Grafana/Loki/Tempo pre-scoped to service labels — no native log/metric/trace viewers (Grafana handles correlation) |

---

## Shipped — v0.5.0: Runtime Observability

Live environment status from ArgoCD and Crossplane via Pinniped, plus deep links
into the existing LGTM stack rather than duplicating it.

> **Scope decision (2026-07-13):** The portal surfaces context, not dashboards.
> Native log/metric/trace viewers are explicitly out of scope — Grafana's signal
> correlation (Explore, exemplars, profiling) cannot be replicated cheaply, and
> duplicating it would always be inferior. The portal's value is generating
> pre-scoped deep links from catalog context (service name, namespace, team, env)
> so developers land on the right Grafana view in one click.

| Feature | Description |
|---------|-------------|
| ArgoCD status via Pinniped | Reads `Application` CRs in ns `argocd` with the user's own K8s credentials. Name derived from `gitea/source-location`: `{team}-{appName}-{env}`. Shows sync status, health, landed revision, and last operation phase. |
| Crossplane XR status | Reads `XTenantApp` (cluster-scoped) via the same auth. Uses the composition's own `.status.ready`/`.status.created`/`url`/`image` write-back rather than Crossplane's `Ready` condition, which lags behind reality. |
| Environment panel | Rewrote the Runtime tab: one row per environment per cluster with sync/health/provisioning chips, revision, image, live URL. Replaces the old Deployment-name-suffix guessing. Intended state from git, observed state from cluster. |
| Grafana deep links | Logs (LogQL), traces (TraceQL), metrics (PromQL), and profiles, pre-scoped to namespace + app. Built from the label conventions Alloy actually emits. Entity-supplied names are sanitised to DNS-1123 so a crafted name cannot rewrite the query. |
| Runtime configuration | `ARGOCD_URL`, `ARGOCD_NAMESPACE`, `LGTM_GRAFANA_URL`, `LGTM_*_DATASOURCE` read by the Go backend and shipped in the API payload — not `NEXT_PUBLIC_*` build args, so a URL change is a Deployment edit rather than a CI rebuild. |
| Graceful degradation | Per-cell `forbidden` / `not-found` / `unreachable` states. A missing RBAC binding or an un-promoted environment renders as itself, never as an outage. |
| CredentialBroker refactor | Extracted the token-exchange → refresh → Concierge flow out of `ClusterHandler` so every handler that reads a spoke shares one credential cache and one auth path. |
| Active alerts | Opt-in Alertmanager read (`ALERTMANAGER_URL`). Firing alerts per service on the Runtime tab, critical-first, with severity, duration, pod and upstream runbook link. Hidden entirely when unconfigured. |
| Session recovery | A 401 in the Runtime tab, Alerts card or Cluster tabs now renders "Session expired" with a **Sign in again** button that renews the Pinniped session and returns the user to the same page — no sign-out required. `/auth/login` gained an optional `return_to` path, stored server-side with the PKCE verifier and hardened against open redirects. |
| First unit tests | `internal/observability`, `internal/alertmanager` and `internal/auth` ship the repo's first test packages — 25 tests covering link construction and per-environment scoping, query-injection sanitisation, alert filtering, the read-only/bounded HTTP contract, and open-redirect rejection on the return path. |

**Prerequisite (platform):** two RBAC bindings per tenant in
`wxops-gitops-infrastructure` — a `ClusterRoleBinding` to `tenant-platform-reader`
(cluster-scoped composites cannot be reached by a namespaced binding) and a
`RoleBinding` in ns `argocd` to `aggregate-argoproj-view`. Without them the panel
degrades rather than failing.

**Active alerts (simple version):** the Runtime tab shows what is firing for a
service, read from Alertmanager. Since no alert rule carries an `app` label, the
portal queries by `namespace` and narrows by matching the alert's `pod` label
against the `{appName}-` prefix; namespace-scoped alerts (no `pod` label) are
shown too. Read-only — one `GET`, no silencing or acknowledgement.

**This is the one feature that changes assurance claim A4.** Alertmanager is the
portal's only egress destination outside Gitea/Vault/OIDC/K8s, so it is opt-in
(`ALERTMANAGER_URL`, empty by default), timeout- and result-bounded, and
documented with its residual exposure — the read is *not* user-scoped, because
Alertmanager has no Kubernetes RBAC. See
[security-assurance.md](docs/security/security-assurance.md) §4b.

**Grafana authentication documented:** Dex-only (basic-auth login form disabled),
with `platform-team` → Admin and every other authenticated user → Editor so
developers can use Explore. The honest limit is written down: the mapping is
binary, Grafana OSS has no Team Sync, folder permissions scope dashboards not
queries, and Loki runs `auth_enabled: false` — so observability data is shared
across tenants even though the K8s API, Vault and Git are isolated. See
security-assurance.md §4c.

**Target architecture documented:** hub Grafana + spoke Alloy, in
[observability-architecture.md](docs/platform/observability-architecture.md),
explicitly marked as not-yet-implemented with the three blockers named
(hardcoded Alloy `cluster` label, unreachable ingest endpoints from spokes, no
Loki tenancy).

See [docs/platform/observability.md](docs/platform/observability.md) for selectors,
the RBAC prerequisite, and the platform limitations this surfaced (hardcoded Alloy
`cluster` label, no ServiceMonitors for tenant workloads, OTLP logs/metrics not
wired).

---

## Landed — v0.5.1: Observability Completion

> **Status:** Code-complete across all four repos. Not yet cut as a tagged
> release.

v0.5.0 delivered the *context* layer — status, deep links, alerts. This closed
the remaining gap: the platform used to emit no application metrics, so
latency, error rate and saturation were unanswerable. Finishing observability
before the refactor means the OSS release ships a complete story rather than a
partial one.

**This was the first release that is not portal-first** — it spans three
repos, and the order was a hard dependency chain, not a preference. Design and
rationale:
[observability-architecture.md](docs/platform/observability-architecture.md#application-metrics--the-missing-layer).

| # | Feature | Repo | Description |
|---|---------|------|-------------|
| 1 | Template instrumentation | `wxops-templates` | Real Prometheus client library per language + middleware emitting the contract metrics: `http_requests_total` (counter), `http_request_duration_seconds_bucket` (**histogram** — this is what makes P95/P99 possible), `http_requests_in_flight` (gauge). `/metrics` previously hand-wrote two runtime gauges with no client library, so scraping it returned almost nothing. |
| 2 | ServiceMonitor emission | `wxops-core` | `monitoring: { enabled, port, path, interval }` on `XTenantApp` → a `ServiceMonitor` (or `PodMonitor`) carrying `release: kube-prometheus-stack` (without it Prometheus silently ignores the monitor) and a `sampleLimit`. Ships without naming the Service port — the endpoint uses `targetPort` instead, a deliberate choice to avoid mutating a live composed resource. |
| 3 | Monitoring toggle | Portal | Checkbox in the scaffold wizard + Edit Config, same tier as Darlane. Writes the XR field; never writes the manifest. |
| 4 | Standard metrics dashboard | `wxops-gitops-infrastructure` | **One** Grafana dashboard keyed on the contract metric names — P95/P99, error rate, saturation — parameterized by `$namespace`/`$app`/`$env` so it works for every golden-path service with no per-team configuration. `$env` is a regex-derived variable off the `$app` naming suffix, not a real Prometheus label yet — the `ServiceMonitor` sets no `targetLabels`. The portal deep-links to it with variables pre-filled. |

Also shipped, independent of that chain:

| Feature | Repo | Description |
|---------|------|-------------|
| Catalog completeness score | Portal | Per-entity quality score: description, owner, tags, links, lifecycle, API spec. Computed on read, no schema or cache change. |
| Dependency comparison | Portal | Cache dependency manifests by `owner/repo@ref` (tags are immutable, so they cache indefinitely; the default branch gets a short TTL) and server-render the card so it paints without a spinner. Adds a compare control that diffs the current branch against a selected release, showing only added / removed / bumped packages. |

**Deferred to backlog, not shipped in v0.5.1** — both were originally scoped
as "shippable in parallel" alongside the two above; research going into this
release found both are blocked on a decision, not on engineering time, so
they were pulled rather than rushed:

| Feature | Repo | Why deferred |
|---------|------|-------------|
| DORA-lite metrics | Portal | Nothing in the codebase records a timestamped "reached production" event today — both existing mechanisms are current-state snapshots only. Lead time needs either an accepted proxy-timestamp approximation or new poll-and-diff infrastructure this codebase doesn't have. Deployment frequency alone is buildable without that decision. |
| Per-service alert scoping | `wxops-gitops-infrastructure` | Confirmed `defaultRules.additionalRuleLabels` is the wrong mechanism — it's a single flat label applied cluster-wide, cannot vary per tenant. A real fix needs a new per-tenant `PrometheusRule` (mirroring the shipped `ServiceMonitor` pattern) plus a product decision on which alerts get per-tenant treatment. The portal-side matching change is small (~15-20 lines) once that's decided. |

---

## Planned — v0.6.0: Refactor, Modularization & OSS Readiness

**No new features.** This release makes the codebase something a stranger can
read, contribute to, and trust — the prerequisite for opening the repos rather
than a detour from it. Full plans:
[refactor-and-hardening.md](docs/development/refactor-and-hardening.md) (the
engineering gate) and
[open-source-readiness.md](docs/development/open-source-readiness.md) (the
launch checklist).

### Measured baseline (2026-08-11)

| Signal | State | Target |
|---|---|---|
| Tests | 25 passing, in 3 backend packages (`internal/observability`, `internal/alertmanager`, `internal/auth`) — added in v0.5.0 | Pure helpers + auth/RBAC + scaffold generation covered; CI-enforced |
| Frontend tests | 0 | At least the BFF proxy shape and status mapping |
| CLI tests | 0 | Namespace/deployment derivation covered |
| Backend god-file | `handlers/catalog.go` 2,764 lines spanning 6 concerns | No file a reviewer opens first is >500 lines |
| Frontend god-file | `promotion-panel.tsx` 2,708 lines | Split by step/concern |
| CLI god-file | `internal/commands/darlane.go` 1,272 lines | Split; kill the `platform-team` namespace divergence with `debug.go` |
| Core god-file | `kcl/tenant-app/main.k` 1,002 lines, Darlane logic woven through ~20 fields | Extract Darlane; add render-golden snapshots |
| Error handling | ~200 inline `c.JSON(…, gin.H{"error": …})`, no shared helper, no error codes | One helper, typed codes |
| Logging | 32 unstructured `log.Printf`, no request ID | Structured `slog` — also unblocks the audit story |
| BFF duplication | 20+ `route.ts` files re-implementing identical cookie forwarding | One shared proxy helper |

### Scope

| Workstream | Description |
|---|---|
| Modularization | Split the four god-files by concern. This is the single biggest readability win and the thing a first-time reader hits immediately. |
| Test foundation | Tests are the *permission slip* for outside contributions — without them, merging a stranger's PR is unsafe at any review depth. Start with pure helpers, auth/RBAC decisions, and scaffold manifest generation. |
| Shared error + logging | One error helper with codes; `log.Printf` → structured `slog`. |
| BFF proxy helper | Collapse the duplicated Route Handler boilerplate into one utility. |
| CLI namespace bug | `debug.go` maps `platform-team` → ns `platform`; `darlane.go` omits it, producing the wrong namespace. A real behaviour bug that will bite a first adopter. |
| Core render-golden snapshots | `validate`/`render`/`lint`/`kcl-check` exist but nothing guards a refactor against silent manifest drift. |
| OSS hygiene | `LICENSE` (Apache-2.0), `README` (user-facing, not the vision doc), `CONTRIBUTING`, `SECURITY`, `CODE_OF_CONDUCT`, issue templates — none exist in either repo today. |
| Scrub | ~186 internal hostname occurrences across both repos; full-history secret scan (`gitleaks`/`trufflehog`) before anything is published. |
| 10-minute demo | `make demo` against the existing `DEV_BYPASS_AUTH` + `CATALOG_LOCAL_DIR` affordances, with Darlane as the payoff. The single highest-leverage adoption artifact. |
| Release + versioning | Tag `v0.6.0` as the first public-ready cut; confirm the release workflow produces clean artifacts from a public repo. |

> **Why this is the last release before opening the repos:** v0.5.0 proved the
> architecture works end-to-end and v0.5.1 completes the observability story, so
> the code being published describes a finished capability rather than a partial
> one. Everything after this is driven by what real adopters ask for.

---

## Beyond v0.6.0 — driven by adoption, not by a date

No further versions are planned. Once the repos are public, what ships next is
decided by what real adopters ask for rather than by a roadmap written before
anyone was using it.

The directions already scoped, in rough order of how often they come up:

| Direction | What it covers |
|---|---|
| **Security & compliance** | Audit trail (who promoted what, with approval chain), SBOM + CVE panel with fix-issue creation, policy coverage reporting. Specs in [enterprise-roadmap.md](docs/roadmap/enterprise-roadmap.md) Track B. |
| **SRE & incident response** | Signal correlation across logs, metrics, traces and events in one window; validated-fix workflow in an isolated Darlane twin. Design in [system-intelligence.md](docs/roadmap/system-intelligence.md). |
| **Intelligence layer** | Guardian scanning and audit around agent-driven sessions — the open wedge is the execution platform, the enterprise line is the AI review. See [open-source-readiness.md](docs/development/open-source-readiness.md) §A. |
| **Developer experience** | CVE routing, test visibility, productivity signals, dependency comparison. Specs in [devex-integrations.md](docs/roadmap/devex-integrations.md). |
| **Cross-tenant visibility** | "Consumed by" on API entities, "Used by" on Resources, blast-radius before deprecating a shared API. Catalog work — independent of everything above. |
| **Multi-cluster** | Per-cluster ArgoCD status and per-cluster observability endpoints in the registry Secret schema. **Blocked on two prerequisites:** the collector's hardcoded `cluster` label must be parameterized before log links can be scoped per cluster, and headless M2M credentials are an open design ([multi-cluster-authentication.md](docs/platform/multi-cluster-authentication.md)). |
| **Fleet sync-back & flexible delivery** | Propagating template improvements (security patches, CI fixes, new platform tooling) into already-scaffolded services without clobbering team-owned code, plus per-service delivery topology (full 3-env vs. shorter paths) without losing governance guarantees. Real, multi-piece effort — lock file, file-mutability classification, and a diff-and-PR bot are each separate decisions, not one feature. Idea captured in [fleet-sync-and-golden-path-evolution.md](docs/roadmap/fleet-sync-and-golden-path-evolution.md). |

See [docs/scaffolding/cross-environment-promotion.md](docs/scaffolding/cross-environment-promotion.md)
for the promotion model these build on.

---

## Backlog — Enterprise & Intelligence

Not scheduled. Prioritized by real usage feedback.

> **Dev-ready specs:** the items in this section are turned into a phased, code-grounded
> development plan (Phases 1–4, backend package/route surface, XDarlane XRD, Guardian)
> in [docs/roadmap/enterprise-roadmap.md](docs/roadmap/enterprise-roadmap.md). Those
> phases are deliberately unversioned — they begin after v0.6.0 and are gated on
> adoption, not on a date.
>
> **Intelligence vision:** how system intelligence combines with Darlane for
> diagnose-and-validate incident response (on-call triage, hotfix, deep analysis) is in
> [docs/roadmap/system-intelligence.md](docs/roadmap/system-intelligence.md).

### Cross-Tenant Dependency Visibility

The catalog currently shows relationships in one direction only: a Component lists which APIs it
`consumesApis` and which Resources it `dependsOn`. The **provider** side has no visibility —
a team that owns an API or Resource cannot see who is consuming it, which creates a blind spot
for breaking-change impact analysis and capacity planning.

| Feature | Description |
|---------|-------------|
| Reverse dependency: "Consumed by" on API entities | API detail page lists all Components (across all tenants) that declare `consumesApis` pointing to this API. Shows team, lifecycle, and environment so the API owner knows exactly who is affected by a breaking change. |
| Reverse dependency: "Used by" on Resource entities | Resource detail page lists all Components that declare `dependsOn` pointing to this resource (e.g. a shared database or Vault mount). Lets the resource owner (often platform-team) see blast radius before modifying or deprecating a resource. |
| Provider consumption dashboard on Component detail | A "Downstream consumers" section on the Component page showing all external teams that consume this component's APIs — the mirror of the existing "Consumes" section on the Group page. |
| Cross-tenant dependency graph | System-level Mermaid graph extended to show edges that cross team boundaries — `consumesApis` references from one team's Component to another team's API rendered as dashed cross-boundary arrows. Currently suppressed; needs opt-in visibility control so tenants don't accidentally expose internal service topology. |
| Breaking-change impact blast radius | When a platform-team member marks an API entity as `deprecated`, the portal computes and shows "N components across M teams consume this API" before confirming. Same for Resource deprecation. Derived entirely from existing catalog graph — no new data source. |

### Documentation Collaboration & Team Responsibility

RFCs and ADRs today are single-author documents — a team writes them, they live in the catalog,
other teams can read them. There is no mechanism for cross-team review, no way to assign a
Person In Charge (PIC) distinct from the owning group, and no onboarding guide linking that
assigns responsibility for new joiners.

| Feature | Description |
|---------|-------------|
| PIC (Person In Charge) field on entities | `spec.pic: user:alice` annotation on Component, API, Resource, and Doc entities — the single accountable person, distinct from `spec.owner` (the team). Portal renders this as a named contact card with Gitea profile link. Useful for escalation and on-call handoff. |
| Collaboration mapping on entities | `spec.collaboratesWith: [group:payments-team, group:identity-team]` on Component or Doc entities — declares which other teams co-develop or co-own this service. Portal shows the linked teams on the entity detail page. Enables cross-team RFC review routing. |
| Cross-tenant RFC review notification | When a team opens a new RFC (`docStatus: under-review`) that lists a consuming team in `spec.relatedTo` or `spec.collaboratesWith`, the portal flags it on the consuming team's Group page as "RFC pending your review." No email — surfaced in portal only. |
| Doc coverage report | Per-team report: which Components have zero linked ADRs? Which have no runbook? Surface coverage gaps as a quality metric on the Group detail page alongside the existing APIs/Resources/Consumes sections. Computable from existing `relatedTo` edges — no new data. |
| Onboarding responsibility per team | `spec.onboardingGuide: doc:default/rocket-team-onboarding` annotation on Group entities — links to a Doc entity that describes who to contact, what access to request, and what the team builds. New joiners land on the Group page and immediately see their onboarding path and PIC. |
| Runbook quick-access on Component detail | Pin runbooks to component detail pages — any Doc with `docType: runbook` and a `relatedTo` reference to a Component appears in a collapsible "Runbooks" panel above the activity feed. On-call engineers reach the runbook in one click from the entity they are responding to. |
| Decision timeline per system | Visual timeline on the System detail page showing all ADRs and their status (`proposed → accepted → superseded`) in chronological order. Makes architectural history scannable for new team members without reading every ADR in full. |
| Doc listing filters in catalog | Filter catalog list by `docType` — "Show all ADRs", "Show all Runbooks", "Show all RFCs" — as kind-level sub-tabs on the Doc row of the kind picker. Backend already supports `?kind=Doc`; this adds a `?docType=` query param. |
| Full-text search inside doc content | Extend catalog search to reach inside `spec.contentUrl` markdown content, not just entity metadata (name, description, tags). Requires a background indexing step when the catalog cache refreshes — content fetched and indexed into an in-memory trigram map keyed by entity name. |

### Platform Observability & Quality

| Feature | Description |
|---------|-------------|
| E2E scaffold test | Full scaffold → CI trigger → ArgoCD sync → lifecycle promotion cycle with real Gitea. Deferred until XTenantApp Composition is stable enough to run reliably. |
| Audit trail | SOC2-ready: who promoted what, when, with approval chain |
| Scorecard / maturity | Production readiness (monitoring, docs, tests, SLOs) |
| Cost tracking | Resource usage per environment from metrics API |
| Health probe roll-up | Platform-wide dashboard from per-entity health checks |
| Compliance status | Vault policy coverage, RBAC audit, pod security per namespace |

### Inner-Loop Sync Transport

The current `darlane sync` transport is `kubectl exec tar xf -` — simple, zero daemon, but
blocked by distroless/scratch images (no `tar`) and always sends whole files. The options below
are ordered from easiest to adopt to most architecturally involved.

#### Transport comparison

| Transport | Agent in pod? | Delta sync | Distroless | Complexity | Best for |
|-----------|--------------|-----------|------------|-----------|----------|
| `kubectl exec tar` *(current)* | No | No | ✗ Blocked | Low | Quick setup, standard images |
| rsync over kubectl exec | No | Yes (byte-level) | ✗ Blocked | Low | Large files / slow links |
| Sidecar file-receiver agent | Yes (sidecar) | No | ✓ Works | Medium | Distroless, scratch images |
| gRPC streaming agent | Yes (sidecar) | Yes | ✓ Works | High | Enterprise: mTLS, no kubectl |
| WebSocket relay via portal | Yes (sidecar) | Yes | ✓ Works | High | Enterprise: zero-kubectl model |
| Mirrord / Telepresence | Yes (daemon) | N/A — no sync | ✓ Works | High | Full inner-loop interception |

#### Planned enhancements

| Feature | Description |
|---------|-------------|
| rsync delta sync | Use `rsync` over `kubectl exec` as an alternative to tar pipe. Only changed bytes are transferred — significant win for large files or large source trees. Requires `rsync` in the image; CLI auto-detects and falls back to tar if unavailable. `darlane sync --transport rsync`. |
| Sidecar file-receiver agent | Small Go binary (`wxops-file-receiver`) deployable as an init container or sidecar. Exposes a minimal HTTP endpoint to accept tar streams — no `tar` or `rsync` required in the main container. Solves distroless and scratch images. XTenantApp adds `fileSyncSidecar: true` to inject the sidecar automatically via the Crossplane Composition. |
| Skaffold / DevSpace config generation | `wxops darlane config-gen --tool skaffold` generates a `skaffold.yaml` with correct `sync` rules for the active session (local/remote paths, excludes). Lets teams plug darlane path resolution into existing Skaffold or DevSpace pipelines without duplicating config. |

#### Enterprise backlog

| Feature | Description |
|---------|-------------|
| gRPC streaming agent | `wxops-sync-agent` sidecar exposes a gRPC endpoint. CLI streams file deltas with mTLS using a Pinniped-issued credential. Fully authenticated, encrypted transport — no plain kubectl exec required. Delta sync at byte level via rolling hash (similar to rsync algorithm). Session state aware: agent signals pod-replaced events to the CLI so re-seed fires without a retry-based inference. |
| WebSocket relay through portal | `POST /api/v1/darlane/:service/sync` WebSocket endpoint on the portal. CLI authenticates with the portal session cookie and streams file changes; portal relays to the pod-side agent via in-cluster networking. Developers need no kubeconfig or kubectl at all — portal session is the only credential. Removes the `kubectl` binary as a hard dependency of `wxops darlane`. |
| Mirrord integration | `wxops darlane mirror <service>` wraps `mirrord exec` with namespace/target derived from the catalog entity. Mirrord intercepts syscalls so the local process reads/writes the pod filesystem directly — no file sync loop needed. Generates the `mirrord.json` config from the entity annotations (`container-port`, namespace, deployment). |

### Catalog & Scaffold Extensions

| Feature | Description |
|---------|-------------|
| Self-service actions | Restart, scale, rollback via portal (RBAC-controlled) |
| Custom environments | qa, perf, canary beyond dev/staging/prod |
| SBOM linking | CycloneDX/SPDX from CI, searchable dependency table |
| Dependency impact query | "Which services ship a vulnerable version of library X?" |
| Template marketplace | Browse, preview, compare golden-path templates |
| Project import/migration | Discover existing namespaces, infer ProjectClaim, migrate cross-cluster |
| ArgoCD ApplicationSet update | Point at `overlays/*` directories in gitops-infra. Platform-team config change, no portal code required. |
| Cluster namespace aggregation | "All my namespaces" selector in cluster views — merge pods/deployments from multiple tenant namespaces into one list |
| E2E scaffold test | Full scaffold → CI trigger → ArgoCD sync → lifecycle promotion cycle with real Gitea. Deferred until XTenantApp Composition is stable. |

---

## Architecture Decisions

Key decisions that shape all future work.

| Decision | Resolution | Rationale |
|----------|-----------|-----------|
| Scaffold default lifecycle | `experimental` | Scaffold commits catalog only; no overlay generated — service not deployed until developer creates overlay via Promotion panel |
| experimental → development | Developer opens overlay PR (confirm after merge) | Ground-truth confirmation, not a command; overlay existence = service deployed |
| Promotion to staging/prod | Platform-team or team Managers only | Security gate; developers can promote experimental → development |
| Deprecation | Managers or platform-team | Opens removal PR; overlays preserved until platform approves; entity locked from editing |
| Portal cluster access | User's Pinniped token | RBAC-scoped, zero additional credentials |
| Gitops PR URLs | Not exposed to developers | Devs don't have gitops-infra access |
| Activity filtering | Gitea label `portal-managed` | Only portal PRs, not all gitops-infra changes |
| DB secret naming | `{appName}-db-creds` default | Matches XTenantApp secretsFrom schema |
| Config per environment | Kustomize overlays | Portal reads plain YAML, no rendering engine |
| XTenantApp image field | Plain `"repo:tag"` string | CRD schema simplicity; Image Updater patches via `image-transformer.yaml` |
| Image Updater placement | `tenants/{team}/{appName}-image-updater.yaml` | Separated from Kustomize manifests; clean ArgoCD control-plane view |
| Image Updater CR name | `{team}-{appName}` | Unique across teams in shared `argocd` namespace |
| Image Updater NamePattern | `{team}-{appName}-{dev\|staging\|production}` | Matches actual ArgoCD Application names (no `tenants-apps-` prefix) |
| Namespace from Pinniped groups | `orgName:teamName` → `tenant-{orgName}` | K8s list-namespaces is all-or-nothing; group-derived is RBAC-safe |
| Demotion behavior | Updates lifecycle only, keeps overlay | Removing overlay tears down environment |
| Portal writes to cluster | Never | Config changes go through Gitea PR only |
| Vault from portal | Create/update only | Prevent secret exposure and accidental deletion |
| No Backstage runtime | Borrow YAML schema, not the runtime | Keeps stack to Go + Next.js, no plugin ecosystem |
| Catalog source of truth | Git (Gitea), not portal DB | GitOps discipline, audit trail via git history |
| Client-side filtering first | Catalog rarely exceeds hundreds of entities | Avoids query layer, keeps backend stateless |
| ProjectClaim via Gitea PR | Not applied directly to cluster | ArgoCD reconciles, full audit trail, `git revert` for rollback |
| Catalog lifecycle filter | Client-side on full dataset | Accurate tab counts, no pagination mismatch; backend cache makes full fetch fast |
| Notification persistence | `sessionStorage` only | No cross-session leakage; cleared automatically on tab/session end |

---

## Reference Documents

| Document | Purpose |
|----------|---------|
| [README.md](README.md) | System overview, quick start, doc index |
| [docs/concepts/architecture.md](docs/concepts/architecture.md) | Auth model, Pinniped, hub-spoke topology |
| [docs/concepts/platform-engineering-rationale.md](docs/concepts/platform-engineering-rationale.md) | Why Crossplane + Portal + Golden Path |
| [docs/scaffolding/cross-environment-promotion.md](docs/scaffolding/cross-environment-promotion.md) | Per-environment config, lifecycle promotion |
| [docs/scaffolding/golden-path-git-flow.md](docs/scaffolding/golden-path-git-flow.md) | Branch model, CI pipeline, image lifecycle |
| [docs/scaffolding/lifecycle-webhook.md](docs/scaffolding/lifecycle-webhook.md) | CI webhook for lifecycle promotion, trust chain |
| [docs/catalog/documentation-strategy.md](docs/catalog/documentation-strategy.md) | ADR, RFC, Runbook strategy |
| [docs/catalog/service-catalog.md](docs/catalog/service-catalog.md) | Entity kinds, relationships |
| [docs/catalog/catalog-user-guide.md](docs/catalog/catalog-user-guide.md) | YAML field reference, examples |
