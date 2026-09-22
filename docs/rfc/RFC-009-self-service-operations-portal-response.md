# RFC-009: Portal's Response to Self-Service Operations + Knowledge Architecture

> **Status:** proposed — brainstorm draft. **Owner:** platform-team. **Spans:** `wxops-portal-v2`
> (Runtime tab, alerts panel, Doc catalog entity schema, `internal/observability`) responding to two
> `wxops-core` documents that are largely Core-scoped by their own admission.
>
> **Grounding:** both source documents fetched and read in full —
> `github.com/wxops/wxops-core/blob/main/docs/core-ideas/self-service-operations.md` (the operability
> ladder, three-pillar architecture, error taxonomy) and
> `.../docs/core-ideas/knowledge-architecture.md` (the RFC/ADR/Runbook/Reference taxonomy, runbook
> format, knowledge representations for agents). **Real, verified overlaps, not assumed ones:** with
> `system-intelligence.md` (removed — content migrated here and to §6 below; the maturity-ladder
> convergence below), `RFC-002` (knowledge-architecture.md
> names the exact Doc-catalog-integration gap RFC-002 raised, independently), `RFC-004` (multi-cluster
> spoke access / global query layer), and `RFC-005` (the global metrics backend decision partially
> overlaps, at different scope, with the Prometheus-Operator-vs-VictoriaMetrics question already open
> there).

---

## Summary

Core has done substantial design work across two documents: `self-service-operations.md` specs a
three-pillar architecture (signals, runbooks, intelligence) converging on a PR-gated safety harness, and
`knowledge-architecture.md` specs the document taxonomy and runbook format that feeds it. Both are
explicit that Portal's role is real but undetailed — `self-service-operations.md` names "Portal: status
cards, error taxonomy fork logic, correlation display" in one line and stops;
`knowledge-architecture.md` states outright that Doc-catalog integration is "assumed separate." This RFC
is that missing Portal-side design — and it opens by naming a convergence neither Core document nor
Portal's own `system-intelligence.md` has noticed yet.

## Motivation

### The headline finding: two independently-built maturity ladders describing the same thing

Core's Operability Ladder (`self-service-operations.md` §3) and Portal's Maturity Phases
(`system-intelligence.md` §6) are the same idea at different granularity, built with no shared
vocabulary:

| Core's Operability Ladder | Portal's Maturity Phases | Alignment |
|---|---|---|
| L0 — infra always troubleshoots | *(below Phase 0)* | No Portal equivalent named |
| L1 — per-app dashboards visible | Phase 0 — Assist (context retrieval) | Roughly the same rung |
| L2 — alerts link to runbooks, RBAC-respecting commands | Phase 0 — Assist | Same rung, Core is more granular here |
| L3 — correlated diagnosis tool | Phase 1 — Diagnose (ranked hypothesis) | Same rung |
| L4 — suggested patch as reviewable PR | Phase 2 — Validate (Darlane twin + evidence-attached PR) | Same rung — both name this the practical target |
| L5 — auto-remediation, gated, not default | Phase 3 — Guarded autonomy (opens PR unprompted, never auto-merges) | **Both independently land on "never fully autonomous" as the permanent ceiling** |

The agreement at the ceiling (L5/Phase 3: never auto-apply, human merge stays load-bearing) is a real,
validated convergence — two teams reasoning independently and landing on the same safety boundary is
evidence the boundary is right, not a gap. The *disagreement* is just vocabulary: nothing maps Core's
6 rungs onto Portal's 4 phases today, so a contributor reading both documents has no way to know they're
describing one ladder, not two.

### Guardian's constraints and Portal's "what we will not do" — another confirmed match

`self-service-operations.md` §6 lists four hard Guardian constraints (read-only by default; in-cluster
inference only, no external LLM API on production data; agent is a scoped, auditable principal;
advisory posture, never blocks the human). `system-intelligence.md` §10's "What we will not do" table
says the same things independently. Also worth stating as confirmation, not a gap — but confirmation
that hasn't been cross-referenced anywhere.

### Where Core's own document is explicitly waiting on Portal

`self-service-operations.md` names its own open question #7 verbatim: *"Portal correlation logic:
Auto-fork rule for 'many tenants' `notReady` at once' is named as principle but not specified
(threshold, correlation key, escalation UX)."* That is Core's document directly asking Portal to answer
something. This RFC treats that as a real assignment, not a rhetorical gap.

## Detailed Design

### 1. Consume `status.notReady` the moment it exists — the single highest-leverage Core change

Core names this "the single highest-leverage core change this document proposes" — additive, `safe`-tier
KCL, small. Portal's consumption point is exact and already known from this session's own testing:
`handlers/observability.go`'s `readXR` currently reads only `.status.ready`/`.status.created`/`.status.url`/
`.status.image` (verified directly — `observability_test.go`, this session). Adding `notReady` parsing
is a small, additive, well-scoped change: extend the `xrStatus` struct, surface it in the `envStatus`
JSON, and render it as the actual reason a cell shows `ready: false` instead of today's undifferentiated
red state. This is the most concrete, immediately actionable item in this entire RFC.

