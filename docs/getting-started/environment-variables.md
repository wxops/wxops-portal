# Environment Variables

## Backend

Copy `backend/.env.example` to `backend/.env` for local development. In production, pass these as real environment variables (Kubernetes `env:` / `envFrom:` from a Secret). The Go binary reads `os.Getenv()` — it does not require a `.env` file at runtime.

### Core

| Variable | Default | Required | Description |
|---|---|---|---|
| `PORT` | `8080` | | HTTP listen port |
| `FRONTEND_URL` | `http://localhost:3000` | ✅ | CORS allowed origin — must match the portal's public URL |
| `SESSION_SECRET` | — | ✅ | 64 hex chars (32-byte AES key) — `openssl rand -hex 32` |
| `DEV_BYPASS_AUTH` | `false` | | Skip OIDC — auto-login as `dev / platform-team`. **Dev only, never production.** |

### OIDC / Pinniped Supervisor

| Variable | Default | Required | Description |
|---|---|---|---|
| `OIDC_ISSUER_URL` | — | ✅ | Pinniped Supervisor `FederationDomain` issuer URL |
| `OIDC_CLIENT_ID` | `wxops-portal` | ✅ | `OIDCClient` resource name — must start with `client.oauth.pinniped.dev-` |
| `OIDC_CLIENT_SECRET` | — | ✅ | Client secret from `OIDCClientSecretRequest` (see [deployment.md](./deployment.md)) |
| `OIDC_REDIRECT_URI` | `http://localhost:3000/auth/callback` | ✅ | Must match `allowedRedirectURIs` in the `OIDCClient` CR |
| `OIDC_SCOPES` | `openid,profile,email,groups,offline_access,pinniped:request-audience` | | `pinniped:request-audience` is required for cluster token exchange |
| `OIDC_CA_BUNDLE_FILE` | — | | Path to PEM file for Supervisor TLS CA (self-signed certs only) |
| `OIDC_CA_BUNDLE` | — | | Inline PEM for Supervisor TLS CA — alternative to file |
| `OIDC_TLS_SKIP_VERIFY` | `false` | | Skip TLS verification for Supervisor. **Dev only, never production.** |

### Cluster Registry

| Variable | Default | Required | Description |
|---|---|---|---|
| `CLUSTERS_CONFIG_FILE` | — | | Path to `clusters.json` — skips K8s Secret discovery. Recommended for local dev. |
| `CLUSTERS_CONFIG` | — | | Inline JSON cluster list — same schema as the file. Useful in CI. |
| `KUBECONFIG` | — | | Path to hub-cluster kubeconfig. Omit when running in-cluster. |
| `CLUSTER_NAMESPACE` | `wxops-system` | | Namespace where cluster Secrets are stored (K8s Secret discovery only). |

### Service Catalog

| Variable | Default | Required | Description |
|---|---|---|---|
| `GITEA_URL` | — | ✅ (prod) | Base URL of your Gitea instance — `https://gitea.example.com` |
| `GITEA_TOKEN` | — | ✅ (prod) | Personal access token with `repository` read+write scope |
| `GITEA_CATALOG_OWNER` | — | ✅ (prod) | Org or user that owns the `gitops-infra` repo |
| `GITEA_CATALOG_REPO` | `gitops-infra` | | Repo name containing the service catalog directory |
| `GITEA_CATALOG_PATH` | `service-catalog` | | Path inside the repo where entity YAML files live |
| `CATALOG_LOCAL_DIR` | — | | Local catalog dir for dev — when set, all `GITEA_CATALOG_*` vars are ignored |

### Scaffolding

| Variable | Default | Required | Description |
|---|---|---|---|
| `GITEA_TEMPLATE_OWNER` | _(GITEA_CATALOG_OWNER)_ | | Org owning the scaffold template repo — defaults to the catalog owner |
| `GITEA_TEMPLATE_REPO` | `scaffold-templates` | | Repo containing scaffold templates (each top-level directory = one template) |
| `GITEA_CRED_SECRET_NAME` | `gitea-credentials` | | Crossplane Secret name injected into generated `XGiteaRepository` CRs |
| `GITEA_CRED_SECRET_NAMESPACE` | `crossplane-system` | | Namespace of the Crossplane Gitea credentials Secret |
| `GITEA_BOT_USERNAME` | — | | CI bot Gitea username — added to the main branch push whitelist so release commits bypass PR requirement |
| `GITEA_BOT_EMAIL` | — | | CI bot git email — substituted into scaffold template CI files as `{{ .BotEmail }}` |
| `SCAFFOLD_LOCAL_DIR` | — | | Local template dir for dev — when set, `GITEA_TEMPLATE_*` vars are ignored |

