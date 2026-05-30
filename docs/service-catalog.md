# Service Catalog

The service catalog is a registry of all services, APIs, databases, and teams in the platform. It answers the questions developers actually ask: *What exists? Who owns it? What does it depend on? Where is the runbook?*

Catalog data lives in `gitops-infra/catalog/` in Gitea. The portal reads it on a 5-minute TTL cache — no push required, no catalog server to run.

---

## Entity Kinds

The catalog uses five entity kinds. Each kind maps to something concrete in the platform:

| Kind | Represents | Example |
|---|---|---|
| `System` | A bounded application made of multiple services | `payments`, `identity`, `platform` |
| `Component` | A single runnable service or application | `payments-service`, `auth-service` |
| `API` | An interface exposed or consumed by a component | `payments-api` (OpenAPI), `payments-events` (AsyncAPI) |
| `Resource` | Infrastructure a component depends on | `payments-db`, `session-cache`, `platform-vault` |
| `Group` | A team that owns services | `payments-team`, `identity-team` |

### How they relate

```
System ──── owns ────► Component ──── providesApis ────► API
                            │
                            └──── dependsOn ────► Resource
```

The portal renders these relationships as a per-system Mermaid graph on the system detail page. Edges are only drawn between entities within the same system — cross-system dependencies are linked via `consumesApis` on the component spec and shown as external references.

---

## Schema: Backstage-compatible YAML

Every entity file follows the `backstage.io/v1alpha1` envelope:

```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: payments-service
  title: Payments Service
  description: Synchronous payment processing — REST/gRPC API, PostgreSQL, Redis, Vault.
  tags: [go, grpc, payments]
  annotations:
    gitea/source-location: platform/payments-service
    jira/project-key: PAY
  links:
    - url: https://gitea.example.com/platform/payments-service/src/branch/main/docs/runbook.md
      title: Runbook
      type: documentation
    - url: https://gitea.example.com/platform/architecture/rfcs/rfc-001-kafka.md
      title: "RFC-001: Kafka for Payments Events"
      type: rfc
    - url: https://gitea.example.com/platform/architecture/docs/adr/adr-001-kafka.md
      title: "ADR-001: Kafka for Payments Events"
      type: adr
spec:
  type: service
  lifecycle: production          # experimental | production | deprecated
  owner: group:payments-team
  system: payments
  providesApis:
    - api:default/payments-api
    - api:default/payments-events
  consumesApis:
    - api:default/user-api
    - api:default/metrics-api
  dependsOn:
    - resource:default/payments-db
    - resource:default/payments-cache
    - resource:default/payments-vault
    - resource:default/payments-queue
```

---

## Why the Backstage Schema — but Not Backstage

