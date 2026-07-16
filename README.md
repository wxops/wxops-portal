# W'xOps Portal

An Internal Developer Portal (IDP) for Kubernetes-native platform teams. One OIDC login via Pinniped Supervisor covers every spoke cluster. Golden-path scaffolding turns a form submission into a provisioned service — Gitea repo, Vault mount, XTenantApp CRD, Kustomize overlays, ArgoCD Image Updater — all committed to `gitops-infra` as a PR.

## What it does

- **Single sign-on across clusters** — log in once; every spoke cluster is accessible with the same Pinniped session. No per-cluster popups, no credential duplication.
- **Service catalog** — browse all platform services, APIs, and infrastructure dependencies. Full-text search, kind and owner filters, lifecycle tabs, relationship graphs, OpenAPI rendering, RFC/ADR/Runbook linking. Global command palette (Ctrl+K / Cmd+K) for instant keyboard-driven entity lookup.
- **Lifecycle promotion** — UI-driven promotion from `experimental` → `development` → `staging` → `production`. Creates Kustomize overlay PRs in `gitops-infra` for platform review; role-gated (developers → dev, managers/platform-team → staging/production). Includes deprecation with reason and removal PR.
- **Golden-path scaffolding** — fill a wizard; the portal commits XTenantApp + XTenantDatabase + ExternalSecrets + Kustomize base manifests + catalog entities to `gitops-infra`; ArgoCD + Crossplane provision namespace, database, Vault mount, and Gitea repo automatically.
- **Import existing repos** — register an existing Gitea project into the catalog without re-scaffolding.
- **Config edit via PR** — update XTenantApp platform features (replicas, ingress, secrets, probes) through a diff-review UI that creates a gitops-infra PR.
- **Documentation management** — create and edit RFC, ADR, and runbook Doc entities directly from the portal. Doc entities commit to `gitops-infra` instantly (no PR). Draft mode restricts visibility to the author; publishing makes the document visible to all.
- **CI/CD and release visibility** — per-entity cards showing Gitea Actions runs, git releases, container images (color-coded by environment), package dependencies, and latest image tag per environment (dev/staging/production).
- **Activity feed** — portal-managed PR history per team, filtered by role; lifecycle status per service. Session notifications for scaffold, import, and catalog update events.
- **Cluster views** — namespace-scoped pods and deployments derived from Pinniped group membership (no cluster-admin required); WhoAmI identity; reload without page refresh; kubeconfig download.
- **CLI** — `wxops` binary: `login`, `catalog list/get`, `debug`, and a full `darlane` command group (`sync`, `push`, `logs`, `restart`, `status`, `exec`, `port-forward`). `darlane sync` watches a local directory and streams changes into the Darlane pod in real time — colored startup summary, catalog pre-flight checks, tar probe with copy-paste `kubectl debug` hint for no-tar images, delete propagation, mount-path mismatch warning, rollout restart tip, and `--tail-logs` to stream pod output alongside sync events. `darlane push` runs a one-shot sync for CI pipelines. `darlane status` shows per-environment overlay, darlane flag, mount path, and image tag. Authenticated binary downloads served through the portal (`/api/v1/cli/download/:platform`) so users never need direct Gitea access. Usable in CI/CD pipelines via `WXOPS_TOKEN` env var. Cross-platform binaries for Linux and macOS (amd64 / arm64).

## Architecture

### Request routing

```mermaid
flowchart LR
    Browser(["Browser"])

    subgraph img["Single Docker Image · supervisord"]
        nginx["nginx\n:80"]
        go["Go backend\n:8080 · Gin"]
        nextjs["Next.js\n:3000 · App Router"]
    end

    subgraph platform["Platform"]
        hub["Hub Cluster\nPinniped Supervisor\nwxops-system Secrets"]
        spokes["Spoke Clusters\nPinniped Concierge\nJWTAuthenticator"]
        gitea["Gitea\ngitops-infra · catalog"]
        argocd["ArgoCD"]
    end

    Browser --> nginx
    nginx -->|"/auth/* · /api/v1/*"| go
    nginx -->|"/api/* · /*"| nextjs

    go -->|"OIDC discovery\ntoken exchange"| hub
    go -->|"K8s API\nuser credentials"| spokes
    go -->|"catalog read\nPR write"| gitea
    gitea -->|"webhook"| argocd
    argocd -->|"reconcile"| spokes
```

All three processes run inside a **single Docker image** managed by supervisord. There is no separate frontend container — nginx, Go, and Next.js share one image and communicate on loopback.

### BFF Proxy pattern

The frontend uses a Backend-for-Frontend (BFF) proxy to bridge the gap between browser-side JavaScript and the Go backend:

- `BACKEND_URL` resolves to `http://127.0.0.1:8080` inside the container — the browser cannot reach this address directly
- The `wxops_session` cookie is `HttpOnly` — browser JavaScript cannot read it, so it cannot attach it to direct Go API calls
- `src/app/api/` contains Next.js Route Handlers that run server-side: they read the session cookie via `next/headers`, forward it to Go as a `Cookie:` header, and return the response. The browser only ever talks to Next.js.

```mermaid
sequenceDiagram
    participant B as Browser
    participant N as nginx
    participant SC as Next.js Server Component
    participant BFF as Next.js Route Handler<br/>(src/app/api/)
    participant G as Go Backend :8080

    Note over SC,G: Path A — Server Component (catalog pages, cluster list)
    SC->>G: GET /api/v1/… · Cookie: wxops_session=…
    G-->>SC: JSON
    SC-->>B: rendered HTML

    Note over B,G: Path B — Client Component (wizard, cluster tabs, CI cards)
    B->>N: GET /api/… · credentials: include
    N->>BFF: forward
    Note right of BFF: reads wxops_session<br/>via next/headers
    BFF->>G: GET /api/v1/… · Cookie: wxops_session=…
    G-->>BFF: JSON
    BFF-->>B: JSON
```

Server Components (catalog pages, cluster list) bypass the BFF entirely — they run on the Next.js server and call `BACKEND_URL` directly at render time, forwarding the session cookie explicitly.

### Frontend stack

| Layer | Package | Role |
|---|---|---|
| Framework | Next.js 16 (App Router), React 19 | Server components, streaming, file-based routing |
| UI primitives | `@base-ui/react` | Unstyled, accessible headless components |
| Styling | Tailwind CSS v4 | All visual design — utility classes only, no CSS modules |
| Variants | `class-variance-authority` | `cva()` for button/badge size and color variants |
| Class merge | `clsx` + `tailwind-merge` → `cn()` | Safe Tailwind class composition |
| Icons | `lucide-react` | SVG icon set — icons only, not a component library |
| Toasts | `sonner` | Notification system |
| Theme | `next-themes` | System-aware light/dark mode |
| Fonts | Geist Sans + Geist Mono | Loaded via `next/font/google` |
| Diagrams | `mermaid` v11 | Dependency graphs, sequence diagrams |
| OpenAPI | `swagger-ui-dist` | Imperative UMD mount — no React wrapper or peer dep issues |
| Markdown | `react-markdown` + `remark-gfm` | Doc viewer, RFC/ADR rendering |
| YAML | `js-yaml` | OpenAPI spec parsing, edit-config YAML preview |

The `src/components/ui/` directory contains **source files owned by this repo** — they wrap Base UI primitives with Tailwind styling. Use `npx shadcn@latest add <component>` to generate additional ones (the `shadcn` CLI is not in `package.json`; run it with `npx`).

### Backend stack

| Layer | Package | Role |
|---|---|---|
| Framework | `gin-gonic/gin` v1.10 | HTTP router, middleware, request binding |
| OIDC / Auth | `coreos/go-oidc/v3` + `golang.org/x/oauth2` | PKCE flow with Pinniped Supervisor as the IdP |
| Session | Custom AES-256-GCM encrypted cookie | Stateless — no Redis, no database; key is `SESSION_SECRET` |
| Kubernetes | `k8s.io/client-go` v0.31 | Hub cluster Secret discovery + spoke cluster API calls |
| YAML | `gopkg.in/yaml.v3` | Manifest generation, catalog entity parsing |
| Config | `joho/godotenv` | `.env` file loader for local dev (real env vars win) |
| Swagger | `swaggo/gin-swagger` + `swaggo/swag` | Annotation-driven spec generation — disabled by default |

**Custom clients (no third-party SDK):**

| Client | Package | Notes |
|---|---|---|
| Gitea | `internal/gitea/` | Plain HTTP + JSON against the Gitea REST API |
| Vault | `internal/vault/` | KV v2 write-only — no Vault SDK; no reads or deletes |

**Internal packages:**

| Package | Responsibility |
|---|---|
| `internal/auth/` | OIDC client, AES-256-GCM session manager, `RequireSession` middleware |
| `internal/catalog/` | Entity store with 5-min in-process cache; local-dir and Gitea readers |
| `internal/cluster/` | Cluster registry (static JSON or K8s Secret discovery), Pinniped token exchange |
| `internal/config/` | All env var loading via `config.Load()` — single source of truth |
| `internal/gitea/` | Gitea API methods: repo CRUD, file commits, PR creation, CI/package queries |
| `internal/handlers/` | Gin route handlers: `auth.go`, `catalog.go`, `clusters.go`, `scaffold.go`, `cli.go` |
| `internal/scaffold/` | Manifest generators: XTenantApp, XTenantDatabase, ExternalSecret, Kustomize overlays, Image Updater CR, catalog entities |
| `internal/server/` | Gin engine setup, route registration, CORS middleware |
| `internal/vault/` | Vault KV v2 HTTP client — create/update only |