### Vault (scaffold secret write)

The scaffold feature writes an initial Vault KV secret so the scaffolded app has a
secret mount from day one. The portal only **creates or updates** — it never reads
or deletes. When `VAULT_ADDR` is empty, the Vault write step is skipped silently;
`ExternalSecret` manifests are still generated, but secrets must be seeded manually.

| Variable | Default | Required | Description |
|---|---|---|---|
| `VAULT_ADDR` | — | | Vault server address — `https://vault.example.com`. When empty, Vault write is skipped. |
| `VAULT_TOKEN` | — | | Short-lived token with `wxops-portal` policy. Create with `vault token create -policy=wxops-portal -period=720h -orphan -renewable=true` and keep the accessor for renewal. |
| `VAULT_KV_MOUNT` | `secret` | | KV v2 mount path. Secrets are written to `{VAULT_KV_MOUNT}/{team}/{appName}`. |

### Runtime Observability

Powers the Runtime tab on Component pages: live ArgoCD sync/health, Crossplane
XR status, and deep links into Grafana. See
[docs/platform/observability.md](../platform/observability.md) for the selectors,
the RBAC prerequisite, and known limitations.

These are **runtime** variables read by the Go backend and shipped to the browser
inside the API response — unlike `NEXT_PUBLIC_APP_VERSION` below, which is baked
into the image at build time. Changing a dashboard URL is therefore a Deployment
env edit, not a CI rebuild.

| Variable | Default | Required | Description |
|---|---|---|---|
| `ARGOCD_URL` | — | | ArgoCD base URL — `https://argocd.example.com`. When empty, the ArgoCD button is hidden. |
| `ARGOCD_NAMESPACE` | `argocd` | | Namespace holding `Application` CRs. Reading them requires a `RoleBinding` for the tenant group in this namespace. |
| `LGTM_GRAFANA_URL` | — | | Grafana base URL. All signal links are Grafana Explore URLs, so this alone enables logs/traces/metrics/profiles. When empty, every signal link is hidden. |
| `LGTM_LOKI_DATASOURCE` | `Loki` | | Loki datasource name or uid. |
| `LGTM_TEMPO_DATASOURCE` | `Tempo` | | Tempo datasource name or uid. |
| `LGTM_PROMETHEUS_DATASOURCE` | `prometheus` | | Prometheus datasource uid — lowercase in kube-prometheus-stack. |
| `LGTM_PYROSCOPE_DATASOURCE` | `Pyroscope` | | Pyroscope datasource name or uid. |
| `ALERTMANAGER_URL` | — | | Enables the active-alerts panel on the Runtime tab. In-cluster address for kube-prometheus-stack: `http://kube-prometheus-stack-alertmanager.monitoring.svc.cluster.local:9093`. When empty the feature is off and the panel is hidden. |

The Grafana/LGTM values above are **only used to build URLs** — the portal never
calls Grafana, Loki, Tempo or Pyroscope; your browser follows the links using
your own Grafana session.

`ALERTMANAGER_URL` is different: setting it makes the portal query Alertmanager
server-side, which is its **only egress destination outside Gitea, Vault, the
OIDC issuer and the Kubernetes APIs**. It is opt-in, read-only, and bounded by
a 5s timeout. Operators enabling it should add the matching rule to the egress
NetworkPolicy — see [security-assurance.md](../security/security-assurance.md) §4b.

### CLI Download Proxy

The portal serves CLI binary downloads at `GET /api/v1/cli/download/:platform` so
tenant developers can install `wxops` without direct access to the Gitea repo.
The portal fetches the latest release asset server-side using `GITEA_TOKEN` and
streams it back to the authenticated browser session.

| Variable | Default | Required | Description |
|---|---|---|---|
| `GITEA_PORTAL_OWNER` | _(GITEA_CATALOG_OWNER)_ | | Org that owns the portal release repo. When empty, falls back to `GITEA_CATALOG_OWNER` at runtime. |
| `GITEA_PORTAL_REPO` | `wxops-portal-v2` | | Repo where `wxops-*` release binaries are attached. The portal calls `GET /api/v1/repos/{owner}/{repo}/releases?limit=1` to find the latest release, then streams the matching asset. |

