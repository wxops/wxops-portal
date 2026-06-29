# Documentation Strategy: ADR, RFC, Runbook

## Purpose

The WxOps Portal treats documentation as a **first-class catalog entity** (`kind: Doc`) rather than a wiki page or a folder of markdown files nobody reads. Every ADR, RFC, and Runbook is:

1. **Version-controlled** in Gitea alongside the code it describes
2. **Registered in the catalog** with typed metadata (docType, docStatus, relatedTo)
3. **Rendered in the portal** with full markdown + mermaid support
4. **Linked to the services it governs** via `spec.relatedTo` references
5. **Protected by PR review** — content changes go through Gitea PRs, never direct writes

This creates an enforceable knowledge trail: you can see which decisions led to the current architecture, which runbooks exist for each service, and who approved what.

---

## Document Types

### ADR (Architecture Decision Record)

**Purpose**: Capture a decision that affects system architecture, with context and consequences. ADRs are immutable once accepted — if a decision changes, the old ADR is **superseded** by a new one (not edited).

**Lifecycle**: `proposed` → `under-review` → `accepted` → `superseded` (or `deprecated`)

**Naming**: `adr-NNN-short-slug` (e.g., `adr-001-use-kafka-for-events`)

**Required fields**:
- `spec.docType: adr`
- `spec.docStatus`: one of `proposed`, `under-review`, `accepted`, `deprecated`, `superseded`
- `spec.owner`: the team that owns this decision
- `spec.author`: the person who wrote it
- `spec.relatedTo`: the component(s) or system(s) this decision affects

**Markdown structure** (enforced in template):
```markdown
# ADR-NNN: <Title>

## Status
<!-- Matches spec.docStatus — single source of truth is the YAML, this is for readers -->
Accepted

## Context
<!-- What problem are we solving? What constraints exist? -->

## Decision
<!-- What did we decide and why? -->

## Consequences
<!-- What are the trade-offs? What changes as a result? -->

## Alternatives Considered
<!-- What else did we evaluate? Why was it rejected? -->
```

**Decision chain**: When an ADR is superseded, set `spec.supersededBy: "doc:default/adr-005-switch-to-nats"` on the old ADR and `spec.relatedTo` on the new one pointing back. The portal renders this as a linked chain in the sidebar.

### RFC (Request for Comments)

**Purpose**: Propose a significant change for team-wide discussion before implementation begins. Unlike ADRs, RFCs are **mutable during review** — the document evolves as feedback arrives.

**Lifecycle**: `proposed` → `under-review` → `accepted` (becomes an ADR or implementation ticket) or `deprecated` (rejected/withdrawn)

**Naming**: `rfc-NNN-short-slug` (e.g., `rfc-012-multi-cluster-tenancy`)

**Required fields**:
- `spec.docType: rfc`
- `spec.docStatus`: one of `proposed`, `under-review`, `accepted`, `deprecated`
- `spec.owner`: the team sponsoring this RFC
- `spec.author`: the person who wrote it
- `spec.relatedTo`: systems/components affected by this proposal

**Markdown structure** (enforced in template):
```markdown
# RFC-NNN: <Title>

## Summary
<!-- 2-3 sentences: what are you proposing and why? -->

## Motivation
<!-- Why is this change needed? What pain point does it solve? -->

## Detailed Design
<!-- Technical details. Include diagrams (mermaid supported). -->

## Drawbacks
<!-- Why should we NOT do this? -->

## Alternatives
<!-- Other approaches considered. -->

## Rollout Plan
<!-- How will this be implemented? Phases, timeline, feature flags? -->

## Open Questions
<!-- Unresolved items for discussion. -->
```

**RFC → ADR graduation**: When an RFC is accepted and implemented, the RFC status becomes `accepted` and a corresponding ADR is created referencing the RFC via `spec.relatedTo`. The RFC's `spec.docStatus` stays `accepted` (not superseded — the RFC and ADR serve different purposes).

