<!--
Copy this file to docs/adr/ADR-NNN-short-slug.md. NNN is the next unused number (look at docs/adr/);
the slug is lowercase, hyphenated, and states the decision — `adr-001-use-kafka-for-events`, not
`adr-001-messaging`.

An ADR records ONE decision that is already made: context → decision → consequences. If the open
question still has an option space, write an RFC (docs/rfc/template.md) and let this ADR be its
residue. Use the [ADR] issue (.github/ISSUE_TEMPLATE/adr.md) for the pre-decision discussion; this
file is the written-up record once the decision is accepted.

In the same PR that accepts it:
  1. If it decides an RFC, set that RFC's row in the ROADMAP.md RFC index to accepted / declined /
     superseded, link this file in its Decision column, and update the RFC's own Status and Decision
     lines to match.
  2. Add a row to ROADMAP.md's Architecture Decisions table, linking this file.
  3. Delete this comment.

The headings below are the project's enforced ADR structure (docs/catalog/documentation-strategy.md).
Keep them, in this order. Wrap prose around 100 characters.

An accepted ADR is never edited — typo fixes only. To change the decision, write a NEW ADR that
supersedes this one, and set Superseded by here and Supersedes there.

Decisions a tenant team would look up (a golden-path convention, a platform contract) belong as an ADR
`Doc` catalog entity instead, per documentation-strategy.md. This folder is for codebase-wide decisions
about the portal itself.
-->

# ADR-NNN: The decision, stated as a decision

> **Status:** proposed <!-- proposed → accepted / declined / superseded -->. **Date:** YYYY-MM-DD.
> **Owner:** platform-team.
>
> **Decides:** [RFC-NNN](../rfc/RFC-NNN-short-slug.md) <!-- or "none" if no RFC sits behind this -->.
>
> **Supersedes:** none. <!-- [ADR-NNN](ADR-NNN-short-slug.md) -->
> **Superseded by:** none. <!-- filled in only by the ADR that replaces this one -->

---

## Status

Proposed <!-- Matches the Status line above; for readers of the body alone. -->

## Context

The forces at play: what makes this decision necessary now, what constraints bound it (existing rows
in ROADMAP.md's Architecture Decisions table, `CLAUDE.md`'s security constraints, the stack as it
stands), and what happens if it stays undecided. If an RFC sits behind this, summarise its finding in
a few lines and link it rather than restating it.

## Decision

What we decided, in a sentence or two, then why — the one consideration that outweighed the others.

## Consequences

What becomes easier, what becomes harder, and what this commits us to maintaining or enforcing: a new
invariant, a CI check, a doc update, a follow-up RFC. Honest costs included; a section with no
downsides is not finished.

## Alternatives Considered

The options weighed and why each lost. Carry these over from the RFC's Alternatives when there is one.
