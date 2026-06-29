# WxOps Portal

An Internal Developer Portal built on Kubernetes-native tooling. One login,
one catalog, one place to scaffold, observe, and manage services across
environments.

---

## Why This Exists

In the AI era, a developer can scaffold, implement, and ship a service in a
single day. The bottleneck isn't writing code anymore — it's **context**.

When a new team member joins on day 2, they inherit a system built on day 1
by someone who may have already moved on. Without a portal, they ask:
"What is this service? Why was it built this way? What does it depend on?
Is it running? Where are the secrets? Who owns it?"

The answers live in Slack threads, meeting notes, tribal knowledge, and
half-written wikis. They rot within weeks.

WxOps Portal makes the **entire project lifecycle self-documenting**:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Project Lifecycle in Portal                     │
│                                                                     │
│  Planning          Development         Staging          Production  │
│  ─────────         ───────────         ───────          ──────────  │
│                                                                     │
│  RFC: WHY build    Scaffold: WHAT      Promotion:       Release:    │
│  this service?     template, runtime,  WHO approved?    WHAT version│
│                    features chosen     WHEN promoted?   is live?    │
│                                                                     │
│  ADR: WHY these    Git-flow: HOW       Config diff:     Health:     │
│  tech decisions?   code flows          WHAT changed     IS it       │
│                    develop→staging→    between envs?    healthy?    │
│                    main                                             │
│                                                                     │
│  Runbook: HOW to   CI/CD: IS the      ArgoCD status:   Packages:   │
│  operate this?     build passing?      IS it synced?    WHAT deps?  │
│                                                                     │
│  lifecycle:        lifecycle:          lifecycle:       lifecycle:   │
│  experimental      development         staging          production  │
└─────────────────────────────────────────────────────────────────────┘
```

Every question a day-2 member asks is answered by something the portal
already tracks — not because someone documented it manually, but because
the golden path captured it automatically:

| Day-2 question | Portal answers with |
|----------------|-------------------|
| What is this service? | Catalog entity: description, owner, system, type |
| Why was it built this way? | RFC and ADR docs linked via `relatedTo` |
| What template was used? | Scaffold info card: template-id, scaffold date |
| What does it depend on? | Relationships: dependsOn, consumesApis |
| Is it running? | ArgoCD sync status via Pinniped (per environment) |
| What version is deployed? | CI/CD card: latest image tags per branch |
| Where are the secrets? | Vault path annotation (write-only, no exposure) |
| How do I operate it? | Runbook doc linked to the component |
| Who owns it? | Owner field → team, with team members listed |
| What happened before I joined? | Activity feed: PRs, promotions, config changes |

The portal doesn't replace good engineering practices — it makes them
**automatic**. The golden path ensures every service starts with the right
structure, the right docs, the right CI/CD, and the right observability.
The lifecycle model tracks how it moves through environments. The catalog
ties it all together in one searchable, navigable, team-scoped view.

---

## How It Fits Together

```
                                 Developer
                                    │
                                    ▼
                          ┌─────────────────┐
                          │   WxOps Portal   │
                          │  Next.js + Go    │
                          └────────┬─────────┘
                                   │
                 ┌─────────────────┼─────────────────┐
                 │                 │                  │
                 ▼                 ▼                  ▼
          ┌──────────┐     ┌──────────┐      ┌──────────────┐
          │  Gitea   │     │  Vault   │      │  Kubernetes  │
          │          │     │          │      │  (Pinniped)  │
          └────┬─────┘     └──────────┘      └──────┬───────┘
               │                                    │
       ┌───────┼───────┐                   ┌────────┼────────┐
       │       │       │                   │        │        │
       ▼       ▼       ▼                   ▼        ▼        ▼
     App    GitOps  Templates           ArgoCD  Crossplane  Workloads
     Repos  Infra   Repo                Apps    XRs         Pods