### 2. Adopt Core's error taxonomy in the Runtime tab and alerts panel — nothing today does this

Core's Developer-side / User-side / Platform-side taxonomy (§7) is genuinely new, useful material with
no Portal equivalent. Two triage rules are worth building directly into the UI, not just documenting:
*"`ready: true` + users hurting ⇒ user-side"* (skip the XR tree walk, go straight to the alerts/metrics
view) and *"many tenants degrading at once ⇒ platform-side, stop self-serving"* (the auto-fork trigger
from open question #7 above). Concretely: the alerts panel (`GetEntityAlerts`, already built) is the
natural home for surfacing "this looks platform-side" once cross-tenant correlation exists — which
doesn't today, and is explicitly Portal's job per Core's own responsibility split.

### 3. Runbook `trigger` indexing — feeds `RFC-002` and `RFC-003` a concrete answer they didn't have

`knowledge-architecture.md`'s proposed runbook frontmatter (`id`, `kind`, `trigger`, `severity`, `rbac`,
`owner`, `last_verified`) is more concrete than anything `RFC-002` speculated about for Doc-entity
lineage fields. In particular, `trigger` is a **Doc-to-status-shape mapping**, not a Doc-to-Doc link —
answering part of `RFC-002`'s open question #5 ("does a link need to point at a target type the catalog
schema has never represented before?") with a real, working shape from Core's own design. `RFC-003`'s
"Doc gets a guided form" design point should adopt this frontmatter directly rather than inventing its
own, once `RFC-003`'s sequencing (behind `RFC-002`'s direction) resolves.

### 4. `knowledge-architecture.md`'s own named gap is real — Portal needs an actual answer, not a note

