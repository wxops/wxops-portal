---
name: ADR — architecture decision proposal
about: Propose recording (or revisiting) a decision of lasting consequence
title: "[ADR] "
labels: adr, needs-review
assignees: ''

---

<!--
An ADR records ONE decision: context → decision → consequences. Use this
when the outcome constrains future work regardless of any single feature —
tool adoption, an architectural boundary, a convention, a deliberate
rejection. Use the RFC template instead when the open question is a design
with an option space; an accepted RFC often produces an ADR as its residue
(see RFC-003's relationship to the catalog-entity-creation decision it's
building toward, for an example already in flight).

This issue is the pre-decision proposal — Options + Recommendation, because
it isn't decided yet. Once accepted, it's written up as the project's
enforced ADR content (Status/Context/Decision/Consequences/Alternatives
Considered) per docs/catalog/documentation-strategy.md, either as a Doc
catalog entity or a row in ROADMAP.md's Architecture Decisions table,
depending on whether the decision is catalog-worthy or codebase-wide.

Revisiting an existing decision? ROADMAP.md's Architecture Decisions table
is the standing record — the burden is to say WHAT CHANGED since the
original decision was made, not to restate a preference. Link the original
row or issue.
-->

## Decision to be made

One sentence, phrased as the decision — e.g. "Catalog entities are derived,
not user-defined" or "The portal never reads or deletes Vault secrets", not
"we should discuss catalog entity creation."

## Status

Proposed <!-- → Accepted / Declined / Supersedes #NNN -->

## RFC decided

<!-- If this decides an RFC, name it: RFC-NNN (docs/rfc/RFC-NNN-*.md). On acceptance its row in
ROADMAP.md's RFC index moves from `proposed` to accepted / declined / superseded and links here.
Write "none" if there is no RFC behind this decision. The ADR file's `Decides:` line carries the same link. -->

## Context

The forces at play: what makes this decision necessary now, what constraints
bound it (existing entries in ROADMAP.md's Architecture Decisions table,
`CLAUDE.md`'s security constraints, the stack as it stands), and what
happens if it stays undecided.

## Options

| Option | For | Against |
|---|---|---|
| A — … | | |
| B — … | | |

## Recommendation

Which option and the deciding argument — the one consideration that outweighs
the others, not a restatement of the whole table.

## Consequences

What becomes easier, what becomes harder, and what this commits us to
maintaining or enforcing (a new invariant? a CI check? a doc update?). Honest
costs included — a consequences section with no downsides wasn't finished.

---
<!--
Lifecycle: on acceptance, the decision is written up as docs/adr/ADR-NNN-*.md
(from docs/adr/template.md) and added to ROADMAP.md's Architecture Decisions
table (or published as an ADR Doc catalog entity, if it's the kind of decision
a tenant team would look up — see documentation-strategy.md), with this issue
linked as the permanent record. If an RFC is named above,
update that RFC's row in ROADMAP.md's RFC index in the same PR. A later reversal is a NEW
ADR issue that supersedes this one — this issue is never edited after
acceptance.
-->
