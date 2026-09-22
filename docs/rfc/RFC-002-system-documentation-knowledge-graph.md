# RFC-002: System Documentation as a Knowledge Layer — RFC → ADR → Runbook → Git History

> **Status:** proposed — brainstorm draft, opened to structure a design conversation, not to settle
> it. Deliberately more open questions than answers. **Owner:** platform-team. **Spans:** both
> `wxops-portal-v2` (Portal) and `wxops-core` (Core) — the central open question this RFC exists to
> ask is *which side owns which piece*, not a presumed split.
>
> **Companions:** [`../catalog/documentation-strategy.md`](../catalog/documentation-strategy.md) (the
> existing Portal-side ADR/RFC/Runbook `Doc` entity model — one candidate foundation, not the only one)
> and `system-intelligence.md` (removed — content migrated to `RFC-009`; §1's correlation chain and §9's undesigned
> "MCP surface" dependency, which this problem is adjacent to).

---

## Summary

The project accumulates decisions (RFCs, ADRs), operational knowledge (Runbooks), and — separately —
the actual git history of every repo in the ecosystem (`wxops-portal-v2`, `wxops-core`,
`wxops-templates`, `wxops-gitops-infrastructure`). Today these are four disconnected things. This RFC
asks how to connect them into one traversable system: given a problem, find the runbook; given a
runbook or ADR, find the commit that actually resolved the issue last time; given a decision, see
whether Core's own reconciliation state agrees with what the decision assumed. The central design
question is **where this capability lives** — as a Portal feature, as a Kubernetes-native layer that
Core owns, as an external tool, or some combination — not just what it does.

## Motivation

Three concrete gaps, none solved by what exists today:

1. **"What do I need to find to resolve this problem?"** — today this means knowing which repo, which
   doc folder, and often which person to ask. There's no single traversal path from a symptom to a
   runbook, and no path at all from a runbook to "here's the commit/PR that fixed this exact class of
   problem before."
2. **"Where is the runbook?"** — Portal's catalog answers this *if* the runbook is registered as a
   `Doc` entity with correct `relatedTo` links (see `documentation-strategy.md`). Core's own docs
   (`wxops-core/docs/darlane.md`, `guardian.md`, `multi-cluster-proposal.md`) are plain markdown in a
   git repo with no catalog presence at all — they answer "why" but aren't discoverable the same way.
3. **"Why did this ADR happen, and did it actually work?"** — an ADR records a decision at the time it
   was made. Nothing today links it forward to whether the decision held up (a later incident, a
   superseding ADR) or backward to the commits that implemented it. `system-intelligence.md` §7 already
   names the target — *"attach findings to a runbook or ADR Doc entity, turning an incident into
   durable, catalog-legible institutional memory"* — as vision, with no mechanism yet.

## Detailed Design

Four candidate architectures. They are not mutually exclusive — B and D, in particular, could layer on
top of A — but each implies a different owner and a different amount of new infrastructure.

### Option A — Portal-owned: extend the existing `Doc` catalog + a new git-derived query layer

Keep the graph entirely inside what Portal already owns: the `Doc` entity model
(`relatedTo`/`supersededBy`) plus a new read layer that mines git/Gitea history (commit trailers or
PR-title conventions referencing a `Doc` name) to answer "what commit resolved this" on demand — no new
persistence, computed the same way the catalog cache already is. Core's own markdown docs would need to
either (a) get pulled into the catalog as `Doc` entities too (a real scope increase — Core docs aren't
catalogued today), or (b) stay outside the graph entirely, which reopens gap #2 above.

**Owner:** Portal backend (`internal/catalog`, possibly a new `internal/knowledge` package).
**Core touched:** only if Core's docs join the catalog — otherwise not at all.

### Option B — Core-owned: a Kubernetes-native knowledge layer

