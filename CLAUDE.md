# WxOps Portal — Agent Instructions

## What This Project Is

An Internal Developer Portal (IDP) built on Kubernetes-native tooling:
Go backend (Gin) + Next.js frontend (App Router) + Gitea + Vault +
Pinniped + ArgoCD + Crossplane.

The portal provides: service catalog, golden-path scaffolding, activity
tracking, CI/CD visibility, config management via PR, and cluster status.

## Before You Write Code

**Read these docs first.** The project has specific architecture decisions,
security constraints, and conventions that are NOT obvious from the code alone.

### Required reading (always)

| Doc | Why |
|-----|-----|
| `ROADMAP.md` | What shipped (v0.1.0–v0.3.0), what's pending, what's next (v0.4.0+), architecture decisions |
| `docs/concepts/architecture.md` | Auth model (Pinniped), hub-spoke topology, security boundaries |
| `docs/concepts/platform-engineering-rationale.md` | Why Crossplane + Portal, tradeoffs, business case, proving the model |

### Read when touching specific areas

| Area | Doc |
|------|-----|
| Scaffold / project creation | `docs/scaffolding/golden-path-git-flow.md` |
| Darlane (per-env debug pods, XR schema) | `docs/darlane/darlane.md` |
| `wxops` CLI (commands, auth, local build) | `docs/cli/cli.md` |
| Lifecycle promotion / cache webhook | `docs/scaffolding/lifecycle-webhook.md` |
| Catalog entities | `docs/catalog/service-catalog.md`, `docs/catalog/catalog-user-guide.md` |
| RFC, ADR, Runbook | `docs/catalog/documentation-strategy.md` |
| Environment promotion (overlay model) | `docs/scaffolding/cross-environment-promotion.md` |
| Deployment / infra | `docs/getting-started/deployment.md`, `docs/getting-started/environment-variables.md` |
| Cluster features | `docs/platform/cluster-registry.md` |
| XTenantApp / XTenantDatabase / Vault (full spec schema, base vs overlay split, field mapping) | `docs/platform/platform-features.md` |

## Security Constraints

These are non-negotiable. Violating them is a bug, not a tradeoff.

1. **Portal is READ-ONLY for clusters.** Never write to K8s API from the portal.
   Config changes go through Gitea PR, never direct cluster writes.

2. **Vault secrets: NO read, NO delete.** Only create/update. The portal must
   check that the remote resource (repo + gitops config) exists before writing
   to Vault.

3. **Delete is platform-team only.** Never expose delete actions to tenant
   developers in the UI.

4. **No gitops-infra URLs exposed to developers.** PRs to gitops-infra are
   internal. Return status text, not PR links. Activity feed shows titles
   and status, not clickable links to the gitops repo.

5. **Lifecycle promotion is role-gated.** Only `platform-team` or the owning
   team's `{team}:Managers` sub-group can promote to staging or production.
   Developers cannot change lifecycle beyond `experimental`.

## Gitea OIDC Group Format

Gitea sends groups as exactly two levels: `orgName:teamName`
(e.g., `wxops:rocket-team`). Key conventions built on this:

- **Namespace mapping:** `orgName:teamName` → namespace `tenant-{orgName}`
  (the org is the unit of tenancy; all sub-teams share one namespace)
- **RBAC subjects:** ClusterRoleBindings on spoke clusters use the full
  `orgName:teamName` string, not plain `teamName`
- **Platform check:** look at the part after `:` — if it equals `platform-team`,
  the user has platform-wide access
- **Namespace listing:** never call `GET /api/v1/namespaces` for tenant users —
  it returns all or 403. Derive namespaces from group membership instead.
  See `groupToTenant()` in `backend/internal/handlers/clusters.go`

## Kustomize Overlay Structure

Scaffold generates a split base/overlay layout:

```
tenants-apps/{team}/{appName}/
  base/
    kustomization.yaml          ← lists all base resources
    xtenant-app.yaml            ← identity, image, wiring (env-agnostic)
    xtenant-database.yaml       ← if database enabled
    external-secret-*.yaml
    catalog-*.yaml
  overlays/dev/
    kustomization.yaml          ← references ../../base + image-transformer.yaml
    image-transformer.yaml      ← registers spec/parameters/image on XTenantApp kind
    patch-xtenant-app.yaml      ← env-specific: replicas, resources, ingress, secretsFrom
```

