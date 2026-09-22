# RFC-014: Configurable Golden-Path Delivery Topology

> **Status:** proposed — formalizing an already dev-ready spec into RFC form.
> **Owner:** platform-team. **Spans:** `wxops-templates` (`template.yaml` schema, `ci.yaml`
> substitution) and `wxops-portal-v2` (scaffold wizard — a new topology choice at creation time).
>
> **Grounding:** this is `fleet-sync-and-golden-path-evolution.md` (removed — Part A migrated to
> `RFC-007`) Part B ("Configurable GitFlow"), migrated into RFC form. **Deliberately separated from
> `RFC-007`** — the source document itself stated Part B is independent and doesn't require Part A to
> exist first; this RFC preserves that independence rather than folding the two together.

---

## Summary

Today every scaffolded service gets the same three-environment promotion path (`experimental` →
`development` → `staging` → `production`), hardcoded. This RFC proposes a `gitFlow: 3-env | 2-env |
1-env` field on `template.yaml`, substituted into the generated `ci.yaml` the same way `packageManager`
already is — so a team can choose a shorter delivery path without losing any governance guarantee, since
only the promotion topology varies; the `test`, `security`, doc-validation, and release jobs stay
identical across all three flows.

## Motivation

Not every service needs three gated environments. A small internal tool, a short-lived experiment, or a
service a single developer owns end-to-end may be genuinely over-served by the same staging gate a
customer-facing production service needs. The current golden path has no answer for this beyond "use
the full topology regardless" — which either pushes teams to route around the platform for low-stakes
services, or burdens every scaffold with promotion ceremony some of them don't need.

## Detailed Design

### The mechanism — additive schema, reused substitution pipeline

A new `template.yaml` field:

```yaml
name: go-service
title: Go Microservice
gitFlow: 3-env    # 3-env (default) | 2-env | 1-env
```

Substituted into the generated `ci.yaml` through the same `buildTemplateVars`/`substituteVars` pipeline
already used for every other scaffold-time variable — no new rendering mechanism, consistent with the
conclusion `RFC-001` and `RFC-007` both already reached: this pipeline is worth reusing, not replacing.

### What varies, and — more importantly — what does not

**Only promotion topology varies.** `test`, `security`, doc-validation, and the release job are
**identical across all three flows** — this is the design's central guarantee: choosing a shorter path
never means choosing a weaker one. `1-env` doesn't mean "skip tests," it means "skip the staging gate."

| Flow | Environments | What's dropped |
|---|---|---|
| `3-env` (default, current behavior) | `development` → `staging` → `production` | Nothing — today's behavior, unchanged |
| `2-env` | `development` → `production` | The staging gate only |
| `1-env` | `production` only | Both intermediate gates |

### The real risk, named plainly rather than left implicit

`1-env` drops the staging gate **entirely** — the last human checkpoint before production for that
service. The scaffold wizard needs an explicit warning step before a team can select it, not a dropdown
option presented with equal visual weight next to `2-env` and `3-env`. This isn't a nice-to-have UX
polish — it's the one place this RFC's "never a weaker guarantee" promise needs an actual enforcement
mechanism, not just documentation.

## Drawbacks

- A service scaffolded with `1-env` and later needing staging (the team grows, the service becomes
  more critical) has no documented migration path in the source design — re-scaffolding or a manual
  topology change would be needed, and neither is specified here.
- Three topologies is three paths to keep the `test`/`security`/doc-validation parity promise true for,
  forever — every future CI change has to be checked against all three, not just one.

## Alternatives

- **Don't offer `1-env` at all; ship only `3-env` and `2-env`.** Removes the riskiest option (dropping
  the staging gate entirely) while still answering "not every service needs three environments" for the
  more common case. Worth real consideration given the explicit risk named above — the source design
  includes `1-env` but doesn't argue hard for it being necessary versus `2-env` covering most of the
  actual demand.

## Rollout Plan

1. **Schema addition (`gitFlow` field) and `ci.yaml` substitution logic** — mechanical, additive, no
   risk to existing scaffolds since the default (`3-env`) reproduces today's behavior exactly.
2. **The scaffold wizard's topology choice, with `1-env`'s explicit warning step, ships together with
   step 1** — per the Drawbacks/risk section above, this isn't a follow-up polish item; shipping the
   field without the warning step ships the risk without its mitigation.
3. Consider the Alternatives option (drop `1-env`) as a real decision point before building the warning
   UX, not after — it may be cheaper to not build the riskiest path at all than to build it safely.

## Open Questions

1. Does `1-env` get built at all, or does the Alternatives option (ship only `3-env`/`2-env`) turn out
   to cover the actual demand without the staging-gate risk?
2. What's the migration path for a service that outgrows its chosen topology — re-scaffold, a manual
   overlay-structure change, or an explicit "upgrade topology" portal action that doesn't exist today in
   any form?
3. Does a `2-env`/`1-env` service still get the full Promotion panel UI (Darlane, overlay config) for
   its remaining environments, or does the UI itself need topology-aware changes beyond what CI
   generates?
