# API Reference

All API routes are served by the Go backend. nginx routes traffic inside the container:

- `/auth/*` → Go `:8080` directly
- `/api/v1/*` → Go `:8080` directly
- `/api/*` → Next.js `:3000` (BFF Route Handlers that proxy to Go with the session cookie)

The browser only ever talks to one origin. See [container.md](./container.md) for the full nginx routing table.

---

## Auth (no session required)

| Method | Path | Description |
|---|---|---|
| `GET` | `/auth/login` | Starts OIDC Authorization Code + PKCE flow — redirects to Pinniped Supervisor |
| `GET` | `/auth/callback` | Supervisor redirect handler — exchanges code, sets `wxops_session` cookie |
| `GET` | `/auth/me` | Returns identity from session cookie — used by Next.js SSR and client components |
| `POST` | `/auth/logout` | Clears session cookie |

---

## Webhooks (Bearer token, no session required)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/webhooks/catalog/refresh` | Invalidates the in-memory catalog cache immediately. Auth: `Authorization: Bearer <WEBHOOK_TOKEN>`. Wire to a Gitea push webhook on `gitops-infra` so new catalog entities appear instantly instead of waiting for the 5-minute TTL. |

> `POST /api/v1/webhooks/promote/:kind/:name` was removed in v0.3.0. Lifecycle promotion is now UI-driven via the Promotion panel.

See [lifecycle-webhook.md](./lifecycle-webhook.md) for token configuration.

**Gitea webhook setup for cache refresh** (one-time platform-team config):
- Repository: `gitops-infra` → Settings → Webhooks → Add
- URL: `https://<portal-host>/api/v1/webhooks/catalog/refresh`
- Content type: `application/json`
- Authorization header: `Bearer <WEBHOOK_TOKEN>` (same `WEBHOOK_TOKEN` used for lifecycle promotion)
- Trigger: Push events (optionally restrict to paths matching `catalog/**`)

---

## Clusters (require `wxops_session` cookie)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/me` | Current user identity and groups |
| `GET` | `/api/v1/clusters` | All registered spoke clusters |
| `GET` | `/api/v1/clusters/:id` | Single cluster metadata |
| `GET` | `/api/v1/clusters/:id/namespaces` | Namespace list on spoke (derived from Pinniped groups, never calls `GET /api/v1/namespaces`) |
| `GET` | `/api/v1/clusters/:id/pods?namespace=X` | Pod list on spoke |
| `GET` | `/api/v1/clusters/:id/deployments?namespace=X` | Deployment list on spoke |
| `GET` | `/api/v1/clusters/:id/identity` | Pinniped `WhoAmIRequest` — upstream IDP username, UID, groups |
| `GET` | `/api/v1/clusters/:id/kubeconfig` | Pinniped exec-credential kubeconfig for `kubectl` |
| `GET` | `/api/v1/clusters/:id/token` | RFC 8693 cluster-scoped token (Pinniped clusters only) |
| `GET` | `/api/v1/clusters/:id/credentials` | Concierge mTLS client certificate (Pinniped clusters only) |

---

## Catalog (require `wxops_session` cookie)

Catalog responses follow the Backstage `backstage.io/v1alpha1` envelope. See [service-catalog.md](./service-catalog.md) for the full schema.

### Entity CRUD

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/catalog/entities` | List all entities — optional `?kind=Component&search=pay&owner=rocket-team&page=1&limit=50` filters. `search` is case-insensitive substring across name, title, description, tags. `owner` strips the `group:` prefix. `limit=0` returns all (used internally). |
| `GET` | `/api/v1/catalog/entities/:kind/:name` | Single entity detail |
| `POST` | `/api/v1/catalog/entities` | Register a new catalog entity (writes YAML to gitops-infra) |
| `PUT` | `/api/v1/catalog/entities/:kind/:name` | Update an existing entity |
| `DELETE` | `/api/v1/catalog/entities/:kind/:name` | Delete an entity (platform-team only) |

### Entity enrichment

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/catalog/entities/:kind/:name/spec` | OpenAPI / AsyncAPI spec for `API` entities — fetched from Gitea via `metadata.links` |
| `GET` | `/api/v1/catalog/entities/:kind/:name/content` | Rendered Markdown content for `Doc` entities — fetched from `spec.contentUrl` |
| `GET` | `/api/v1/catalog/entities/:kind/:name/ci` | Latest CI workflow runs from Gitea Actions — requires `gitea/source-location` annotation |
| `GET` | `/api/v1/catalog/entities/:kind/:name/releases` | Git releases and container images from Gitea package registry |
| `GET` | `/api/v1/catalog/entities/:kind/:name/packages` | Dependency manifests parsed from the source repo (`go.mod`, `package.json`, `requirements.txt`) |
| `GET` | `/api/v1/catalog/entities/:kind/:name/versions` | Latest image tag per environment (`dev-*`, `v*-rc*`, `v*`) inferred from the Gitea package registry — used by the environment versions row on entity detail pages. |

### Lifecycle promotion

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/catalog/entities/:kind/:name/promostatus` | Overlay existence per environment, open gitops-infra PRs, and latest image tags. Used by the Promotion panel to determine which step (create-overlay / confirm / PR pending) to show. |
| `POST` | `/api/v1/catalog/entities/:kind/:name/promote` | Two actions: `create-overlay` — generates Kustomize overlay files and opens a `[Promote]` PR in gitops-infra; `update-overlay` — edits an existing overlay and opens a `[Update]` PR. `confirm` — verifies the overlay is on `main` and updates the catalog lifecycle. Body: `{ action, targetLifecycle, replicas?, ingressHost?, …, dbName?, dbTier?, … }`. Session auth — experimental→development: any team member; development→staging or staging→production: platform-team or team Managers only. |
| `POST` | `/api/v1/catalog/entities/:kind/:name/deprecate` | Writes `wxops.cloud/deprecated`, `-reason`, `-by`, `-at` annotations to the catalog entity and opens a `[Deprecate]` removal PR in gitops-infra. Sets lifecycle to `deprecated`. Platform-team or team Managers only. Body: `{ reason }`. |

### Activity

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/catalog/activity` | Recent portal-managed PR and commit activity across all entities |

---

## Scaffold (require `wxops_session` cookie)

Scaffold endpoints create and manage projects by committing manifests to `gitops-infra` and creating repositories from Gitea templates. They are only registered when `GITEA_URL` is set (or `SCAFFOLD_LOCAL_DIR` in dev).

### Templates

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/scaffold/templates` | List available scaffold template repos (`GITEA_TEMPLATE_REPO`) |
| `GET` | `/api/v1/scaffold/templates/:id/tree` | File tree of a specific template |

### Repositories

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/scaffold/repos?page=1&limit=50` | List Gitea repos visible to the authenticated user |

### Projects

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/scaffold/projects` | Scaffold a new project — creates repo from template, commits XTenantApp manifests and catalog entity YAML to gitops-infra, opens PR |
| `GET` | `/api/v1/scaffold/projects/:team/:appName/config` | Read current XTenantApp config for an existing project |
| `PUT` | `/api/v1/scaffold/projects/:team/:appName/config` | Update XTenantApp config — opens a gitops-infra PR with the diff |

### Secrets

| Method | Path | Description |
|---|---|---|
| `PUT` | `/api/v1/scaffold/secrets` | Write runtime env vars to Vault at `team/appName/env`. Verifies repo and gitops-infra config exist first. Derives `appName` from the `wxops.cloud/vault-path` annotation — never the entity's catalog name. |