Take "system docs as a Kubernetes layer" literally: represent decision/doc lineage as something Core's
compositions are aware of, not just something the Portal's app-layer cache knows about — the same
pattern already used for `XTenantApp`/`Darlane` status write-back, where the *platform* holds the
truth and the Portal is a read-only renderer of it. Concretely, this could mean a lightweight CRD
(working name `XDocGraph` or annotations on existing XRs) that Core's tooling populates — e.g. a
`wxops-core` Makefile target (alongside the existing `validate`/`render`/`lint`/`kcl-check`) that scans
commit history and doc frontmatter and writes/refreshes graph edges as a CR, independent of whether the
Portal is even running.

**Owner:** Core (`wxops-core`) for the CRD/composition and any git-mining tooling; Portal only reads
and renders, exactly like it does for ArgoCD/XR status today.
**Why this might be the right split:** it keeps the Portal stateless and read-only (its defining
constraint, per `enterprise-roadmap.md` §0) while giving the knowledge graph a home that isn't tied to
one app's uptime — a CLI/CI job could query or refresh it without the Portal existing at all.
**Why it might not be:** it's a genuinely new kind of thing for Core to own — every existing XRD
represents *infrastructure*, not *documentation metadata*. Whether that's a natural extension of Core's
job or scope creep into territory Core was never meant to cover is exactly the kind of question this
RFC should surface, not presume an answer to.

### Option C — Adopt/adapt an external tool (`AndreaBozzo/gitnodes`)

Closest existing match found: notes as plain markdown in git, a disposable/rebuildable SQLite
projection (never a source of truth — architecturally the same stance as "catalog source of truth is
Git, portal cache is disposable"), typed relationship links (`supersedes`, `causedBy`, …) written
directly in the markdown, and read-only MCP tools (`node_links` walks ADR → incident → postmortem →
superseding ADR in a handful of calls) — their `examples/demo-brain` demo walks exactly the scenario
this RFC is describing.

**Open compatibility question:** GitNodes' write path ("the UI commits directly or opens a PR
depending on your GitHub permissions") reads as GitHub-native, and this ecosystem is Gitea-only end to
end. Whether that's a shallow adaptation or means only the **data model and MCP query shape** are
reusable (with a Gitea-backed read/write layer built on this project's existing `internal/gitea`
client) is unresolved — and, notably, this question is *orthogonal* to the A-vs-B ownership question:
GitNodes' taxonomy could inform either a Portal-owned (A) or Core-owned (B) implementation.

**A cheap way to gut-check fit before deciding anything:** run `gitnodes preview` locally against their
demo repo and see whether its node/link taxonomy (`CONFIGURATION.md`) covers what this ecosystem
actually needs — in particular, does it want first-class `incident`/`postmortem` node types, which
neither Portal's nor Core's current docs have.

**Underlying ecosystem, useful regardless of which option wins:** MADR (the ADR template this project's
own ADR structure already follows) and `adr-tools`/`log4brains` for numbering/superseding/browsable-log
generation — none do incident-linking on their own, which is specifically GitNodes' addition.

### Option D — Convention only: commit trailers, no new system at all

Independent of A/B/C: a `z-shell/.github`-style discipline — a commit or PR trailer
(`Refs-Doc: adr-005-...`, `Resolves-Runbook: runbook-database-failover`) that a human adds when a fix
lands, parsed on demand via `git log --grep` or the Gitea search API. Zero new infrastructure, and
cheap enough to trial on real fixes *before* committing to A, B, or C — it also produces the raw data
any of the other three options would need to index or graph.

## Drawbacks

| Option | Primary drawback |
|---|---|
| A — Portal-owned | Core's own docs stay a second-class citizen unless separately pulled into the catalog — a real scope increase |
| B — Core-owned K8s layer | A genuinely new category of thing for Core to own; XRDs have never represented documentation metadata before, and the case for that extension isn't made yet, only floated |
| C — adopt GitNodes | GitHub-native write/UI layer likely needs real adaptation for Gitea; a new external tool and taxonomy to maintain compatibility with either way |
| D — convention only | No enforcement and no query surface by itself — it's an input to the other options, not a complete answer on its own |

## Alternatives

- **Do nothing new; keep tracing "what fixed this" by memory and grep.** The honest status quo this
  RFC is reacting to, not a real alternative.
- **Fold this into Track A's audit-event pipeline** (`enterprise-roadmap.md` §7.2's shared
  `schemaVersion` + `layer` event family) rather than building a separate graph mechanism — a
  `layer: "git"` event emitted whenever a Doc-referencing trailer merges could produce lineage data as
  a byproduct of infrastructure being built for a different reason. Worth weighing against a
  purpose-built option above rather than assuming they're unrelated efforts.

