# API Reference

All API routes are served by the Go backend. The Next.js frontend proxies `/auth/*` and `/api/v1/*` to the backend — the browser only ever talks to one origin.

---

## Auth (no session required)

| Method | Path | Description |
|---|---|---|
| `GET` | `/auth/login` | Starts OIDC Authorization Code + PKCE flow — redirects to Pinniped Supervisor |
| `GET` | `/auth/callback` | Supervisor redirect handler — exchanges code, sets `wxops_session` cookie |
| `GET` | `/auth/me` | Returns identity from session cookie — used by Next.js SSR |
| `POST` | `/auth/logout` | Clears session cookie |

---

## Clusters (require `wxops_session` cookie)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/me` | Current user identity and groups |
| `GET` | `/api/v1/clusters` | All registered spoke clusters |
| `GET` | `/api/v1/clusters/:id` | Single cluster metadata |
| `GET` | `/api/v1/clusters/:id/namespaces` | Namespace list on spoke |
| `GET` | `/api/v1/clusters/:id/pods?namespace=X` | Pod list on spoke |
| `GET` | `/api/v1/clusters/:id/deployments?namespace=X` | Deployment list on spoke |
| `GET` | `/api/v1/clusters/:id/identity` | Pinniped `WhoAmIRequest` — upstream IDP username, UID, groups |
| `GET` | `/api/v1/clusters/:id/kubeconfig` | Pinniped exec-credential kubeconfig for `kubectl` |
| `GET` | `/api/v1/clusters/:id/token` | RFC 8693 cluster-scoped token (Pinniped clusters only) |
| `GET` | `/api/v1/clusters/:id/credentials` | Concierge mTLS client certificate (Pinniped clusters only) |

---

## Catalog (require `wxops_session` cookie)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/catalog/entities` | All entities — optional `?kind=Component` filter |
| `GET` | `/api/v1/catalog/entities/:kind/:name` | Single entity detail |

Catalog responses follow the Backstage `backstage.io/v1alpha1` envelope. See [service-catalog.md](./service-catalog.md) for the full schema.