```

| System | Role | Portal Interaction |
|--------|------|--------------------|
| **Gitea** | Git hosting, CI/CD (Actions), container registry | Read repos, commits, PRs, workflow runs, releases, packages. Write: create repos, commit files, open PRs |
| **Vault** | Secret management | Write-only: create/update secrets. No read, no delete |
| **Pinniped** | SSO + K8s authentication | User login (OIDC/PKCE), session. User's token proxied to K8s API for cluster reads |
| **ArgoCD** | GitOps continuous delivery | Read Application CRs via K8s API (sync status, health, deployed images) |
| **Crossplane** | Infrastructure provisioning | XTenantApp, XTenantDatabase CRs. Read status via K8s API |
| **Kubernetes** | Runtime platform | Read-only from portal — pods, services, ingress status via Pinniped credentials |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Hub Cluster                                │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Pinniped          │  │ Portal       │  │ ArgoCD                 │ │
│  │ Supervisor        │  │ Go + Next.js │  │ ApplicationSet         │ │
│  │                   │  │              │  │ per team/app/env       │ │
│  │ FederationDomain  │  │ Catalog      │  │                        │ │
│  │ OIDCClient        │  │ Scaffold     │  │ Image Updater          │ │
│  └──────────────────┘  │ Activity     │  └────────────────────────┘ │
│           │             │ Cluster View │                              │
│           │             └──────────────┘         ┌─────────────────┐ │
│           │                    │                  │ Crossplane       │ │
│           │                    │                  │ XTenantApp       │ │
│           │                    │                  │ XTenantDatabase  │ │
│           ▼                    ▼                  └─────────────────┘ │
│  ┌──────────────────────────────────────┐                            │
│  │           Kubernetes API              │                            │
│  │  RBAC scoped per user (Pinniped)      │                            │
│  └──────────────────────────────────────┘                            │
│                          │                                            │
│              ┌───────────┼───────────┐                                │
│              ▼           ▼           ▼                                │
│         Spoke A      Spoke B      Spoke C                            │
│        Concierge    Concierge    Concierge                           │
│        Workloads    Workloads    Workloads                            │
└──────────────────────────────────────────────────────────────────────┘

External:
  ┌──────────┐   ┌──────────┐
  │  Gitea   │   │  Vault   │
  │  Repos   │   │  Secrets │
  │  CI/CD   │   │          │
  │  Registry│   │          │
  └──────────┘   └──────────┘
```

**Auth model:** One login via Pinniped. The portal session cookie carries the
user's tokens. For Gitea/Vault, the backend uses service tokens. For Kubernetes
reads, the portal forwards the user's own Pinniped credentials — RBAC controls
what each user can see. No per-cluster service accounts.

See [architecture.md](architecture.md) for the full auth sequence, hub-spoke
topology, and token exchange flow.

---

## Core Features

### Service Catalog

A registry of all services, APIs, databases, teams, and documentation.
Catalog data lives in `gitops-infra/service-catalog/` as YAML files.
The portal reads them via Gitea API with a 5-minute cache.

```
System ──── owns ────► Component ──── providesApis ────► API
                            │
                            ├──── dependsOn ────► Resource (database, vault)
                            │
                            └──── relatedTo ────► Doc (RFC, ADR, Runbook)
```

- 7 entity kinds: System, Component, API, Resource, Group, User, Doc
- Ownership and relationship graph
- Lifecycle tracking (experimental → development → production)
- CI/CD status, releases, container images, dependency tracking per entity

See [service-catalog.md](service-catalog.md) and
[catalog-user-guide.md](catalog-user-guide.md).

### Golden-Path Scaffolding

One-click project creation from curated templates:

1. Choose template (runtime, version, package manager)
2. Configure (name, team, features: vault, database, ingress, API, monitoring)
3. Portal creates: Gitea repo, XTenantApp manifests, catalog entities, vault secrets
4. Opens a PR to `gitops-infra` for platform review
5. On merge: ArgoCD syncs, Crossplane provisions, first CI build runs

Git-flow branching: `develop` (default, CI builds `dev-*` images) →
`staging` (RC tags) → `main` (production releases).

See [golden-path-git-flow.md](golden-path-git-flow.md).

### Documentation

ADR, RFC, and Runbook entities linked to catalog components. Documents are
`Doc` kind entities with `relatedTo` references. The portal renders them
alongside the services they describe.

See [documentation-strategy.md](documentation-strategy.md).

### Cluster Registry

Multi-cluster visibility via Pinniped hub-spoke topology. The portal discovers
spoke clusters from hub secrets and proxies K8s API calls using the user's
Pinniped credentials. Each cluster shows namespaces, workloads, and node status.

See [cluster-registry.md](cluster-registry.md).

---

## Data Flow

### Scaffold → Deploy → Observe