### CLI stack (`cli/`)

Standalone Go module (`github.com/wxops/wxops-cli`) — separate `go.mod`, cross-compiled for Linux and macOS (amd64 / arm64).

| Layer | Package | Role |
|---|---|---|
| Commands | `spf13/cobra` v1.10 | Subcommand tree, flag parsing, help text |
| File watching | `fsnotify/fsnotify` v1.7 | Cross-platform inotify/kqueue watcher for `darlane sync` |
| Portal API | `internal/client/` | Plain HTTP + JSON client — shares the `wxops_session` cookie model |
| Auth | `internal/client/credentials.go` | Token stored at `~/.wxops/credentials.json`; `WXOPS_TOKEN` env var for CI |
| Session state | `~/.wxops/darlane-<service>-<env>.json` | Persists `--local`/`--remote`/`--exclude` across `sync`, `push`, `restart` |
| Sync transport | `kubectl exec tar xf -` pipe | No daemon — tar pipe into the pod via `kubectl exec`; requires `tar` in the image |

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
| Golden-path git flow (branches, CI, imsage tags) | [docs/golden-path-git-flow.md](docs/golden-path-git-flow.md) |
| Lifecycle webhook (CI in gitops-infra → portal) | [docs/lifecycle-webhook.md](docs/lifecycle-webhook.md) |
| Cross-environment promotion design | [docs/cross-environment-promotion.md](docs/cross-environment-promotion.md) |
| Cluster registry (K8s Secrets + clusters.json) | [docs/cluster-registry.md](docs/cluster-registry.md) |
| Documentation strategy (RFC, ADR, Runbook) | [docs/documentation-strategy.md](docs/documentation-strategy.md) |
| Performance (cache layers, TTLs, polling, scaling) | [docs/performance.md](docs/performance.md) |
| Local development | [docs/local-development.md](docs/local-development.md) |
| Container design (nginx, supervisord, Dockerfile) | [docs/container.md](docs/container.md) |
| CLI (`wxops` binary — login, catalog, debug) | [docs/cli.md](docs/cli.md) |
| Darlane — per-environment parallel debug pods | [docs/darlane.md](docs/darlane.md) |
| API reference | [docs/api-reference.md](docs/api-reference.md) |
| Release workflow | [docs/release-workflow.md](docs/release-workflow.md) |
| Roadmap & architecture decisions | [ROADMAP.md](ROADMAP.md) |

## Roadmap

| Version | Goal | Status |
|---|---|---|
| v0.1.0 | Identity & multi-cluster SSO via Pinniped | `shipped` |
| v0.1.1–v0.1.2 | CI/CD pipeline, operations readiness | `shipped` |
| v0.1.3 | Full service catalog with relationship graphs | `shipped` |
| v0.1.4 | Catalog UI & visualization refinements | `shipped` |
| v0.2.0 | Golden-path scaffolding, CI/CD visibility, activity feed, cluster UX | `shipped` |
| v0.2.1 | Scaffolding fixes (Image Updater naming, nginx routing, Vault update) | `shipped` |
| v0.3.0 | Platform visibility — lifecycle promotion UI, FlexSearch command palette, catalog search, dark theme | `shipped` |
| v0.3.1 | Portal UI polish — entity detail two-column layout, docs drawer, build-time version stamping | `shipped` |
| v0.4.0 | CLI (`wxops` binary) + Darlane per-environment parallel debug pods + inner-loop tooling (Mirrord, `wxops darlane sync`) | `shipped` |
| v0.4.1 | Cluster view kubectl companion (pod detail drawer, services, quotas); `darlane sync` reliability (delete propagation, initial sync, retry); darlane inner-loop DX (startup summary, pre-flight checks, `push`/`logs`/`restart`/`status` subcommands, `--tail-logs`, tar probe + `kubectl debug` hint) | `shipped` |
| v0.4.2 | Add the route for CLI Versioning `GET /api/v1/cli/version` and update UI in overview for `CLI` and `docs-site` introduced | `shipped` |
| v0.5.0 | Runtime observability — ArgoCD/Crossplane XR status via Pinniped; Alertmanager active-alert surface; Grafana/Loki/Tempo deep links pre-scoped per service | `planned` |

See [ROADMAP.md](ROADMAP.md) for the full feature list and architecture decisions.

## Portal Scope

**The portal owns:** authentication, cluster visibility, service catalog, project scaffolding, config management via PR, kubeconfig download.

**The portal links to, never replaces:** Gitea (source, docs, RFCs, ADRs), ArgoCD (deployment status), Grafana (metrics), Vault UI (secrets).

**The portal never does:** direct cluster writes, Vault secret reads, gitops-infra URL exposure to developers, delete operations for tenant users.
