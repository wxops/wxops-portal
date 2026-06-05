# Environment Variables

## Backend

Copy `backend/.env.example` to `backend/.env` for local development. In production, pass these as real environment variables (Kubernetes `env:` / `envFrom:` from a Secret). The Go binary reads `os.Getenv()` — it does not require a `.env` file at runtime.

| Variable | Default | Required | Description |
|---|---|---|---|
| `PORT` | `8080` | | HTTP listen port |
| `FRONTEND_URL` | `http://localhost:3000` | ✅ | CORS allowed origin — must match the portal's public URL |
| `OIDC_ISSUER_URL` | — | ✅ | Pinniped Supervisor `FederationDomain` issuer URL |
| `OIDC_CLIENT_ID` | `wxops-portal` | ✅ | `OIDCClient` name — must start with `client.oauth.pinniped.dev-` |
| `OIDC_CLIENT_SECRET` | — | ✅ | Client secret from `OIDCClientSecretRequest` (see [deployment.md](./deployment.md)) |
| `OIDC_REDIRECT_URI` | `http://localhost:3000/auth/callback` | ✅ | Must match `allowedRedirectURIs` in the `OIDCClient` CR |
| `OIDC_SCOPES` | `openid,profile,email,groups,offline_access,pinniped:request-audience` | | `pinniped:request-audience` is required for cluster token exchange |
| `OIDC_CA_BUNDLE_FILE` | — | | Path to PEM file for Supervisor CA (self-signed only) |
| `OIDC_CA_BUNDLE` | — | | Inline PEM for Supervisor CA — alternative to file |
| `OIDC_TLS_SKIP_VERIFY` | `false` | | Skip TLS verification for Supervisor — dev only, never production |
| `SESSION_SECRET` | — | ✅ | 64 hex chars (32-byte AES key) — generate with `openssl rand -hex 32` |
| `KUBECONFIG` | — | | Path to kubeconfig for hub cluster — omit when running in-cluster |
| `CLUSTER_NAMESPACE` | `wxops-system` | | Namespace where cluster Secrets are stored |
| `CLUSTERS_CONFIG_FILE` | — | | Path to `clusters.json` — skips K8s Secret discovery when set (dev only) |
| `CLUSTERS_CONFIG` | — | | Inline JSON cluster config — same format as `clusters.json` (dev only) |
| `CATALOG_LOCAL_DIR` | — | | Local filesystem catalog dir for dev — when set, Gitea config is ignored |
| `GITEA_URL` | — | | Base URL of your Gitea instance, e.g. `https://gitea.example.com` |
| `GITEA_TOKEN` | — | | Personal access token with `repository` read scope |
| `GITEA_CATALOG_OWNER` | — | | Org or user that owns the gitops-infra repo |
| `GITEA_CATALOG_REPO` | `gitops-infra` | | Repo containing the catalog directory |
| `GITEA_CATALOG_PATH` | `service-catalog` | | Path within the repo where entity YAML files live |

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
