# RFC-011: Governance, Scorecards & Team Health

> **Status:** proposed — formalizing already dev-ready specs into RFC form.
> **Owner:** platform-team. **Spans:** `wxops-portal-v2` (`internal/scorecard/`, catalog schema
> additions, reverse-dependency resolvers).
>
> **Grounding:** merges `enterprise-roadmap.md` §4 (Track C) and `devex-integrations.md` §3
> (Productivity Signals) — both removed, content migrated here — the source documents already paired
> these themselves (devex §3's own header: *"Extends Track C"*). **Depends on `RFC-010`** (scorecards consume Track A's
> compliance posture signal) **and, loosely, on `RFC-012`** (CVE burn-down feeds the team-health
> security dimension). **Real overlap** with `ROADMAP.md`'s existing "Cross-Tenant Dependency
> Visibility" backlog section — same feature (reverse `consumesApis`/`dependsOn` edges), described in
> two places; this RFC is the one to keep.

---

## Summary

Two related capabilities, both pure computation over data the portal already has: a per-Component
production-readiness scorecard (owner, docs, API spec, CI health, compliance posture), and a
team-scoped "Team Health" view built from the same signals plus DORA-lite metrics — explicitly *not* an
individual-productivity surveillance tool. Neither needs a new data source.

## Motivation

Platform teams evaluating whether a service is production-ready today do it by memory and habit, not
by a computed signal — despite every input (ownership, docs, CI status, compliance posture) already
being in the catalog or Track A's compliance panel. Separately, "how is my team's software actually
doing" has no answer beyond scattered dashboards, and the danger of building that answer badly is real
enough that the source document leads with an explicit ethical stance before any design: **team/service
outcomes, never individual output or rankings.**

## Detailed Design

### Production-readiness scorecard

Per-Component score (0–100) across weighted checks:

| Check | Signal | Source |
|---|---|---|
| Has owner + PIC | `spec.owner`, `spec.pic` (new field) | Catalog |
| Has description + tags | metadata | Catalog |
| Has API spec (if exposes API) | linked `API` entity | Catalog graph |
| Has runbook | `Doc` with `docType: runbook` + `relatedTo` | Catalog graph |
| Has health endpoint | scaffold contract / annotation | Catalog |
| CI green on default branch | latest workflow run | Gitea Actions |
| Compliance posture clean | `RFC-010`'s posture panel | — |
| No unresolved HIGH SBOM findings | `RFC-012`'s SBOM index | — |

Advisory by default; a platform team can optionally gate promotion on a minimum score — a config flag
enforced in the existing `PromoteLifecycle` handler, never altering the existing role-gate semantics.

### Ownership & responsibility — new, additive catalog fields

`spec.pic` (Person In Charge) and `spec.collaboratesWith` (co-owning teams) — additive, backward
compatible. Rendered as a contact card (PIC with Gitea profile link) and cross-team links; feeds both
the scorecard above and cross-team review routing.

### Cross-tenant blast radius — the same feature `ROADMAP.md`'s backlog already names

Reversing the existing one-directional dependency edges:

- **"Consumed by"** on `API` entities — every Component, any tenant, that declares `consumesApis`
  pointing here.
- **"Used by"** on `Resource` entities — every Component that `dependsOn` this resource.
- **Deprecation blast radius** — before confirming a deprecation, compute "N components across M teams
  consume this" — a pure graph query over the already-cached catalog, no new data source.

### Team Health — the stance comes before the design

| We measure | We do **not** measure |
|---|---|
| Team / service outcomes | Individual output or rankings |
| Flow health (lead time, deploy frequency, MTTR) | Lines of code, commit counts, hours |
| Posture & quality (scorecard, CVE burn-down, test trend) | Anything usable to stack-rank a person |
| Signals a team uses to improve its own product | Signals a manager uses as a stick |

A Team Health view on the Group page, composed entirely from data this RFC and its dependencies already
compute:

| Dimension | Signal | Source |
|---|---|---|
| Flow | Deployment frequency, lead time, MTTR | DORA-lite (below) |
| Quality | Scorecard, test trend (opt-in) | Scorecard + `RFC-013` |
| Security hardening | Open CVE count + burn-down | `RFC-012`'s CVE index |
| Product maturity | Catalog completeness, doc/runbook coverage | Catalog graph |

Rendered as **trends**, not absolute scores to rank against — "is this getting better?" not "how do we
compare to that team?" No cross-team comparison, no leaderboards, by design.

### DORA-lite

Two metrics from data already collected: deployment frequency (successful prod workflow runs/week) and
lead time (PR open → merge → prod image tag). Rendered on Group and System detail pages.

### Backend surface

```
internal/scorecard/            NEW — score computation over catalog + CI + posture; team-health aggregation
internal/handlers/catalog.go   + reverse-dependency resolvers, + GetTeamHealth
internal/catalog/              + spec.pic, spec.collaboratesWith parsing
```

```
GET /api/v1/catalog/entities/:kind/:name/scorecard
GET /api/v1/catalog/entities/:kind/:name/consumers
GET /api/v1/catalog/dora?team=
GET /api/v1/catalog/groups/:team/health
```

## Drawbacks

- Scorecard weighting is inherently a judgment call — whatever weights ship first will look arbitrary
  to someone; needs to be documented as advisory and adjustable, not treated as objective.
- **The individual-vs-team-scope line is easy to erode over time** even with the explicit stance above
  — the acceptance criteria (below) need to stay enforced in review, not just stated once in a design
  doc that gets deleted.
- Reverse-dependency queries are O(N) over the full catalog — fine at today's scale, worth re-checking
  if the catalog ever grows past "hundreds of entities" (the scale this project already designs around).

## Alternatives

- **Skip Team Health entirely and ship only the scorecard.** Real option — the scorecard alone delivers
  most of the value with none of the surveillance-adjacent risk. Worth considering shipping in that
  order regardless of whether Team Health ships at all.

## Rollout Plan

1. `spec.pic`/`spec.collaboratesWith` schema additions and the reverse-dependency resolvers first —
   both are additive, low-risk, and the blast-radius feature specifically closes a real gap
   (`ROADMAP.md`'s backlog already flags it, unimplemented).
2. Scorecard computation next — depends on `RFC-010` for the compliance-posture check, degrades
   gracefully (skip that check) if Track A hasn't shipped yet.
3. Team Health last, and only after its two harder dependencies (`RFC-012`'s CVE index, `RFC-013`'s test
   trend) exist — building it earlier means most of its dimensions show as empty.
4. **No individual-level view, ever** — this isn't a phase-gated item, it's a permanent constraint that
   should be checked at every step, not just step 3.

## Open Questions

1. Should scorecard-gated promotion default to off forever, or is there a real adopter scenario where
   opt-in-by-default makes sense? The source document says opt-in, per-platform, default off — worth
   confirming that's still right rather than inherited without re-checking.
2. Is there a risk that "Team Health" trends get used punitively anyway, regardless of design intent —
   and if so, is a technical control (no individual view) sufficient, or does this need a documented
   usage policy alongside the feature?
3. Does the cross-tenant blast-radius feature need an opt-in visibility control (a tenant suppressing
   exposure of its internal topology), per the existing `ROADMAP.md` backlog note, or is "visible to
   any authenticated user" acceptable given the catalog is already broadly readable?