## Rollout Plan

Sequencing constraints, not dates or a chosen option:

1. **Option D first, regardless of everything else.** It's the cheapest possible way to start
   generating real linkage data, and every other option benefits from having that data to design
   against instead of designing blind.
2. **The A-vs-B ownership question should be settled deliberately, not by default.** Defaulting to "of
   course the Portal builds it" because the Portal already has the `Doc` catalog is exactly the kind of
   unexamined assumption this RFC exists to interrupt — Option B deserves a real hearing before A wins
   by inertia.
3. **Option C's evaluation (the `gitnodes preview` spike) can happen in parallel with 1 and 2** — it
   informs taxonomy either way and doesn't commit to an ownership model by itself.
4. Whatever ships should be checked against the same "no new persistence beyond git" test the rest of
   the enterprise-roadmap tracks are held to, on whichever side of the Portal/Core line it ends up.

## Open Questions

**Ownership split (the central question)**
1. Is there a principled reason documentation/decision lineage should be a Core (Kubernetes-layer)
   concern versus a Portal (app-layer) concern — or is this purely a convenience/who's-available
   question dressed up as an architecture one?
2. If Option B is pursued, does a `wxops-core` CRD for doc lineage set an uncomfortable precedent (Core
   XRDs start representing non-infrastructure concerns), or is that too narrow a reading of what Core
   is "for"?
3. Does Core's own doc corpus (`darlane.md`, `guardian.md`, `multi-cluster-proposal.md`, …) need to
   join Portal's `Doc` catalog model at all, or can the graph span two different documentation systems
   (catalogued Portal docs + plain-markdown Core docs) without merging them?

**Schema**
4. Do `incident` and `postmortem` deserve first-class node/doc types, or do incidents stay as sections
   on existing Runbook/ADR entities, per `system-intelligence.md`'s current (vision-level) framing?
5. Does a `causedBy`/`resolvedBy` link need to point at another Doc, or does it need to point at a
   commit SHA / PR number — a target type nothing in this ecosystem represents today?

**Tooling boundary**
6. Has the `gitnodes preview` spike against `examples/demo-brain` actually been run yet? Until it has,
   "closest match" is a claim from GitNodes' own documentation, not a verified fit for this ecosystem's
   taxonomy needs.
7. If GitNodes' write/UI layer isn't Gitea-portable, is adapting it worth more or less effort than
   building a from-scratch Gitea-native equivalent that borrows only its data model?

**Convention design (Option D)**
8. What's the actual trailer syntax, and is it enforced anywhere — a CI lint step, similar to how
   `ensurePortalLabel()` enforces the `portal-managed` label today — or purely aspirational discipline?

**Relationship to existing/planned work**
9. Does this fold into Track A's audit-event schema family (`enterprise-roadmap.md` §7.2), or stay a
   separate mechanism? Alternatives above frames this as genuinely open.
10. Where does this sit relative to `system-intelligence.md`'s maturity phases (0 Assist → 3 Guarded
    autonomy) — a Phase 0 prerequisite, or a later enrichment once Phase 0 ships without it?

**Scope check**
11. Should "generate linkage data" (Option D, actionable immediately) ship and get evaluated
    independently of "decide who owns the graph and whether to adopt an external tool" (Options A/B/C,
    a much bigger and slower decision)?