*"Portal catalog Doc entity integration: Not addressed; assumed separate."* Two real options, not
previously named in `RFC-002`: (a) Core's `docs/adr/NNN-title.md` and `docs/incidents/<id>.md` files
stay entirely in `wxops-core`, with Portal's Doc catalog only ever representing *tenant-facing*
ADR/RFC/Runbook content — a clean separation, at the cost of an SRE agent's "capture-incident" /
"distill-knowledge" skills (Core's proposed skills #7–8) never becoming visible in the portal UI at all;
or (b) Portal's catalog ingests Core's `docs/incidents/` and `docs/adr/` as read-only Doc entities via
the same Gitea-read pattern the catalog already uses for everything else — more visibility, more
coupling to a doc corpus Portal doesn't own or review.

### 5. Two decisions this RFC does not resolve, flagged so they aren't rediscovered independently

- **Global metrics backend** (Thanos Receive / Mimir / VictoriaMetrics) — `self-service-operations.md`
  §4 frames this as a multi-cluster aggregation decision (spokes `remote_write` to a hub-side backend).
  `RFC-005` already has VictoriaMetrics on the table for a *different* reason (Operator swap,
  single-cluster, "close to free"). Same tool short-list, different scope and different trigger — worth
  deciding together, since picking VictoriaMetrics for RFC-005's reason would also answer part of this
  question, and picking Thanos/Mimir for this document's reason would make RFC-005's Operator-swap
  premise moot.
- **Spoke access via "Option D" tunnel** — named in the Multi-Cluster On-Call Assembly section but not
  detailed here (it's specified elsewhere in Core's multi-cluster docs, not fetched for this RFC). Real
  overlap with `RFC-004`'s Track 1 (ingest path decision) — flagged, not resolved.

### 6. Playbooks and guardrails ported from `system-intelligence.md`, ahead of its removal

Two pieces of that document's content aren't captured by the maturity-ladder finding above and have no
other home once the source file is retired. Preserved here verbatim in substance, not because they're
new design work in this RFC, but because they'd otherwise be lost:

**On-call and hotfix playbooks (`system-intelligence.md` §7):**
- **On-call triage** (Phase 0–1, highest near-term value): a page fires, and the intelligence layer
  posts a triage bundle — service, owner team, current lifecycle/env; what deployed in the last two
  hours; blast radius ("N services across M teams consume this"); firing alerts plus the linked
  runbook; ranked hypotheses (*"most likely: PR #412 changed pool config 8m before onset"*). No twin, no
  fix — just the context an engineer would otherwise spend fifteen minutes assembling, in seconds.
- **Hotfix under pressure** (Phase 2–3 + Guardian): the scenario where CI is bypassed and an engineer or
  agent is patching directly in a steal-mode session because the incident can't wait. The fix is
  validated in the Darlane twin against mirrored real traffic before anyone sees it; Guardian AI is the
  second set of eyes precisely when normal PR review is unavailable; every action is audited to the
  SIEM, making `productionOverride: true` steal-mode defensible after the fact; the result is still a PR
  with evidence, not a mystery 4am change.
- **Deep analysis** (post-incident): because the twin can replay mirrored traffic and the catalog holds
  the dependency graph, the same machinery supports reproducing a failure with full tracing, walking the
  blast radius, and attaching findings to a runbook or ADR Doc entity — turning an incident into durable,
  catalog-legible institutional memory. This is the same "capture-incident" idea Core's
  `knowledge-architecture.md` proposes independently (item 4 above) — another instance of the two repos
  converging on the same capability without citing each other.

**Hard problems & guardrails (`system-intelligence.md` §8) — a risk catalog worth keeping intact:**

| Risk | Guardrail |
|---|---|
| Hallucinated / plausible-but-wrong fixes | Validation against real mirrored traffic is mandatory before a PR exists. No evidence, no PR. |
| Not everything reproduces (heisenbugs, infra faults, multi-service failures) | Must declare when it cannot reproduce and fall back to Phase 0 triage — a diagnostician, not a magician. |
| Data exfiltration via the model | In-cluster only, non-negotiable; Guardian audit flags any external call. |
| Latency of GitOps for a hotfix twin | The `XDarlane`-claim-via-Git latency tension applies here too; use the fast-sync ApplicationSet path, never a portal→cluster shortcut. |
| Over-trust / automation complacency | Autonomy capped at "open a PR"; precision measured per phase before advancing. |
| Noisy or gamed signals | Diagnosis stays advisory and ranked, never a single confident answer. |

None of these are new decisions — they're existing, already-settled guardrails that should survive
`system-intelligence.md`'s eventual removal somewhere, and this RFC is the most relevant surviving home
given item 1 above already treats that document's maturity model as load-bearing context.

## Drawbacks

| Item | Drawback |
|---|---|
| Adopting a shared maturity-ladder vocabulary | Requires editing an already-published Portal doc (`system-intelligence.md`) to either adopt Core's 6 rungs or reconcile the mapping — not a large change, but a real one, not zero-cost |
| `status.notReady` consumption | Depends on Core actually shipping the field first — Portal-side work here is blocked, not blockable-on-Portal |
| Error taxonomy in the UI | New rendering logic and a real design decision (auto-fork threshold) that Core's own document explicitly could not specify — the hard part is genuinely unsolved, not just undocumented |
| Doc-corpus integration (item 4) | Either option has a real cost — (a) loses agent-capture visibility in the portal; (b) adds coupling to an unreviewed external corpus |

## Alternatives

- **Leave the two maturity ladders as-is, unreconciled.** Cheapest option. Real cost: anyone who reads
  both documents (which this RFC just did) has to do the mapping mentally every time, and the two teams
  risk making incompatible decisions about the same rung (e.g. Core changing what L4 means without
  Portal's Phase 2 definition moving in step).
- **Wait for Core to ship `status.notReady` before doing any Portal-side design work at all.** Avoids
  speculative work, but the consumption point (item 1) is small enough that having Portal's side ready
  to merge the moment the field lands is worth the small risk of the field's shape changing before it
  ships.

## Rollout Plan

1. **Item 1 (`status.notReady` consumption) can start speculatively now, or wait for the field to ship
   — either is defensible, but don't let it sit unbuilt after Core ships it, since it's the field
   "every later step keys off" per Core's own build sequence.**
2. **Item 2 (error taxonomy in the UI) is the piece Core's own document is explicitly waiting on Portal
   for** (open question #7) — this is the one item in this RFC with a named external dependency on
   Portal specifically, not a nice-to-have.
3. **Item 3 (runbook `trigger` frontmatter) should be folded into `RFC-003`'s Doc guided-form design
   once RFC-003's own sequencing (behind RFC-002) resolves** — don't build a competing schema in the
   meantime.
4. **Item 4 (Doc-corpus integration) needs a decision before either option is built**, and that decision
   is genuinely this RFC's biggest open question, not a rollout detail.
5. **Items 5's two flagged overlaps (metrics backend, spoke tunnel) are not this RFC's to resolve** —
   they're pointed at `RFC-005` and `RFC-004` respectively so a future reader doesn't have to rediscover
   the connection.

## Open Questions

1. Does Portal adopt Core's 6-rung Operability Ladder as the canonical vocabulary (editing
   `system-intelligence.md` to match), does Core adopt Portal's 4-phase model, or does a bridge table
   (same pattern as `RFC-008`'s Core/Portal security bridge) stay the permanent answer?
2. What's the actual auto-fork threshold and correlation key for "many tenants degrading at once"? Core
   explicitly left this to Portal — this RFC hasn't answered it either, and it's the one item that
   should not stay open indefinitely given Core is waiting on it.
3. Which Doc-corpus integration option (item 4) is right, and does it change if/when `RFC-002`'s
   Portal-vs-Core knowledge-graph ownership question resolves — are these actually the same decision
   wearing two names?
4. Should the runbook `trigger` field format be proposed back to Core as a joint schema (since Portal's
   `RFC-003`/`RFC-002` would consume it too), or does each repo maintain its own runbook format for its
   own audience (Core's SRE-agent skills vs. Portal's tenant-facing Doc entities)?
5. Is there a real near-term driver for any of this (an actual incident that took too long to diagnose),
   or is this — like `RFC-004` — genuinely speculative against the project's "driven by adoption, not a
   date" stance? Worth asking plainly before resourcing item 2 specifically, since it's the one piece
   with real design cost.
