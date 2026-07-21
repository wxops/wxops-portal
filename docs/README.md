# WxOps Portal — Documentation

Docs are grouped by category. Categories mirror the public docs site (`docs-site/docs/`),
plus a `development/` bucket for contributor-facing material.

## Getting Started

| Doc | What it covers |
|---|---|
| [Introduction](getting-started/introduction.md) | What the portal is, one-login model, high-level feature tour |
| [Deployment](getting-started/deployment.md) | Production deployment — Pinniped, OIDCClient, RBAC, spoke setup |
| [Environment Variables](getting-started/environment-variables.md) | Full env var reference |

## Concepts

| Doc | What it covers |
|---|---|
| [Architecture](concepts/architecture.md) | Auth model, Pinniped, hub-spoke topology, security boundaries |
| [Platform Engineering Rationale](concepts/platform-engineering-rationale.md) | Why Crossplane + Portal + Golden Path; tradeoffs, business case |
| [Performance](concepts/performance.md) | Cache layers, TTLs, polling, scaling thresholds |

## Scaffolding & Lifecycle

| Doc | What it covers |
|---|---|
| [Golden-Path Git Flow](scaffolding/golden-path-git-flow.md) | Branch model, CI pipeline, image tag lifecycle |
| [Cross-Environment Promotion](scaffolding/cross-environment-promotion.md) | Overlay model, per-env config, lifecycle promotion |
| [Lifecycle Webhook](scaffolding/lifecycle-webhook.md) | CI → portal cache refresh, trust chain |

## Catalog

| Doc | What it covers |
|---|---|
| [Service Catalog](catalog/service-catalog.md) | Entity kinds, relationships, design rationale |
| [Catalog User Guide](catalog/catalog-user-guide.md) | YAML field reference, all kinds, annotations, link types |
| [Documentation Strategy](catalog/documentation-strategy.md) | RFC, ADR, Runbook Doc entities |

## Platform

| Doc | What it covers |
|---|---|
| [Platform Features](platform/platform-features.md) | XTenantApp / XTenantDatabase / Vault spec schema, base vs overlay |
| [Cluster Registry](platform/cluster-registry.md) | Spoke discovery via labelled K8s Secrets |
| [Container](platform/container.md) | nginx, supervisord, Dockerfile design |

## Darlane

| Doc | What it covers |
|---|---|
| [Darlane](darlane/darlane.md) | Per-environment parallel debug pods, XR schema, inner-loop tooling |

## CLI & API

| Doc | What it covers |
|---|---|
| [CLI](cli/cli.md) | `wxops` binary — login, catalog, debug, update, darlane |
| [API Reference](api/api-reference.md) | REST endpoint reference |

## Security

| Doc | What it covers |
|---|---|
| [Permissions](security/permissions.md) | Role model, RBAC via Pinniped, action-to-role mapping |
| [Security Assurance](security/security-assurance.md) | Evidence the portal is a passive reflector — no cluster writes, no traffic interception, bounded egress, assume-breach blast radius, reviewer checklist |

## Roadmap

| Doc | What it covers |
|---|---|
| [Enterprise Roadmap](roadmap/enterprise-roadmap.md) | Dev-ready specs: audit, security, scorecards, cost, XDarlane, Guardian |
| [System Intelligence](roadmap/system-intelligence.md) | Darlane-native incident response — diagnose + validate in a safe twin for on-call & hotfix |
| [DevEx Integrations](roadmap/devex-integrations.md) | CVE management (Trivy → issue → patch), test visibility, team productivity signals |

## Development

| Doc | What it covers |
|---|---|
| [Local Development](development/local-development.md) | Local setup, dev bypass auth, local catalog testing |
| [Release Workflow](development/release-workflow.md) | CI release process, changelog generation |
| [Refactor & Hardening](development/refactor-and-hardening.md) | Quality-substrate release plan — tests, structured logging, god-file decomposition (portal + core) |
| [Open-Source Readiness](development/open-source-readiness.md) | Open-core split, scrub, hardening gate, 10-min demo, license, KubeCon listening tour |