The entity format (`backstage.io/v1alpha1`) is borrowed from the [Backstage software catalog](https://backstage.io/docs/features/software-catalog/descriptor-format). The Go backend parses it with `gopkg.in/yaml.v3` — no Backstage runtime, no Node.js catalog server, no plugin ecosystem.

### Why use this schema at all

**The entity model is proven.** Component, API, System, Group, Resource covers every real-world catalog use case without needing to invent a new vocabulary. Teams know what a `Component` is.

**Public documentation reduces internal docs burden.** When a developer asks "what fields does `spec.consumesApis` accept?", the answer is in Backstage's public docs — not in internal wikis that drift. The schema is well-specified and stable.

**Future portability.** If the platform ever adds a Backstage instance alongside this portal, the existing catalog YAML files are already compatible — no migration. This is not a goal today, but the option costs nothing to preserve.

### Why not run Backstage

**Third runtime.** The portal is already Go (backend) + Node.js (Next.js). Adding a Backstage Node.js server would be a third runtime with its own dependency chain, plugin versioning, and operational surface.

**Over-scoped for the use case.** Backstage is a full developer portal framework with plugins, scaffolder, TechDocs rendering, and its own auth layer. This portal already owns auth (Pinniped), scaffolding (Phase 3), and documentation linking (entity links). Running Backstage alongside would create two portals competing for the same developer attention.

**Parse, don't run.** The catalog benefit is the *data model*, not the *runtime*. A Go YAML parser reading `backstage.io/v1alpha1` files captures all the structural value — entity kinds, ownership, relationships, links — in ~200 lines of typed Go structs (`backend/internal/catalog/entity.go`). Parse time is under 5ms for a catalog of 50 entities.

### The Go implementation

The catalog backend is three files:

| File | Responsibility |
|---|---|
| `backend/internal/catalog/entity.go` | Typed Go structs matching the Backstage schema. `Validate()` enforces required fields per kind. |
| `backend/internal/catalog/store.go` | `RepoReader` interface + `Store` with 5-minute TTL cache. Iterates kind directories, decodes multi-document YAML. |
| `backend/internal/catalog/local.go` | `LocalReader` — reads from local filesystem for dev/testing without a live Gitea connection. |

The production reader (`backend/internal/gitea/client.go`) fetches files via Gitea's REST API using `GITEA_TOKEN`. The `Store` is indifferent to which reader it uses.

---

## RFC and ADR Linking

RFCs and ADRs live in Gitea (`platform/architecture/rfcs/` and `platform/architecture/docs/adr/`), not in the catalog. The catalog entity links to them via `metadata.links` with a `type` field:

```yaml
links:
  - url: https://gitea.example.com/platform/architecture/rfcs/rfc-001-kafka.md
    title: "RFC-001: Kafka for Payments Events"
    type: rfc
  - url: https://gitea.example.com/platform/architecture/docs/adr/adr-001-kafka.md
    title: "ADR-001: Kafka for Payments Events"
    type: adr
```

The portal entity detail page groups links by type — **RFCs** (violet), **ADRs** (blue), **Documentation** (default) — making decision history discoverable without embedding document content in the catalog.

The RFC → ADR lifecycle:
1. Open an RFC as a PR to `platform/architecture/rfcs/` with a linked Jira epic
2. RFC is reviewed and accepted — PR merged
3. Write the ADR in `platform/architecture/docs/adr/` capturing only the final decision
4. Link both from the relevant catalog entity `metadata.links`

---

## Directory Layout in gitops-infra

```
catalog/
├── systems/
│   ├── payments.yaml
│   ├── identity.yaml
│   ├── platform.yaml
│   └── observability.yaml
├── components/
│   ├── payments-service.yaml
│   ├── payments-worker.yaml
│   ├── auth-service.yaml
│   └── ...
├── apis/
│   ├── payments-api.yaml
│   ├── payments-events.yaml   # AsyncAPI kind
│   └── ...
├── resources/
│   ├── payments-db.yaml
│   ├── payments-cache.yaml
│   └── ...
└── groups/
    ├── payments-team.yaml
    ├── identity-team.yaml
    └── ...
```

The portal scans each subdirectory for `*.yaml` files. Multi-document YAML (multiple entities in one file separated by `---`) is supported.

Set `GITEA_CATALOG_PATH=catalog` in the backend environment. For local development without Gitea, set `CATALOG_LOCAL_DIR=./internal/catalog/examples` — the examples directory mirrors this layout and serves as the reference for what a complete catalog looks like.

---

## Cache Behaviour

The catalog store caches all entities in memory with a 5-minute TTL. This means:

- Adding a new entity file to `gitops-infra/catalog/` is visible in the portal within 5 minutes — no portal restart needed.
- Removing or renaming an entity is reflected within 5 minutes.
- On cache miss the store fetches all entity files from Gitea in one pass and rebuilds the in-memory index.

The cache is intentionally simple — no invalidation webhook, no push mechanism. For a catalog that changes infrequently (new services are added through the Phase 3 scaffold, not manually), a 5-minute TTL is the right trade-off.