### Runbook

**Purpose**: Operational procedure for responding to incidents, performing maintenance, or executing recurring tasks. Runbooks are **living documents** — they are updated as procedures change.

**Lifecycle**: `accepted` (active) or `deprecated` (replaced by a new procedure)

**Naming**: `runbook-short-slug` (e.g., `runbook-database-failover`, `runbook-rotate-vault-tokens`)

**Required fields**:
- `spec.docType: runbook`
- `spec.docStatus`: typically `accepted` (active) or `deprecated`
- `spec.owner`: the team responsible for executing this runbook
- `spec.relatedTo`: the component(s) or resource(s) this runbook operates on

**Markdown structure** (enforced in template):
```markdown
# Runbook: <Title>

## Overview
<!-- What does this runbook cover? When should you use it? -->

## Prerequisites
<!-- Access, permissions, tools needed before starting -->

## Procedure

### Step 1: <Action>
<!-- Clear, copy-pasteable commands. No ambiguity. -->

### Step 2: <Action>
<!-- ... -->

## Verification
<!-- How do you confirm the procedure worked? -->

## Rollback
<!-- If something goes wrong, how do you undo it? -->

## Escalation
<!-- Who to contact if this runbook doesn't resolve the issue -->
```

---

## Catalog Entity Schema

All documentation entities use `kind: Doc` with `apiVersion: wxops.cloud/v1alpha1`. The catalog entity YAML lives in the gitops-infra repository under `{team}/docs/{name}.yaml`.

### Full example: ADR

```yaml
apiVersion: wxops.cloud/v1alpha1
kind: Doc
metadata:
  name: adr-001-use-kafka-for-events
  title: "ADR-001: Use Kafka for Event Streaming"
  description: "Decision to adopt Kafka as the event backbone for inter-service communication"
  tags:
    - architecture
    - messaging
    - kafka
  links:
    - url: https://gitea.example.com/platform-team/docs/src/branch/main/adrs/adr-001-use-kafka-for-events.md
      title: Source on Gitea
      type: gitea
spec:
  docType: adr
  docStatus: accepted
  owner: group:platform-team
  author: user:alice
  system: event-platform
  relatedTo:
    - component:default/order-service
    - component:default/notification-service
    - resource:default/kafka-cluster
  contentUrl: https://gitea.example.com/platform-team/docs/raw/branch/main/adrs/adr-001-use-kafka-for-events.md
```

### Full example: Runbook

```yaml
apiVersion: wxops.cloud/v1alpha1
kind: Doc
metadata:
  name: runbook-database-failover
  title: "Runbook: PostgreSQL Database Failover"
  description: "Step-by-step procedure for failing over a CNPG PostgreSQL cluster"
  tags:
    - operations
    - database
    - incident-response
  links:
    - url: https://gitea.example.com/platform-team/docs/src/branch/main/runbooks/database-failover.md
      title: Source on Gitea
      type: gitea
spec:
  docType: runbook
  docStatus: accepted
  owner: group:platform-team
  author: user:bob
  relatedTo:
    - resource:default/payments-db
    - resource:default/orders-db
  contentUrl: https://gitea.example.com/platform-team/docs/raw/branch/main/runbooks/database-failover.md
```

### Full example: RFC

```yaml
apiVersion: wxops.cloud/v1alpha1
kind: Doc
metadata:
  name: rfc-012-multi-cluster-tenancy
  title: "RFC-012: Multi-Cluster Tenant Isolation"
  description: "Proposal to support dedicated Kubernetes clusters per tenant for compliance-sensitive workloads"
  tags:
    - architecture
    - multi-tenancy
    - security
spec:
  docType: rfc
  docStatus: under-review
  draft: true
  owner: group:platform-team
  author: user:alice
  relatedTo:
    - system:default/tenant-platform
  contentUrl: https://gitea.example.com/platform-team/docs/raw/branch/main/rfcs/rfc-012-multi-cluster-tenancy.md
```

