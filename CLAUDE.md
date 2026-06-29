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
| `docs/ROADMAP.md` | What shipped (v0.1.0–v0.2.0), what's pending, what's next (v0.3.0+), architecture decisions |
| `docs/architecture.md` | Auth model (Pinniped), hub-spoke topology, security boundaries |
| `docs/platform-engineering-rationale.md` | Why Crossplane + Portal, tradeoffs, business case, proving the model |

### Read when touching specific areas

| Area | Doc |
|------|-----|
| Scaffold / project creation | `docs/golden-path-git-flow.md` |
| Lifecycle webhook / CI | `docs/lifecycle-webhook.md` |
| Catalog entities | `docs/service-catalog.md`, `docs/catalog-user-guide.md` |
| RFC, ADR, Runbook | `docs/documentation-strategy.md` |
| Environment promotion | `docs/cross-environment-promotion.md` |
| Deployment / infra | `docs/deployment.md`, `docs/environment-variables.md` |
| Cluster features | `docs/cluster-registry.md` |

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

Location: `tenants/{team}/{appName}.yaml` (NOT inside `tenants-apps/`)
`metadata.name`: `{appName}` only (no team prefix, no `-image-updater` suffix)

Tag conventions:
- `dev-{YYYY-MM-DD_HH-MM-SS}-{sha7}` — CI build on develop branch
- `vX.Y.Z-rcN` — crane re-tag on staging merge
- `vX.Y.Z` — crane re-tag on production release

## Lifecycle Webhook

The lifecycle sync CI workflow lives in `gitops-infra`, NOT in the scaffolded
project repo. It fires on push to main when
`tenants-apps/**/overlays/dev/kustomization.yaml` changes (Image Updater
commit = new dev deploy = promote to `development`).

The webhook uses `PORTAL_URL` from Gitea repo secrets on `gitops-infra`.
The portal backend uses `WEBHOOK_TOKEN`. Never use `PORTAL_EXTERNAL_URL`
(removed in v0.2.0).

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
- App Router with BFF proxy pattern (frontend routes proxy to Go backend)
- **Read `frontend/AGENTS.md` before touching Next.js code** — this version
  has breaking changes from training data. Check `node_modules/next/dist/docs/`
  for current API.

### Shared patterns

- Template variable substitution: `{{ .Key }}`, `{{.Key}}`, `__KEY__`
- Catalog entity format: Backstage-compatible `backstage.io/v1alpha1`
- DB secret naming: use `scaffold.DbSecretTarget(appName, dbName)` — never
  construct `{appName}-{dbName}-creds` manually
- Portal-managed PRs: always attach the `portal-managed` Gitea label via
  `ensurePortalLabel()` when creating gitops-infra PRs
- Edit-config UI: must match scaffold wizard layout (`rounded-xl border` cards,
  `lg:grid-cols-2`, pill step badges) — see `edit-config-form.tsx`

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