```
Developer                Portal                Gitea              Cluster
    │                      │                     │                   │
    │  Create Project      │                     │                   │
    ├─────────────────────►│                     │                   │
    │                      │  Create repo        │                   │
    │                      ├────────────────────►│                   │
    │                      │  Push template      │                   │
    │                      ├────────────────────►│ develop branch    │
    │                      │  Open PR (gitops)   │                   │
    │                      ├────────────────────►│ gitops-infra PR   │
    │                      │  Write secrets      │                   │
    │                      ├──────────────────────────────────────► Vault
    │                      │                     │                   │
    │                      │              PR merged                  │
    │                      │                     │  ArgoCD syncs     │
    │                      │                     ├──────────────────►│
    │                      │                     │  Crossplane       │
    │                      │                     │  provisions       │
    │                      │                     │  XTenantApp       │
    │                      │                     │  XTenantDatabase  │
    │                      │                     │                   │
    │  View in Catalog     │                     │                   │
    ├─────────────────────►│                     │                   │
    │                      │  Read entity YAML   │                   │
    │                      ├────────────────────►│                   │
    │                      │  Read CI/releases   │                   │
    │                      ├────────────────────►│                   │
    │                      │  Read ArgoCD status  │                  │
    │                      ├──────────────────────────────────────►  │
    │                      │  (via Pinniped)      │                  │
    │◄─────────────────────┤                     │                   │
    │  Entity + status     │                     │                   │
```

### Security Boundaries

| Action | Auth | Boundary |
|--------|------|----------|
| Login | Pinniped OIDC (PKCE) | Portal session cookie |
| Read catalog entities | Gitea API (service token) | Team-scoped in backend |
| Read CI/releases/packages | Gitea API (service token) | Per-repo via entity annotation |
| Write repo/PR/commit | Gitea API (service token) | Team membership check |
| Write vault secrets | Vault API (service token) | Write-only, existence check first |
| Read K8s resources | K8s API (user's Pinniped token) | RBAC per user |
| Read ArgoCD status | K8s API (user's Pinniped token) | RBAC per user |
| Read Crossplane XR status | K8s API (user's Pinniped token) | RBAC per user |
| Write to cluster | **Never** | Portal is read-only for clusters |
| Delete resources | **Platform-team only** | Not exposed in portal UI for tenants |

---

## Documentation Index

### Setup & Operations

| Document | Description |
|----------|-------------|
| [architecture.md](architecture.md) | Auth model, hub-spoke topology, Pinniped integration |
| [deployment.md](deployment.md) | Helm chart, container builds, production deployment |
| [container.md](container.md) | Docker build, multi-stage image |
| [environment-variables.md](environment-variables.md) | All backend config vars |
| [local-development.md](local-development.md) | Dev setup, local catalog, scaffold testing |
| [release-workflow.md](release-workflow.md) | Versioning, changelog, git-cliff |

### Features

| Document | Description |
|----------|-------------|
| [service-catalog.md](service-catalog.md) | Entity kinds, relationships, data model |
| [catalog-user-guide.md](catalog-user-guide.md) | YAML field reference, annotation keys, examples |
| [golden-path-git-flow.md](golden-path-git-flow.md) | Branch model, CI pipeline, promotion flow |
| [lifecycle-webhook.md](lifecycle-webhook.md) | ArgoCD webhook for automatic lifecycle promotion, trust chain, validation |
| [documentation-strategy.md](documentation-strategy.md) | ADR, RFC, Runbook strategy and rendering |
| [cluster-registry.md](cluster-registry.md) | Multi-cluster discovery and status |

### API

| Document | Description |
|----------|-------------|
| [api-reference.md](api-reference.md) | REST API endpoints, request/response formats |

### Strategy & Roadmap

| Document | Description |
|----------|-------------|
| [ROADMAP.md](ROADMAP.md) | Release history, current branch status, versioned plans (v0.2.0 → v0.4.0+), architecture decisions |
| [platform-engineering-rationale.md](platform-engineering-rationale.md) | Why Crossplane + Portal + Golden Path: tradeoffs, complexity analysis, business case, proving the model |
| [cross-environment-promotion.md](cross-environment-promotion.md) | Enterprise feature design: per-environment config, lifecycle-driven promotion, ArgoCD+Pinniped status |

---

## Technology Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | Next.js (App Router) | Server-side rendering, BFF proxy pattern, streaming with Suspense |
| Backend | Go (Gin) | Fast, single binary, native K8s client support |
| Git hosting | Gitea | Self-hosted, API-compatible, Actions CI, container registry |
| Auth | Pinniped | K8s-native SSO, hub-spoke multi-cluster, RBAC-scoped |
| Secrets | HashiCorp Vault | External Secrets Operator integration, write-only from portal |
| GitOps | ArgoCD + ApplicationSet | Declarative, per-environment Applications from git directories |
| Infrastructure | Crossplane | XTenantApp, XTenantDatabase CRDs — K8s-native provisioning |
| Catalog format | Backstage-compatible YAML | Industry standard entity schema, portable |