---

## Repository Structure

Documentation content (markdown files) and catalog entities (YAML) live in separate locations:

### Content: Team docs repository

Each team can have a dedicated docs repo or a `docs/` folder in their service repo. The platform team maintains a central docs repo for cross-cutting concerns.

```
platform-team/docs/           # Central docs repo on Gitea
├── adrs/
│   ├── adr-001-use-kafka-for-events.md
│   ├── adr-002-vault-for-secrets.md
│   └── adr-003-crossplane-for-infra.md
├── rfcs/
│   ├── rfc-012-multi-cluster-tenancy.md
│   └── rfc-013-observability-stack.md
├── runbooks/
│   ├── database-failover.md
│   ├── rotate-vault-tokens.md
│   └── tenant-onboarding.md
└── README.md
```

For service-specific docs, content lives in the service repo:

```
rocket-team/payment-service/   # Service repo on Gitea
├── docs/
│   ├── adr-001-payment-gateway-choice.md
│   └── runbook-payment-reconciliation.md
├── src/
└── ...
```

### Catalog entities: gitops-infra repository

The Doc entity YAML files live in gitops-infra alongside other catalog entities:

```
gitops-infra/                  # Catalog + GitOps config
├── platform-team/
│   ├── components/
│   ├── docs/                  # Doc entity YAML files
│   │   ├── adr-001-use-kafka-for-events.yaml
│   │   ├── rfc-012-multi-cluster-tenancy.yaml
│   │   └── runbook-database-failover.yaml
│   ├── resources/
│   └── systems/
├── rocket-team/
│   ├── components/
│   ├── docs/
│   │   ├── adr-001-payment-gateway-choice.yaml
│   │   └── runbook-payment-reconciliation.yaml
│   └── ...
```

The `spec.contentUrl` in each Doc entity YAML points to the actual markdown file in the content repository. This separation means:
- Catalog metadata changes (status updates, tag changes) go through gitops-infra PRs
- Content changes go through the content repo's PRs
- Both are independently reviewable

---

## Portal Rendering

### How it works today

1. **Catalog sync**: The `catalog.Store` reads Doc entity YAML files from `{team}/docs/*.yaml` in gitops-infra, same as Components and APIs
2. **Content fetch**: When a user opens a Doc, `GetDocContent` fetches the markdown from `spec.contentUrl` — either a Gitea raw URL (authenticated) or a relative path in the catalog repo
3. **Rendering**: `DocViewer` renders markdown with GFM tables, syntax highlighting, and embedded Mermaid diagrams
4. **Sidebar**: Shows decision chain (supersededBy), related entities, source links, and metadata badges

### Badge system

The portal displays visual badges for doc type and status:

| docType | Badge Color |
|---------|------------|
| `rfc` | Violet |
| `adr` | Blue |
| `documentation` | Emerald |
| `runbook` | (add) Orange |

| docStatus | Badge Color |
|-----------|------------|
| `proposed` | Amber |
| `under-review` | Blue |
| `accepted` | Green |
| `deprecated` | Gray |
| `superseded` | Orange |

---

## Template Integration

### Scaffold templates should include docs structure

When a project is scaffolded, the template should include a `docs/` directory with starter files:

**In `template.yaml`**:
```yaml
name: go-service
title: Go Microservice
recommends:
  vault: true
  monitoring: true
defaults:
  port: 8080
  healthPath: /healthz
  metricsPath: /metrics
```

**In template file tree**:
```
template-go-service/
├── template.yaml
├── docs/
│   ├── adr-001-initial-architecture.md    # Pre-filled starter ADR
│   └── runbook-deployment.md              # Pre-filled deployment runbook
├── cmd/
│   └── main.go
├── go.mod
└── Dockerfile
```

