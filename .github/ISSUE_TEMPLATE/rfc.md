---
name: RFC — feature / design proposal
about: Propose a new capability or a significant design change, with the option space
title: "[RFC] "
labels: rfc, needs-review
assignees: ''

---

<!--
An RFC argues a change BEFORE it happens. For small additive tweaks, the
Feature request template is enough — use this when the change touches a
public API/response shape, adds a new backend package or external
dependency, changes the catalog entity schema, or commits the portal to a
new tool or library.

Sections below match this project's enforced RFC structure — the same one
docs/catalog/documentation-strategy.md requires for an RFC Doc catalog entity,
and the one already in use for docs/rfc/RFC-001 through RFC-006. An
accepted RFC issue should graduate into a docs/rfc/RFC-NNN.md with
these same headings, not a different shape.

Before writing: check ROADMAP.md's Architecture Decisions table and
CLAUDE.md's "What NOT to Do" section, and docs/rfc/ for an existing
RFC-NNN already covering this — your idea may be tracked, planned, or
already closed. Referencing that beats rediscovering it in review.
-->

## Summary

One paragraph: what is proposed and for whom.

## Motivation

What breaks or is missing today. Concrete scenario over abstract benefit —
which user action (developer, platform-team, CLI/agent caller) fails, and
what it costs.

## Detailed Design

The shape of the change. Cover what applies:

- **API surface** — new/changed REST endpoints, catalog entity schema
  fields, or CLI commands (sketch the request/response or YAML below)
- **Handler / UI behaviour** — what changes in the backend handler, frontend
  component, or CLI command, and under which conditions
- **Affected packages** — `internal/handlers` / `internal/scaffold` /
  `internal/catalog` / `frontend/src/components` / `cli/internal/commands` /
  new package
- **New external dependency or egress** — any new library, external service
  call, or change to the bounded-egress claims in
  `docs/security/security-assurance.md`
- **Testing** — which table-driven cases prove it; a new toggle or
  conditional branch needs its own case, not just a happy path (see
  `internal/handlers/*_test.go` / `internal/scaffold/*_test.go` for the
  current style)

```yaml
# proposed request/response or schema sketch
```

## Drawbacks

Why should we NOT do this? Real costs, not a formality — a Drawbacks
section with nothing in it usually means the design wasn't stress-tested.

## Alternatives

At least one real alternative and why it loses. "Do nothing" counts and
should usually be listed with its actual cost.

## Rollout Plan

How this lands safely, not just what ships:

- Behaviour-preserving, additive, or breaking? (see
  `docs/development/refactor-and-hardening.md`'s "Guiding rules" for what
  additive means in this codebase — e.g. an error `code` field is additive,
  changing an existing response shape is not)
- Existing catalog entities or already-scaffolded projects affected? Any
  manifest-shape or naming-convention change they'd need to migrate to?
- New environment variable required? If so, this needs the 3-step process in
  `CLAUDE.md` (`config.go` → `.env.example` → `environment-variables.md`)
- Phasing, if any — what ships first and what can wait

## Open Questions

Unresolved items for discussion, including scope boundaries ("is this one
RFC or does part of it deserve its own"). Leaving this section thin usually
means the RFC was written to justify a decision already made, not to open one.

---
<!--
Lifecycle: needs-review → the project decides by ADR. An RFC is never
"accepted" by a label alone: open an [ADR] issue naming this RFC, and when
that ADR is accepted (or the RFC declined), ROADMAP.md's RFC index gets the
new status and a link to the ADR. Accepted RFCs graduate to a fuller design
doc in docs/rfc/ (start from docs/rfc/template.md; RFC-001 through RFC-015 show
the pattern, same headings as above) or straight to a PR when small.
-->