No additional token is needed — the existing `GITEA_TOKEN` is reused.

### Catalog Cache Refresh Webhook

`WEBHOOK_TOKEN` authenticates the catalog cache invalidation webhook. Wire a Gitea
push webhook on `gitops-infra` to flush the 5-minute in-memory TTL immediately after
a catalog commit so new entities appear without delay.

| Variable | Default | Required | Description |
|---|---|---|---|
| `WEBHOOK_TOKEN` | — | | Shared secret for `Authorization: Bearer` on `POST /api/v1/webhooks/catalog/refresh`. Generate with `openssl rand -hex 32`. When empty, the endpoint returns 401. |

```sh
# Gitea → gitops-infra → Settings → Webhooks → Add
# URL:     https://<portal-host>/api/v1/webhooks/catalog/refresh
# Header:  Authorization: Bearer <WEBHOOK_TOKEN>
# Trigger: Push events
```

> **v0.3.0 change:** `POST /api/v1/webhooks/promote/:kind/:name` has been removed.
> Lifecycle promotion (`experimental → development → staging → production`) is now
> UI-driven via the Promotion panel on each Component detail page.
> See [lifecycle-webhook.md](../scaffolding/lifecycle-webhook.md) for the full promotion flow.

### Secret management in production

Recommended: use ESO (External Secrets Operator) to sync secrets from Vault into a Kubernetes Secret, then reference it with `envFrom: secretRef`. See the Design Decisions section in [container.md](../platform/container.md) for the rationale over Vault Agent file injection.

```yaml
envFrom:
  - secretRef:
      name: wxops-portal-secrets   # created by ESO from Vault
env:
  - name: FRONTEND_URL
    value: "https://portal.example.com"
  # ... other non-secret config inline
```

---

## Frontend

Frontend variables fall into two categories with fundamentally different lifecycles.

### Runtime variable (set by supervisord / K8s)

| Variable | Default | Description |
|---|---|---|
| `BACKEND_URL` | `http://localhost:8080` | Internal URL of the Go backend for Next.js SSR server-side fetch calls |

`BACKEND_URL` is read at runtime when `node server.js` starts. In the combined Docker image it is set to `http://127.0.0.1:8080` by supervisord — Next.js SSR pages reach the Go backend directly on loopback without going through nginx.

### Build-time public variables (baked into the JS bundle by `next build`)

> **These must be passed as `--build-arg` to `docker build`.** They are evaluated
> during `next build` inside Stage 2 of the Dockerfile and compiled into the
> client-side JS bundle. Passing them at container runtime has no effect — the
> bundle is already sealed.

| Variable | Build-arg name | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_APP_VERSION` | `APP_VERSION` | `0.0.0` | Semver string baked into the portal UI (topbar version badge). CI derives it from the git tag (`v0.3.1` → `0.3.1`) and passes it as `APP_VERSION`. **`frontend/package.json` is intentionally NOT updated by CI** — changing the package version invalidates the Next.js/Turbopack build cache and causes a full recompile on the next local dev restart. |

**Dockerfile wiring** (Stage 2):

```dockerfile
ARG APP_VERSION="0.0.0"
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION

RUN npm run build
```

**CI wiring** (`.gitea/workflows/ci.yml`):

```yaml
- name: Set version
  run: |
    SEMVER="${{ github.ref_name }}"
    SEMVER="${SEMVER#v}"
    echo "APP_VERSION=$SEMVER" >> "$GITHUB_ENV"

- name: Build and push image
  uses: docker/build-push-action@v6
  with:
    build-args: |
      APP_VERSION=${{ env.APP_VERSION }}
```

**Local development:** the version badge is simply absent from the topbar
dropdown when `NEXT_PUBLIC_APP_VERSION` is unset.

> **Removed in v0.5.0 — `NEXT_PUBLIC_ARGOCD_URL`.** ArgoCD's URL is now the
> runtime backend variable `ARGOCD_URL` (see *Runtime Observability* above),
> served inside API responses instead of baked into the bundle. Operators
> repoint ArgoCD with a Deployment env edit rather than a CI rebuild. The
> org-level Gitea Actions variable `ARGOCD_URL` is no longer read at build time
> and can be removed from the workflow.
>
> Prefer this pattern for any new URL: a `NEXT_PUBLIC_*` build arg seals the
> value into the image, so every change costs a rebuild.