**`images:` is NOT in the overlay kustomization.yaml.** ArgoCD Image Updater owns
that section and writes it back after each build. Adding a static `images:` block
causes a reset-to-`latest` fight on every reconcile.

The `image-transformer.yaml` is required because Kustomize only knows how to
substitute images in standard Deployment/StatefulSet specs by default — it needs
this config file to reach `spec/parameters/image` on the `XTenantApp` CRD.

The overlay patch uses `omitempty` on `appName`, `namespace`, and `image` so
those fields are absent from the patch and inherit from base.

## ArgoCD Image Updater CR

Location: `tenants/{team}/{appName}-image-updater.yaml` (NOT inside `tenants-apps/`)
`metadata.name`: `{team}-{appName}` (unique across teams in the shared `argocd` namespace)
ApplicationRef NamePatterns: `{team}-{appName}-dev`, `{team}-{appName}-staging`, `{team}-{appName}-production`

Tag conventions:
- `dev-{YYYY-MM-DD_HH-MM-SS}-{sha7}` — CI build on develop branch
- `vX.Y.Z-rcN` — crane re-tag on staging merge
- `vX.Y.Z` — crane re-tag on production release

## Lifecycle Promotion (v0.3.0+)

`POST /api/v1/webhooks/promote/:kind/:name` was removed in v0.3.0. Lifecycle
promotion is now UI-driven via the Promotion panel on each Component detail page —
two steps: create-overlay PR → confirm after merge.

`WEBHOOK_TOKEN` is still used for `POST /api/v1/webhooks/catalog/refresh`
(cache invalidation). Wire this to a Gitea push webhook on `gitops-infra`.
Never use `PORTAL_EXTERNAL_URL` (removed in v0.2.0).

## Code Conventions

### Backend (Go)

- Framework: Gin
- Directory: `backend/`
- Build: `cd backend && go build ./...`
- Vet: `cd backend && go vet ./...`
- Gitea client: `backend/internal/gitea/write.go` — all Gitea API methods
- Handlers: `backend/internal/handlers/` — scaffold.go, catalog.go, clusters.go
- Scaffold manifests: `backend/internal/scaffold/` — XTenantApp, ExternalSecret,
  kustomize, image_updater, catalog entities

### Frontend (Next.js)

- Directory: `frontend/`
- Type check: `cd frontend && npx tsc --noEmit`
- Lint: `cd frontend && npx eslint src/ --ext .ts,.tsx`
- **Read `frontend/AGENTS.md` before touching Next.js code** — this version
  has breaking changes from training data. Check `node_modules/next/dist/docs/`
  for current API.

#### Stack

| Layer | Package | Notes |
|---|---|---|
| Framework | `next@^16` (App Router) | React 19; server components by default |
| UI primitives | `@base-ui/react` | Unstyled, accessible — from the MUI/Base UI team |
| Styling | `tailwindcss@^4` | All visual design is Tailwind utility classes |
| Variants | `class-variance-authority` | `cva()` for button/badge size+color variants |
| Class merging | `clsx` + `tailwind-merge` | Combined into `cn()` in `src/lib/utils.ts` |
| Icons | `lucide-react` | Only icons — not a component library |
| Toasts | `sonner` | Via `<Toaster />` in root layout |
| Theme | `next-themes` | Light/dark toggle; `ThemeProvider` in root layout |
| Fonts | Geist Sans + Geist Mono | Loaded via `next/font/google` in root layout |
| Markdown | `react-markdown` + `remark-gfm` | Doc viewer, release notes |
| Diagrams | `mermaid@^11` | Imperative mount in `mermaid-diagram.tsx` |
| YAML | `js-yaml` | Spec parsing in openapi-viewer, edit-config form |
| OpenAPI | `swagger-ui-dist` | Imperative UMD mount — no React wrapper |

The components in `src/components/ui/` (`button.tsx`, `badge.tsx`, `card.tsx`, …)
are **source files in this repo** — they wrap Base UI primitives with Tailwind
styling. They were originally generated by the `shadcn` CLI (removed from
`package.json`; use `npx shadcn@latest add <component>` to add more).

#### BFF Proxy pattern

Client-side code cannot reach `BACKEND_URL` directly (it's an internal loopback
address inside the container). Browser JavaScript also cannot read the `wxops_session`
cookie (it is `HttpOnly`). The frontend therefore uses two distinct fetch paths:

**Path A — Server Components (pages):**
Data fetched at render time, server-to-server on loopback. Session cookie is
forwarded explicitly in the `Cookie:` header.

