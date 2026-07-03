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
> See [lifecycle-webhook.md](./lifecycle-webhook.md) for the full promotion flow.

### Secret management in production

Recommended: use ESO (External Secrets Operator) to sync secrets from Vault into a Kubernetes Secret, then reference it with `envFrom: secretRef`. See the Design Decisions section in [container.md](./container.md) for the rationale over Vault Agent file injection.

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

| Variable | Default | Description |
|---|---|---|
| `BACKEND_URL` | `http://localhost:8080` | Internal URL of the Go backend for Next.js SSR server-side fetch calls |

`BACKEND_URL` is read at runtime when `node server.js` starts. In the combined Docker image it is set to `http://127.0.0.1:8080` by supervisord — Next.js SSR pages reach the Go backend directly on loopback without going through nginx.
