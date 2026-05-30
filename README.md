# W'xOps Portal

A multi-cluster Kubernetes management portal with centralised SSO via Pinniped Supervisor. One login covers every spoke cluster — no per-cluster popups, no credential duplication.

## What it does

- **Single sign-on across clusters** — log in once via Pinniped Supervisor; every spoke cluster is accessible with the same session. No kubeconfig per cluster, no secondary prompts.
- **Service catalog** — browse all platform services, APIs, and infrastructure dependencies. Relationship graphs show how components connect. Entity pages link to runbooks, RFCs, and ADRs in Gitea.
- **Project scaffold** *(Phase 3)* — fill a form; the portal commits a `ProjectClaim` to `gitops-infra`; ArgoCD + Crossplane provision the namespace, database, Vault mount, and Gitea repo automatically.
- **CLI** *(Phase 4)* — `wxops` binary with the same API, usable in CI/CD pipelines.

## Architecture

```
Browser → nginx :80
              ├─ /auth/*    → Go backend  (OIDC, session, cluster token exchange)
              ├─ /api/v1/*  → Go backend  (cluster API, catalog API)
              └─ /*         → Next.js SSR (dashboard pages)

Hub cluster:  Pinniped Supervisor + wxops-system Secrets (cluster registry)
Spoke clusters: Pinniped Concierge + JWTAuthenticator per cluster
Catalog source: gitops-infra/catalog/ in Gitea (read-only, 5-min TTL cache)
```

All three processes (nginx, Go backend, Next.js) run inside a single Docker image managed by supervisord. The Kubernetes Ingress is the only external entry point.

## Quick Start

```bash
cp backend/.env.example backend/.env
# edit backend/.env — set OIDC_ISSUER_URL, SESSION_SECRET, OIDC_CLIENT_SECRET

make up
# portal: http://localhost
# dex:    http://localhost:5556
```

For local catalog testing without Gitea, add `CATALOG_LOCAL_DIR=./internal/catalog/examples` to `backend/.env`.

See [docs/local-development.md](docs/local-development.md) for the full setup including manual hot-reload mode.

## Documentation

| Topic | File |
|---|---|
| Architecture, auth sequence, hub-spoke topology | [docs/architecture.md](docs/architecture.md) |
| Production deployment (Steps 1–6, RBAC, OIDCClient) | [docs/deployment.md](docs/deployment.md) |
| Service catalog — entity schema, Backstage YAML, Go implementation | [docs/service-catalog.md](docs/service-catalog.md) |
| Environment variables reference | [docs/environment-variables.md](docs/environment-variables.md) |
| Local development | [docs/local-development.md](docs/local-development.md) |
| Cluster registry (K8s Secrets + clusters.json) | [docs/cluster-registry.md](docs/cluster-registry.md) |
| API reference | [docs/api-reference.md](docs/api-reference.md) |
| Container design (nginx, supervisord, Dockerfile) | [docs/container.md](docs/container.md) |
| Release workflow — conventional commits, versioning, CI variables | [docs/release-workflow.md](docs/release-workflow.md) |

## Roadmap

| Phase | Goal | Status |
|---|---|---|
| 1 — Identity & Multi-Cluster Access | One login, all spokes. PKCE/OIDC, RFC 8693 token exchange, Concierge mTLS certs. | `done` |
| 2 — Service Catalog | Browse services, APIs, resources. Mermaid relationship graphs. RFC/ADR links. | `done` |
| 3 — Service Graph + Project Scaffold | Cross-system graph. Form → `ProjectClaim` → ArgoCD → Crossplane → real resources. | `planned` |
| 4 — CLI | `wxops` binary — same API, terminal interface, CI/CD usable. | `planned` |
| 5 — Platform Intelligence | Cost attribution, compliance status, aggregate health roll-up. | `future` |

## Portal Scope

**The portal owns:** authentication, cluster visibility, service catalog, project scaffolding, kubeconfig download, CLI.

**The portal links to, never replaces:** Gitea (source, docs, RFCs, ADRs), Jira (task tracking), ArgoCD (deployment status), Grafana (metrics), Vault UI (secrets), PagerDuty (incidents).