```ts
// Inside an async server component (e.g. catalog/page.tsx)
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";
const cookieStore = await cookies();
const session = cookieStore.get("wxops_session")?.value ?? "";

const res = await fetch(`${BACKEND_URL}/api/v1/catalog/entities`, {
  headers: { Cookie: `wxops_session=${session}` },
  cache: "no-store",
});
```

**Path B — Client Components (interactive widgets):**
Fetch to a Next.js Route Handler in `src/app/api/`. The Route Handler runs on
the server, reads the cookie from `next/headers`, and proxies the request to Go.

```ts
// Browser: fetch("/api/catalog/entities", { credentials: "include" })
//   ↓
// src/app/api/catalog/entities/route.ts  (Next.js Route Handler, server-side)
//   ↓
// Go backend at BACKEND_URL/api/v1/catalog/entities  (internal loopback)
```

The Route Handler pattern keeps `BACKEND_URL`, session cookies, and backend
error details off the browser. All `src/app/api/` files follow the same shape:
read the cookie from `next/headers`, forward it, return `NextResponse.json`.

**nginx routing (inside the container):**

```
browser
  → nginx :80
      /auth/*      → Go :8080   (OIDC callbacks, session management)
      /api/v1/*    → Go :8080   (cluster API, direct Go endpoints)
      /api/*       → Next.js :3000  (BFF proxy routes in src/app/api/)
      /*           → Next.js :3000  (pages, static assets)
```

`deploy/nginx.conf` MUST have two separate location blocks — `location /api/v1/` → Go and `location /api/` → Next.js. nginx longest-prefix matching ensures `/api/v1/` wins over `/api/`. A single `location /api/` → Go block silently sends all BFF requests to Go, which returns 404 because Go only serves `/api/v1/…`.

#### Rendering strategy

| Surface | Strategy | Reason |
|---|---|---|
| Catalog list, entity detail | Server component, `cache: "no-store"` | Fresh data per request; no client state needed |
| Docs section on entity detail | Async server component inside `<Suspense>` | Streams independently from the main page shell |
| Scaffold wizard, edit-config | `"use client"` + `useEffect` fetch via BFF | Multi-step form state; live preview |
| Cluster tabs (pods, deployments) | `"use client"` + `useEffect` fetch via BFF | Namespace selector, reload trigger |
| CI/CD, releases, packages cards | `"use client"` + `useEffect` fetch via BFF | Per-entity live data; 30s auto-refresh for CI |

`getSession()` and `requireSession()` in `src/lib/session.ts` are the canonical
way to verify auth in server components and redirect to `/login` when the session
is absent.

### Shared patterns

- Template variable substitution: `{{ .Key }}`, `{{.Key}}`, `__KEY__`
- Catalog entity format: Backstage-compatible `backstage.io/v1alpha1`
- DB secret naming: use `scaffold.DbSecretTarget(appName, dbName)` — never
  construct `{appName}-{dbName}-creds` manually
- Portal-managed PRs: always attach the `portal-managed` Gitea label via
  `ensurePortalLabel()` when creating gitops-infra PRs
- Edit-config UI: must match scaffold wizard layout (`rounded-xl border` cards,
  `lg:grid-cols-2`, pill step badges) — see `edit-config-form.tsx`
- Vault appName resolution: always derive `appName` from the
  `wxops.cloud/vault-path` annotation (`team/appName/env` → segment `[1]`),
  never from `entity.metadata.name`. Vault Resource entities are named
  `{appName}-vault` in the catalog, so the entity name is wrong for repo/Vault lookups.

## What NOT to Do

- Don't add cluster write operations to the portal
- Don't expose gitops-infra PR URLs in API responses to frontend
- Don't change the scaffold default lifecycle from `experimental`
- Don't allow non-platform-team / non-manager users to promote lifecycle to staging/prod
- Don't add `images:` to generated overlay `kustomization.yaml` — Image Updater owns it
- Don't put the ImageUpdater CR inside `tenants-apps/` — it belongs in `tenants/`
- Don't generate flat manifests — always use Kustomize base + overlay structure
- Don't add Helm template rendering to the portal backend (read values files as plain YAML)
- Don't create a separate permission system — use K8s RBAC via Pinniped
- Don't call `GET /api/v1/namespaces` for tenant users — derive from Pinniped groups
- Don't use `PORTAL_EXTERNAL_URL` — it was removed in v0.2.0
