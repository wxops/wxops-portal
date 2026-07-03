# Service Catalog — YAML User Guide

This guide is the authoritative reference for writing catalog entity files in the W'xOps platform. It covers every entity kind, every field, all annotation keys, link types, and the WxOps-specific extensions that go beyond the standard Backstage schema.

For the design rationale and Go implementation details, see [service-catalog.md](service-catalog.md).

---

## Table of Contents

- [The YAML Envelope](#the-yaml-envelope)
- [Entity Kinds at a Glance](#entity-kinds-at-a-glance)
- [Common Metadata Fields](#common-metadata-fields)
- [Annotations Reference](#annotations-reference)
- [Links — Types and Icons](#links--types-and-icons)
- [Entity Reference Format](#entity-reference-format)
- [Kind: System](#kind-system)
- [Kind: Component](#kind-component)
- [Kind: API](#kind-api)
- [Kind: Resource](#kind-resource)
- [Kind: Group](#kind-group)
- [Kind: User](#kind-user)
- [Kind: Doc](#kind-doc)
- [Validation Rules](#validation-rules)
- [OpenAPI Spec Linking](#openapi-spec-linking)
- [Directory Layout](#directory-layout)

---

## The YAML Envelope

Every catalog entity file starts with the same four top-level keys:

```yaml
apiVersion: backstage.io/v1alpha1   # or wxops.cloud/v1alpha1 for Doc
kind: Component                      # System | Component | API | Resource | Group | User | Doc
metadata:
  name: my-service                   # required — used in API paths and entity refs
  # ... more metadata fields
spec:
  # ... kind-specific fields
```

**`apiVersion`** — Use `backstage.io/v1alpha1` for all standard kinds (System, Component, API, Resource, Group, User). Use `wxops.cloud/v1alpha1` for the `Doc` kind, which carries WxOps-specific fields not present in the Backstage schema.

**`kind`** — One of the seven supported kinds. Case-sensitive.

One file can contain multiple entities separated by `---`:

```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: payments-service
spec:
  # ...
---
apiVersion: backstage.io/v1alpha1
kind: API
metadata:
  name: payments-api
spec:
  # ...
```

---

## Entity Kinds at a Glance

| Kind | apiVersion | Required spec fields | Portal rendering |
|---|---|---|---|
| `System` | `backstage.io/v1alpha1` | `owner` | System page with Mermaid dependency graph |
| `Component` | `backstage.io/v1alpha1` | `type`, `owner`, `lifecycle` | Entity page with relationships, links, workload status |
| `API` | `backstage.io/v1alpha1` | `type`, `owner`, `lifecycle` | Entity page with embedded Swagger/AsyncAPI viewer |
| `Resource` | `backstage.io/v1alpha1` | `type`, `owner`, `lifecycle` | Entity page, appears in system graph |
| `Group` | `backstage.io/v1alpha1` | `type` | Team page listing members and owned entities |
| `User` | `backstage.io/v1alpha1` | `name` only | User profile card |
| `Doc` | `wxops.cloud/v1alpha1` | `owner`, `docType` | Document page with rendered Markdown |

---

## Common Metadata Fields

These fields apply to every entity kind.

```yaml
metadata:
  name: payments-service          # required — lowercase, hyphens only, unique per kind
  namespace: default              # optional — defaults to "default"; rarely needed
  title: Payments Service         # optional — human-readable display name
  description: |                  # optional — shown on the entity card and detail page
    Handles payment transactions via REST.
  tags:                           # optional — filterable labels, lowercase
    - go
    - payments
    - rest
  labels:                         # optional — arbitrary key/value for tooling/scripts
    team: rocket-team
    cost-centre: "payment-ops"
  annotations:                    # optional — see Annotations Reference below
    gitea/source-location: rocket-team/payments-service
  links:                          # optional — see Links section below
    - url: https://gitea.example.com/rocket-team/payments-service
      title: Source Code
      type: gitea
```

### `name` rules

- Lowercase letters, digits, and hyphens only: `payments-service`, `portal-api`, `rfc-001-kafka`
- Must be unique within its kind — the portal uses `kind/name` as the unique key
- Used in entity ref format: `component:default/payments-service`

---

## Annotations Reference

Annotations are key/value string pairs in `metadata.annotations`. They carry tool-specific metadata and drive portal features.

### Standard annotations (Backstage-compatible)

| Key | Value format | Purpose |
|---|---|---|
| `gitea/source-location` | `<org>/<repo>` | Links the entity to its Gitea repository. Displayed on the entity page. |
| `jira/project-key` | `PAY` | Links to the team's Jira project. |
| `github/project-slug` | `org/repo` | Links to a GitHub repository if the source is mirrored. |

### WxOps platform annotations (`wxops.cloud/`)

| Key | Value format | Purpose |
|---|---|---|
| `wxops.cloud/cluster-id` | `prod-east` | Links this Component to a registered cluster ID. Used to show live workload status on the entity page (Phase 2.3). |
| `wxops.cloud/vault-path` | `team/appName/env` | Vault KV path where the app's runtime secrets live. The portal **Update Secrets** action reads this annotation to derive the correct repo name and Vault path — never uses the entity name directly. Vault Resource entities are named `{appName}-vault` in the catalog, so the annotation is the authoritative source of the underlying `appName`. Generated automatically by the scaffold wizard. |

### Kubernetes workload annotations (`kubernetes.io/`)

These annotations wire a catalog Component to its live Kubernetes workload. Both must be present for the portal to fetch live pod/deployment data.

| Key | Value format | Purpose |
|---|---|---|
| `kubernetes.io/cluster` | `prod-east` | The cluster ID (must match a registered cluster). |
| `kubernetes.io/deployment` | `payments-service` | The Deployment name in the target namespace. |

**Example:**
```yaml
annotations:
  wxops.cloud/cluster-id: prod-east
  kubernetes.io/cluster: prod-east
  kubernetes.io/deployment: payments-service
```

> **Note:** `kubernetes.io/cluster` and `kubernetes.io/deployment` are used by the portal in Phase 2.3 (Operational Depth) to fetch live pod count, image tag, and deployment health. They have no effect in the current release.

---

## Links — Types and Icons

Links appear on the entity detail page, grouped by type.

```yaml
links:
  - url: https://gitea.example.com/org/repo/runbook.md
    title: Runbook
    type: documentation
    icon: docs
```

### `type` values

The `type` field controls how the portal groups and styles the link.

| type | Rendered section | Colour / style |
|---|---|---|
| `documentation` | Resources | Default |
| `rfc` | RFCs | Violet |
| `adr` | ADRs | Blue |
| `openapi` | *(not shown as a link — drives the embedded Swagger UI instead)* | — |
| `gitea` | Resources | Default |
| `dashboard` | Resources | Default |

Links with `type: openapi` are handled specially — the portal fetches the spec from the URL and renders it inline as a Swagger UI viewer. See [OpenAPI Spec Linking](#openapi-spec-linking).

### `icon` values

The `icon` field is a hint to the frontend for the link icon. Optional.

| icon | When to use |
|---|---|
| `api` | API specification files, Swagger links |
| `dashboard` | Grafana, Kibana, or other dashboards |
| `docs` | Documentation, runbooks |

---

## Entity Reference Format

Relationship fields (`dependsOn`, `providesApis`, `consumesApis`, `relatedTo`, `supersededBy`, `members`, `memberOf`, `parent`, `children`) use a canonical reference format:

```
kind:namespace/name
```

- **kind** — lowercase entity kind: `component`, `api`, `resource`, `group`, `user`, `doc`, `system`
- **namespace** — almost always `default`; omit it only if using custom namespaces
- **name** — the `metadata.name` of the target entity

**Examples:**
```yaml
dependsOn:
  - resource:default/payments-db
  - component:default/auth-service
consumesApis:
  - api:default/auth-api
relatedTo:
  - component:default/payments-service
supersededBy: doc:default/adr-001-kafka-for-payments
owner: group:platform-team       # owner uses the same format
author: user:alice
```

---

## Kind: System

A System is a bounded domain that groups related Components, APIs, and Resources. It is the top-level unit in the dependency graph.

```yaml
apiVersion: backstage.io/v1alpha1
kind: System
metadata:
  name: payments
  title: Payments System
  description: Handles all payment transactions, subscriptions, and refunds.
  tags: [payments, fintech]
spec:
  owner: group:rocket-team       # required
  domain: fintech                # optional — groups systems into a higher-level domain
```

### `spec` fields

| Field | Required | Description |
|---|---|---|
| `owner` | yes | Group or user ref who owns this system. Format: `group:<name>` or `user:<name>` |
| `domain` | no | Groups multiple systems into a domain (e.g. `fintech`, `platform`, `identity`) |

---

## Kind: Component

A Component is a single runnable unit — a service, website, library, or pipeline.

```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: payments-service
  title: Payments Service
  description: Handles payment transactions via REST API.
  tags: [go, rest, payments]
  annotations:
    gitea/source-location: rocket-team/payments-service
    wxops.cloud/cluster-id: prod-east
  links:
    - url: https://gitea.example.com/rocket-team/payments-service/runbook.md
      title: Runbook
      type: documentation
      icon: docs
    - url: https://gitea.example.com/rocket-team/rfcs/rfc-001-kafka.md
      title: "RFC-001: Kafka for Payments Events"
      type: rfc
    - url: https://gitea.example.com/rocket-team/adrs/adr-001-kafka.md
      title: "ADR-001: Adopt Kafka"
      type: adr
spec:
  type: service                  # required — see type values below
  lifecycle: production          # required — experimental | production | deprecated
  owner: group:rocket-team       # required
  system: payments               # optional — associates with a System
  providesApis:                  # optional — API refs this component exposes
    - api:default/payments-api
  consumesApis:                  # optional — API refs this component calls
    - api:default/auth-api
  dependsOn:                     # optional — resource or component refs
    - resource:default/payments-db
    - resource:default/payments-cache
    - resource:default/payments-vault
```

### `spec.type` values

| type | Meaning |
|---|---|
| `service` | A backend service (REST, gRPC, worker, daemon) |
| `website` | A frontend or full-stack web application |
| `library` | A shared library or SDK consumed by other components |
| `pipeline` | A data pipeline, ETL job, or batch processor |

### `spec.lifecycle` values

| lifecycle | Meaning |
|---|---|
| `experimental` | In active development, may break or change |
| `production` | Stable, in use by real users or systems |
| `deprecated` | Scheduled for removal; stop creating new dependencies on this |

---

## Kind: API

An API entity represents an interface — REST, gRPC, event stream, or GraphQL — exposed by a Component. The portal can render the spec inline using its embedded Swagger UI.

```yaml
apiVersion: backstage.io/v1alpha1
kind: API
metadata:
  name: payments-api
  title: Payments API
  description: REST API for initiating and querying payment transactions.
  tags: [rest, payments, openapi]
  links:
    # Static committed spec — works in all environments (recommended)
    - url: rocket-team/apis/payments-openapi.json
      title: OpenAPI Spec
      type: openapi
      icon: api
spec:
  type: openapi                  # required — see type values below
  lifecycle: production          # required
  owner: group:rocket-team       # required
  system: payments               # optional
  definition: |                  # optional — inline spec (use links instead for large specs)
    openapi: "3.0.0"
    info:
      title: Payments API
      version: "1.0"
    paths: {}
```

### `spec.type` values

| type | Protocol | Portal rendering |
|---|---|---|
| `openapi` | REST (OpenAPI 2 / 3) | Swagger UI with dark mode |
| `grpc` | gRPC (Protobuf) | Link shown; no inline renderer |
| `asyncapi` | Event streams (AsyncAPI) | Link shown; no inline renderer (planned) |
| `graphql` | GraphQL | Link shown; no inline renderer |

### Inline definition vs linked spec

For small specs or local testing, `spec.definition` accepts the raw YAML/JSON inline.
For anything going to production, commit the spec file to the catalog repo and reference it with a relative path link (see [OpenAPI Spec Linking](#openapi-spec-linking)).

---

## Kind: Resource

A Resource is infrastructure that Components depend on — databases, caches, secret stores, queues, repositories.

```yaml
apiVersion: backstage.io/v1alpha1
kind: Resource
metadata:
  name: payments-db
  title: Payments PostgreSQL
  description: Primary PostgreSQL instance for the payments system.
  tags: [postgres, database, payments]
  annotations:
    wxops.cloud/cluster-id: prod-east
spec:
  type: database                 # required — see type values below
  lifecycle: production          # required
  owner: group:rocket-team       # required
  system: payments               # optional
  dependsOn:                     # optional — other resources this one depends on
    - resource:default/payments-vault
```

### `spec.type` values

| type | Examples |
|---|---|
| `database` | PostgreSQL, MySQL, CockroachDB |
| `cache` | Redis, Memcached |
| `queue` | NATS, Kafka topic, RabbitMQ |
| `vault` | HashiCorp Vault mount or secret path |
| `repository` | Gitea/GitHub repository (source, gitops-infra) |
| `s3` | Object storage bucket |

---

## Kind: Group

A Group represents a team or organisational unit. It owns Systems, Components, APIs, and Resources.

```yaml
apiVersion: backstage.io/v1alpha1
kind: Group
metadata:
  name: rocket-team
  title: Rocket Team
  description: Owns the payments system and all related services.
  tags: [payments, fintech]
spec:
  type: team                     # required — team | department | organisation
  parent: group:engineering      # optional — parent group for nested org structures
  children:                      # optional — sub-group refs
    - group:payments-infra-team
  members:                       # optional — user refs
    - user:alice
    - user:bob
```

### `spec.type` values

| type | Meaning |
|---|---|
| `team` | A squad or product team |
| `department` | A department that contains multiple teams |
| `organisation` | The top-level organisation root |

---

## Kind: User

A User represents a person on the platform. Users are referenced from Group `members` and Doc `author` fields.

```yaml
apiVersion: backstage.io/v1alpha1
kind: User
metadata:
  name: alice                    # required — lowercase, matches git/SSO username
  title: Alice Nguyen            # optional — display name
  description: Backend engineer on the rocket team.
spec:
  memberOf:                      # optional — group refs
    - group:rocket-team
  email: alice@example.com       # optional
```

No `lifecycle` or `type` field for User — the only required field is `metadata.name`.

---

## Kind: Doc

`Doc` is a WxOps-specific entity kind that represents a living document: an RFC, ADR, runbook, architecture guide, or any markdown file tracked alongside catalog entities. It uses `apiVersion: wxops.cloud/v1alpha1`.

The portal renders the document's markdown inline by fetching `spec.contentUrl`. The document's relationship to components and its review lifecycle are tracked in the spec.

**Write path:** Doc entities created or updated via the portal are committed directly to `gitops-infra/catalog/` on `main` — no PR required. The `spec.draft` flag controls visibility while the document is being written. Other entity kinds (Component, API, etc.) still go through a PR.

### RFC example

```yaml
apiVersion: wxops.cloud/v1alpha1
kind: Doc
metadata:
  name: rfc-001-kafka-for-payments
  title: "RFC-001: Kafka for Payments Events"
  description: Proposes replacing direct REST calls with Kafka for durability and decoupling.
  tags: [kafka, payments, rfc, messaging]
  links:
    - url: https://gitea.example.com/rocket-team/architecture/rfcs/rfc-001-kafka.md
      title: Review on Gitea
      type: gitea
spec:
  docType: rfc                           # required
  docStatus: superseded                  # required
  owner: group:rocket-team               # required
  system: payments                       # optional
  author: user:alice                     # optional
  supersededBy: doc:default/adr-001-kafka-for-payments   # optional
  relatedTo:                             # optional
    - component:default/payments-service
    - component:default/payments-worker
  contentUrl: rocket-team/docs/rfcs/rfc-001-kafka.md   # optional
```

### ADR example

```yaml
apiVersion: wxops.cloud/v1alpha1
kind: Doc
metadata:
  name: adr-001-kafka-for-payments
  title: "ADR-001: Adopt Kafka for Payments Events"
  description: Decision record for adopting Kafka following acceptance of RFC-001.
  tags: [kafka, payments, adr, messaging]
spec:
  docType: adr
  docStatus: accepted
  owner: group:rocket-team
  system: payments
  author: user:alice
  relatedTo:
    - component:default/payments-service
    - component:default/payments-worker
    - resource:default/payments-db
  contentUrl: rocket-team/docs/adrs/adr-001-kafka.md
```

### Runbook / general documentation example

```yaml
apiVersion: wxops.cloud/v1alpha1
kind: Doc
metadata:
  name: doc-001-payments-runbook
  title: Payments Service Runbook
  description: Operational guide — deployment, health checks, incident response.
  tags: [runbook, payments, ops, oncall]
  links:
    - url: https://grafana.example.com/d/payments-overview
      title: Payments Dashboard
      icon: dashboard
spec:
  docType: documentation
  docStatus: accepted
  owner: group:rocket-team
  system: payments
  author: user:bob
  relatedTo:
    - component:default/payments-service
    - resource:default/payments-db
    - doc:default/adr-001-kafka-for-payments
  contentUrl: rocket-team/docs/documentation/doc-001-payments-runbook.md
```

### `spec` fields for Doc

| Field | Required | Description |
|---|---|---|
| `docType` | yes | `rfc` \| `adr` \| `documentation` |
| `docStatus` | yes | See lifecycle table below |
| `owner` | yes | Group or user ref |
| `system` | no | Associates this document with a system |
| `author` | no | User ref: `user:alice` |
| `draft` | no | `true` = visible only to the author and `platform-team`. `false` (default) = visible to all authenticated users. |
| `contentUrl` | no | Path to the markdown source file — see Content URL below |
| `relatedTo` | no | List of entity refs this document describes (`component`, `api`, `resource` — not `system`) |
| `supersededBy` | no | Doc ref that replaces this document (RFC → ADR) |

### `spec.docStatus` values

| docStatus | Meaning |
|---|---|
| `proposed` | Draft — under active writing, not yet circulated |
| `under-review` | Open for comment — PR open or review requested |
| `accepted` | Approved and in effect |
| `deprecated` | Superseded or outdated, kept for history |
| `superseded` | Explicitly replaced by another document — set `supersededBy` |

### RFC → ADR lifecycle

The standard lifecycle for architectural decisions:

1. Write the RFC as a PR to `<team>/docs/rfcs/` — set `docStatus: proposed`
2. Share for comment — set `docStatus: under-review`
3. RFC accepted — merge the PR, set `docStatus: superseded`, set `supersededBy: doc:default/<adr-name>`
4. Write the ADR in `<team>/docs/adrs/` capturing only the final decision — set `docStatus: accepted`
5. Link both from the relevant Component's `metadata.links` with `type: rfc` and `type: adr`

### `spec.contentUrl`

The portal fetches and renders the markdown at `contentUrl`. Two formats are supported:

**Relative path** — resolves from within the catalog repository. Preferred for documents committed alongside catalog YAML:
```yaml
contentUrl: rocket-team/docs/rfcs/rfc-001-kafka.md
```

**Absolute URL** — fetched via the Gitea client (requires `GITEA_TOKEN`) or plain HTTP for public URLs:
```yaml
contentUrl: https://gitea.example.com/rocket-team/architecture/raw/branch/main/rfcs/rfc-001-kafka.md
```

If `contentUrl` is absent, the portal shows metadata only — no inline markdown rendering.

---

## Validation Rules

The portal validates each entity on load and logs an error for invalid files (invalid entities are skipped; the rest of the catalog loads normally).

| Kind | Required fields |
|---|---|
| `System` | `metadata.name`, `spec.owner` |
| `Component` | `metadata.name`, `spec.owner`, `spec.lifecycle`, `spec.type` |
| `API` | `metadata.name`, `spec.owner`, `spec.lifecycle`, `spec.type` |
| `Resource` | `metadata.name`, `spec.owner`, `spec.lifecycle`, `spec.type` |
| `Group` | `metadata.name`, `spec.type` |
| `User` | `metadata.name` |
| `Doc` | `metadata.name`, `spec.owner`, `spec.docType` |

---

## OpenAPI Spec Linking

API entities can surface a live Swagger UI viewer on their portal page. Add one or more links with `type: openapi` to `metadata.links`. The portal tries each link in order and renders the first one it can successfully fetch.

### Option 1: Committed static file (recommended)

Generate the spec with `swag init`, commit it to the catalog repository, and reference it with a relative path. This works in all environments with no live HTTP endpoint required.

```yaml
# In apis/portal-api.yaml
metadata:
  links:
    - url: platform-team/apis/portal-openapi.json
      title: OpenAPI Spec
      type: openapi
      icon: api
```

Regenerate after handler changes:
```bash
make openapi-sync
# or manually:
cd backend && swag init -g cmd/main.go -o docs/
cp backend/docs/swagger.json \
   backend/internal/catalog/examples/platform-team/apis/portal-openapi.json
```

> The `make openapi-sync` pre-commit hook regenerates `backend/docs/` automatically when handler files change. The copy to the catalog directory is a manual step — intentional, so you control when the committed spec is updated.

### Option 2: Live endpoint (dev only)

Reference the running backend's swagger endpoint. Only available when `SWAGGER_ENABLED=true`.

```yaml
metadata:
  links:
    - url: http://localhost:8080/swagger/doc.json
      title: OpenAPI Spec (live)
      type: openapi
      icon: api
```

Never set `SWAGGER_ENABLED=true` on a public host. Use the committed static file for production.

### Option 3: Inline definition

For small or generated specs, embed the YAML directly in `spec.definition`:

```yaml
spec:
  type: openapi
  definition: |
    openapi: "3.0.0"
    info:
      title: My API
      version: "1.0"
    paths:
      /healthz:
        get:
          summary: Health check
          responses:
            "200":
              description: OK
```

### Spec resolution priority

When multiple `type: openapi` links are present, the portal tries them in order:

1. `spec.definition` — inline YAML in the catalog file (highest priority)
2. Relative path link — reads from the catalog repository via `store.GetFileContent`
3. Absolute URL + Gitea auth — fetched with `GITEA_TOKEN` (private repos)
4. Absolute URL + plain HTTP — public or same-network endpoints (lowest priority)

---

## Directory Layout

See [service-catalog.md — Directory Layout](service-catalog.md#directory-layout-in-gitops-infra) for the full layout reference.

The short version: one subdirectory per team, with kind-named subdirectories inside:

```
catalog/
└── <team-name>/
    ├── systems/
    ├── components/
    ├── apis/              ← also put committed OpenAPI JSON files here
    ├── resources/
    ├── groups/
    ├── users/
    └── docs/              ← RFC, ADR, and runbook Doc entities
```