The scaffold process:
1. Creates the service repo with template files (including `docs/`)
2. Generates Doc entity YAMLs in gitops-infra alongside the Component entity
3. Sets `spec.contentUrl` pointing to the docs in the new repo
4. Template variables (`{{ .ProjectName }}`, `{{ .ProjectOwner }}`) are substituted in both code and docs

### Auto-generated Doc entities during scaffold

When scaffolding creates a project, it should also generate Doc catalog entities for any docs included in the template. This is done in `GenerateCatalogEntities`:

```yaml
# Auto-generated: {team}/docs/{appName}-initial-architecture.yaml
apiVersion: wxops.cloud/v1alpha1
kind: Doc
metadata:
  name: {{ .ProjectName }}-initial-architecture
  title: "ADR-001: {{ .ProjectName }} Initial Architecture"
  description: "Initial architecture decisions for {{ .ProjectName }}"
  tags:
    - architecture
    - scaffold-generated
spec:
  docType: adr
  docStatus: proposed
  owner: group:{{ .ProjectOwner }}
  author: user:{{ .Author }}
  relatedTo:
    - component:default/{{ .ProjectName }}
  contentUrl: https://gitea.example.com/{{ .ProjectOwner }}/{{ .ProjectName }}/raw/branch/main/docs/adr-001-initial-architecture.md
```

---

## Rules for Claude Tech Agent in Templates

### What Claude agents MUST do when working with documentation

These rules ensure AI agents operating on scaffolded projects respect the documentation governance model.

#### Rule 1: Never bypass the PR flow for documentation

Documentation content lives in git. Changes MUST go through pull requests. An agent must NEVER:
- Write directly to the main branch of any repository
- Modify catalog entity YAML without going through a gitops-infra PR
- Change `spec.docStatus` without a corresponding content update

**Why**: The portal is read-only for clusters. All mutations flow through Gitea PRs. This prevents unauthorized changes from going live without human review.

#### Rule 2: Maintain the ADR immutability contract

