<!--
Copy this file to docs/rfc/RFC-NNN-short-slug.md. NNN is the next unused number in ROADMAP.md's RFC
index; the slug is lowercase, hyphenated, and says what the RFC decides.

Then, in the same PR:
  1. Add a row to the RFC index in ROADMAP.md: status `proposed`, Decision `—`.
  2. Delete this comment.

The headings below are the project's enforced RFC structure (docs/catalog/documentation-strategy.md,
.github/ISSUE_TEMPLATE/rfc.md). Keep them, in this order — an accepted [RFC] issue graduates into this
shape without restructuring. Delete the guidance under each heading as you write it, and remove any
header line you have nothing true to put in. Wrap prose around 100 characters.

An RFC's status never changes by editing it. The project decides through an ADR that names this RFC;
when that ADR is accepted, update this file's Status and Decision lines and the RFC's row in
ROADMAP.md together. The ADR's `Decides:` line links back here (docs/adr/template.md).
-->

# RFC-NNN: Title — the question, not the answer

> **Status:** proposed. **Owner:** platform-team. **Spans:** which repos and packages this touches —
> e.g. `wxops-portal` (`backend/internal/scaffold/`), and `wxops-core` or `wxops-templates` if it
> reaches them.
>
> **Decision:** none yet. <!-- Once decided: [ADR-NNN](../adr/ADR-NNN-short-slug.md) — accepted / declined / superseded. -->
>
> **Grounding:** the code, docs or earlier RFCs this rests on, named precisely enough to check. Say
> what you read, not what you assume.
>
> **Companions:** related RFCs or docs, and *how* each relates — a sibling problem, a prerequisite,
> or a constraint. Don't link RFCs that merely share a topic.

---

## Summary

One paragraph: what is proposed, and for whom. If it is a brainstorm rather than a proposal, say so
here and let Open Questions carry the weight.

## Motivation

What breaks or is missing today. A concrete scenario beats an abstract benefit: which user action —
developer, platform-team, CLI or agent caller — fails, and what it costs. If the pain is
hypothetical, say that too.

## Detailed Design

The shape of the change, at the depth needed to reason about tradeoffs. Cover what applies:

- **API surface** — new or changed REST endpoints, catalog entity schema fields, CLI commands
- **Handler / UI behaviour** — what changes, and under which conditions
- **Affected packages** — `internal/handlers`, `internal/scaffold`, `internal/catalog`,
  `frontend/src/components`, `cli/internal/commands`, or a new package
- **New dependency or egress** — any new library or external call, and its effect on the claims in
  `docs/security/security-assurance.md`
- **Security constraints** — how it stays inside `CLAUDE.md`'s non-negotiables (read-only to clusters,
  Vault create/update only, no gitops-infra URLs to developers)
- **Testing** — the table-driven cases that prove it, including each new toggle or branch

If there are competing shapes, give each its own `### Option X — …` with what it gets right and what
it costs.

## Drawbacks

Why we should *not* do this. Real costs, not a formality; an empty section usually means the design
was not stress-tested.

## Alternatives

At least one real alternative and why it loses. "Do nothing" counts, with its actual cost.

## Rollout Plan

How it lands safely, not just what ships:

- Behaviour-preserving, additive, or breaking?
- Existing catalog entities or already-scaffolded projects affected? Any migration?
- New environment variable? Then the three-step process in `CLAUDE.md` applies.
- Sequencing constraints and phasing — what ships first, what can wait.

## Open Questions

Unresolved items, grouped by theme, including scope ("is this one RFC or two?"). A thin section
usually means the RFC was written to justify a decision already made.
