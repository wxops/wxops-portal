# W'xOps Portal

An Internal Developer Portal (IDP) for Kubernetes-native platform teams. One OIDC login via Pinniped Supervisor covers every spoke cluster. Golden-path scaffolding turns a form submission into a provisioned service — Gitea repo, Vault mount, XTenantApp CRD, Kustomize overlays, ArgoCD Image Updater — all committed to `gitops-infra` as a PR.

## What it does

- **Single sign-on across clusters** — log in once; every spoke cluster is accessible with the same Pinniped session. No per-cluster popups, no credential duplication.
- **Service catalog** — browse all platform services, APIs, and infrastructure dependencies. Relationship graphs, lifecycle filters, OpenAPI rendering, RFC/ADR/Runbook linking.
- **Golden-path scaffolding** — fill a wizard; the portal commits XTenantApp + XTenantDatabase + ExternalSecrets + Kustomize overlays + catalog entities to `gitops-infra`; ArgoCD + Crossplane provision namespace, database, Vault mount, and Gitea repo automatically.
- **Import existing repos** — register an existing Gitea project into the catalog without re-scaffolding.
- **Config edit via PR** — update XTenantApp platform features (replicas, ingress, secrets, probes) through a diff-review UI that creates a gitops-infra PR.
- **CI/CD and release visibility** — per-entity cards showing Gitea Actions runs, git releases, container images, and package dependencies (go.mod, package.json, requirements.txt, pyproject.toml).
- **Activity feed** — portal-managed PR history per team, filtered by role; lifecycle status per service.
- **Cluster views** — namespace-scoped pods and deployments derived from Pinniped group membership (no cluster-admin required); WhoAmI identity; reload without page refresh; kubeconfig download.
- **CLI** *(planned v0.5.0)* — `wxops` binary with the same API, usable in CI/CD pipelines.

## Architecture

```
Browser → nginx :80
              ├─ /auth/*    → Go backend  (OIDC, session, cluster token exchange)
              ├─ /api/v1/*  → Go backend  (clusters, catalog, scaffold, lifecycle)
              └─ /*         → Next.js SSR  (dashboard pages, BFF proxies)

Hub cluster:    Pinniped Supervisor + wxops-system Secrets (cluster registry)
Spoke clusters: Pinniped Concierge + JWTAuthenticator per cluster
Catalog source: gitops-infra/service-catalog/ in Gitea (read-only, 5-min TTL)
Gitops writes:  portal → Gitea PR → ArgoCD reconcile (never direct cluster writes)
```

All three processes (nginx, Go backend, Next.js) run inside a single Docker image managed by supervisord.

## Quick Start

```bash
cp backend/.env.example backend/.env
# Set OIDC_ISSUER_URL, OIDC_CLIENT_SECRET, SESSION_SECRET
# For local dev without OIDC: DEV_BYPASS_AUTH=true

make up
# portal: http://localhost
```

For local catalog testing without Gitea:
```bash
CATALOG_LOCAL_DIR=./internal/catalog/examples
```

See [docs/local-development.md](docs/local-development.md) for the full setup.

## Documentation

| Topic | File |
|---|---|
| Architecture, auth sequence, hub-spoke topology | [docs/architecture.md](docs/architecture.md) |
| Production deployment (RBAC, OIDCClient, steps 1–6) | [docs/deployment.md](docs/deployment.md) |
| Environment variables reference | [docs/environment-variables.md](docs/environment-variables.md) |
| **Service catalog — YAML user guide (all kinds, annotations, link types)** | [docs/catalog-user-guide.md](docs/catalog-user-guide.md) |
| Service catalog — design rationale | [docs/service-catalog.md](docs/service-catalog.md) |
| Golden-path git flow (branches, CI, image tags) | [docs/golden-path-git-flow.md](docs/golden-path-git-flow.md) |
| Lifecycle webhook (CI in gitops-infra → portal) | [docs/lifecycle-webhook.md](docs/lifecycle-webhook.md) |
| Cross-environment promotion design | [docs/cross-environment-promotion.md](docs/cross-environment-promotion.md) |
| Cluster registry (K8s Secrets + clusters.json) | [docs/cluster-registry.md](docs/cluster-registry.md) |
| Documentation strategy (RFC, ADR, Runbook) | [docs/documentation-strategy.md](docs/documentation-strategy.md) |
| Local development | [docs/local-development.md](docs/local-development.md) |
| Container design (nginx, supervisord, Dockerfile) | [docs/container.md](docs/container.md) |
| API reference | [docs/api-reference.md](docs/api-reference.md) |
| Release workflow | [docs/release-workflow.md](docs/release-workflow.md) |
| Roadmap & architecture decisions | [docs/ROADMAP.md](docs/ROADMAP.md) |

## Roadmap

| Version | Goal | Status |
|---|---|---|
| v0.1.0 | Identity & multi-cluster SSO via Pinniped | `shipped` |
| v0.1.1–v0.1.2 | CI/CD pipeline, operations readiness | `shipped` |
| v0.1.3 | Full service catalog with relationship graphs | `shipped` |
| v0.1.4 | Catalog UI & visualization refinements | `shipped` |
| v0.2.0 | Golden-path scaffolding, CI/CD visibility, activity feed, cluster UX | `in progress` |
| v0.3.0 | Platform visibility — version comparison, catalog search, team ownership | `next` |
| v0.4.0 | Environment promotion UI, ArgoCD/Crossplane status | `planned` |
| v0.5.0 | `wxops` CLI binary | `planned` |

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full feature list and architecture decisions.

## Portal Scope

**The portal owns:** authentication, cluster visibility, service catalog, project scaffolding, config management via PR, kubeconfig download.

**The portal links to, never replaces:** Gitea (source, docs, RFCs, ADRs), ArgoCD (deployment status), Grafana (metrics), Vault UI (secrets).

**The portal never does:** direct cluster writes, Vault secret reads, gitops-infra URL exposure to developers, delete operations for tenant users.