Once an ADR has `docStatus: accepted`:
- The ADR content MUST NOT be modified (except typo fixes that don't change the decision)
- To reverse or change a decision, create a NEW ADR that supersedes the old one
- Set `spec.supersededBy` on the old ADR pointing to the new one
- Set `spec.relatedTo` on the new ADR pointing back to the old one

**Why**: ADRs are an audit trail. If past decisions can be silently edited, the team loses the ability to understand how the architecture evolved.

#### Rule 3: Keep relatedTo references accurate

Every Doc entity MUST have `spec.relatedTo` pointing to the components, resources, or systems it describes. When an agent:
- Creates a new service → check if existing ADRs/RFCs apply and add the new component to their `relatedTo`
- Removes a service → update or deprecate related docs
- Changes architecture → create a new ADR with correct `relatedTo` refs

**Why**: Orphaned documentation is worse than no documentation. If a runbook says "for service X" but isn't linked to service X in the catalog, nobody will find it during an incident.

#### Rule 4: Use the correct docType

| When to use | docType |
|-------------|---------|
| Recording a decision that was made | `adr` |
| Proposing a change for discussion | `rfc` |
| Operational procedure for incidents/maintenance | `runbook` |
| General reference material | `documentation` |

**Never** use `documentation` as a catch-all. If it describes a decision, it's an ADR. If it describes a procedure, it's a runbook.

#### Rule 5: Runbooks must be executable

Every runbook MUST include:
- **Prerequisites**: What access/tools are needed
- **Step-by-step procedure**: With copy-pasteable commands
- **Verification**: How to confirm it worked
- **Rollback**: How to undo if it fails
- **Escalation**: Who to contact if the runbook doesn't resolve the issue

An agent generating a runbook that says "fix the database" without concrete steps is violating this rule.

**Why**: During an incident at 3 AM, the on-call engineer needs commands they can paste, not prose they need to interpret.

#### Rule 6: RFC must have a clear decision outcome

When an RFC reaches `accepted` status:
- Create a corresponding ADR (if the RFC captured an architectural decision)
- Or create implementation tickets/issues
- Set the RFC status to `accepted`
- The RFC MUST NOT stay in `proposed` or `under-review` indefinitely

**Why**: Stale RFCs create confusion about whether a proposal was ever decided on.

#### Rule 7: Template docs must be meaningful, not boilerplate

When creating scaffold templates that include starter docs:
- ADR-001 should describe the ACTUAL template choices (why this language, why this framework, why this architecture pattern)
- Runbooks should contain REAL procedures for the template's stack (not generic "deploy the app" placeholders)
- Use template variables (`{{ .ProjectName }}`, `{{ .ProjectOwner }}`) for project-specific values

**Why**: If scaffold-generated docs are obviously boilerplate, teams will ignore all documentation going forward.

#### Rule 8: Protect sensitive information

Documentation MUST NOT contain:
- Credentials, tokens, API keys, or passwords
- Internal IP addresses or hostnames of production infrastructure
- Vault paths that expose the secret hierarchy (use generic examples)
- Customer data or PII

**Why**: Docs are readable by all authenticated portal users. Sensitive information belongs in Vault, not in markdown.

#### Rule 9: Draft visibility

Set `spec.draft: true` on documents that are work-in-progress. The portal restricts draft visibility to members of the `spec.owner` group only. Remove the draft flag only when the document is ready for the broader audience.

**Why**: Publishing half-written RFCs or untested runbooks creates confusion and erodes trust in the documentation system.

#### Rule 10: Content URL must be a raw URL

`spec.contentUrl` must point to the **raw** content endpoint, not the HTML view:

```
# Correct (raw content — returns plain markdown)
https://gitea.example.com/team/repo/raw/branch/main/docs/adr-001.md

# Wrong (HTML view — returns rendered page with Gitea chrome)
https://gitea.example.com/team/repo/src/branch/main/docs/adr-001.md
```

**Why**: The portal fetches this URL and renders the markdown itself. If the URL returns HTML, the DocViewer will display raw HTML tags instead of rendered content.

---

## Validation Checklist

When an agent creates or modifies documentation, verify:

- [ ] `kind: Doc` with `apiVersion: wxops.cloud/v1alpha1`
- [ ] `spec.docType` is one of: `adr`, `rfc`, `runbook`, `documentation`
- [ ] `spec.docStatus` matches the document's current state
- [ ] `spec.owner` is set to a valid `group:` reference
- [ ] `spec.relatedTo` contains at least one component/system/resource reference
- [ ] `spec.contentUrl` points to a raw Gitea URL (not `/src/`, must be `/raw/`)
- [ ] Markdown follows the required structure for its docType
- [ ] No secrets, credentials, or PII in the content
- [ ] If ADR status is `accepted`, the content is frozen (supersede, don't edit)
- [ ] If RFC status changes to `accepted`, a corresponding ADR exists or is created
- [ ] Template variables are properly substituted in scaffold-generated docs
- [ ] The Doc entity YAML is committed to `{team}/docs/` in gitops-infra
- [ ] Changes go through a PR (never direct push to main)

---

## Portal UX Enhancement Roadmap

### Current state
- Doc entities rendered with markdown + mermaid
- Badge system for docType and docStatus
- Decision chain sidebar (supersededBy)
- Related entities sidebar
- Edit guide modal with git workflow instructions

### Planned enhancements
1. **Runbook badge color**: Add orange badge for `runbook` docType in the portal
2. **Doc listing filters**: Filter catalog docs by docType (show all ADRs, all runbooks)
3. **Decision timeline**: Visual timeline showing ADR chain for a system
4. **Runbook quick-access**: Pin runbooks to component detail pages for on-call access
5. **RFC voting/comments**: Integrate with Gitea PR comments for inline discussion
6. **Doc coverage report**: Which components have ADRs? Which have runbooks? Surface gaps.
7. **Search across docs**: Full-text search of document content, not just metadata
