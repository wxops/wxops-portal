# RFC-007: Golden-Path Template Sync-Back — Pulling Platform Updates Into Already-Scaffolded Projects

> **Status:** proposed — brainstorm draft. **Owner:** platform-team. **Spans:** `wxops-templates`
> (source templates, ownership classification), `wxops-portal-v2`
> (`backend/internal/handlers/scaffold.go`'s `buildTemplateVars`/`substituteVars` pipeline — the
> mechanism a sync re-render would reuse, not replace), and whatever runs the sync job itself (open
> question below).
>
> **Grounding:** this formalizes `wxops-templates`' own `RFC-001-fleet-sync-and-gitflow-flexibility.md`
> Part A ("Template Sync-Back"), already summarized and corrected once in
> `fleet-sync-and-golden-path-evolution.md` (removed — Part A migrated here, Part B migrated to
> `RFC-014`) — that doc found RFC-001's Appendix assumed a `Template` CRD/operator that doesn't exist;
> the real integration point is the synchronous Go scaffold handler. This RFC picks up that correction
> and grounds Part A specifically
> against the current, tested shape of that handler, not the fictional one.

---

## Summary

Scaffolding is one-directional and one-time: `CreateProject` writes template files into a new repo
once, and from that moment the repo has no link back to the template it came from. A platform-side fix
— a CVE patch to the base Dockerfile, a new required CI security-scan step, a bumped shared tool
version — benefits new scaffolds only; every already-scaffolded service stays frozen. This RFC proposes
a scheduled diff-and-PR mechanism that re-renders a project's **platform-owned files only** against the
current template and opens a normal, reviewable PR when they've drifted — with team-owned application
code structurally excluded from the mechanism, not just conventionally protected.

## Motivation

This is a live gap, not a hypothetical one — confirmed directly against the current handler: `CreateProject`
→ `createViaGitea` writes template files at creation time with no revisit mechanism anywhere in the
codebase. Concretely: a security fix lands in `wxops-templates`' Go service Dockerfile today, and every
Go service already scaffolded before that commit never sees it unless a human manually finds and ports
the diff — for every repo, individually, forever.

The motivating worry driving this RFC's shape isn't "how do we sync files" — that part is easy. It's
**"how do we do this without ever touching a team's actual code,"** which has to be the load-bearing
design constraint from the start, not a safety check added after a working prototype.

## Detailed Design

### The core safety mechanism — already conceptually settled

1. **File classification.** Platform-owned (Dockerfile, `ci.yaml`, health-check boilerplate, shared
   error handling) / Governance-owned (required CI gates, security scan steps) / Scaffold-owned
   (everything the team actually writes). **Only Platform- and Governance-owned files are ever sync
   candidates.** This needs a new field in each template's `template.yaml` — today's schema
   (`recommends`/`defaults`, read by `fetchTemplates`) has no ownership metadata at all. Additive, not
   breaking.
2. **Never a direct write.** The mechanism always produces a PR, reusing the exact commit-then-PR
   pattern every other write path in this codebase already relies on (`portal-managed` label,
   CI-gated review). No new trust model — the existing one, applied to a new trigger.
3. **A lock file** (`.wxops/template.lock.yaml`) written once at scaffold time: template name, the
   `templateRef` (a commit SHA in `wxops-templates`), and the exact scaffold params. This is not new
   data — it's persisting the same `map[string]string` `buildTemplateVars` already constructs and
   currently discards after one use.

### The re-render mechanism, grounded in the actual current pipeline

`substituteVars` performs literal string replacement (`{{ .Key }}`, `{{.Key}}`, `__KEY__`) against
whatever map `buildTemplateVars` builds — tested directly this session, table-driven, in
`backend/internal/handlers/scaffold_templates_test.go`. A sync job needs no new rendering engine:

1. Read a repo's lock file to recover its original scaffold params.
2. Fetch the current template HEAD from `wxops-templates`.
3. Re-run the identical `buildTemplateVars`/`substituteVars` pipeline against the current template
   content, using the **same recovered params** — reproducing exactly what scaffold would generate
   today, for that repo, at that param set.
4. Diff the result against the file as it exists in the repo now, restricted to files the
   classification marks Platform- or Governance-owned.

This is the same conclusion `RFC-001-manifest-rendering-and-template-ownership.md` reached from a
different direction: the string-substitution layer is worth keeping and reusing, not replacing with a
new templating engine. Sync-back is a second consumer of that same pipeline, not a reason to change it.

### What's genuinely unsolved — the honest gap

Telling "the team deliberately changed this platform file on purpose" from "this file drifted and
nobody noticed" — a diff against the *freshly re-rendered* template can't distinguish these; both
produce the identical signal (current file ≠ what re-rendering produces).
`fleet-sync-and-golden-path-evolution.md` names this as the RFC's biggest open question and doesn't
answer it either. Real options, not yet chosen:

- **(a) A local-override marker.** A team sets a one-time flag on a file to permanently exclude it from
  sync consideration. Simple, but a silent opt-out — the platform loses visibility into which repos
  have diverged from a security-relevant file.
- **(b) Always propose the PR; let a human close it if it's intentional.** Accepts review noise as the
  cost of never silently skipping a real drift. Scales badly if intentional overrides are common.
- **(c) A second hash in the lock file** — the hash of the file as scaffold originally left it. If the
  current file's hash still matches, it's untouched and safe to sync near-silently; if it doesn't, a
  human decided something, and the generated PR should say so explicitly ("this file was modified after
  scaffold — review carefully") rather than presenting a plain diff as if nothing happened.

## Drawbacks

| Area | Drawback |
|---|---|
| Lock file | New state that has to stay correct — if `buildTemplateVars`'s param shape changes (plausible, given ongoing scaffold work), old lock files reflect a stale shape and re-rendering may not reproduce cleanly unless the lock file schema is itself versioned |
| New infrastructure | A scheduled job against every scaffolded repo is new operational surface — nothing in the current stateless-by-design portal runs anything like this today |
| PR volume | A single platform-wide fix (e.g. a base-image CVE patch) could open one PR per affected repo simultaneously — a real review-load question at scale, not just an edge case |

## Alternatives

- **Do nothing; rely on humans noticing drift.** This is today's actual behavior, named here so its
  cost is explicit: security fixes and tool updates don't propagate unless someone remembers to port
  them by hand, repo by repo — which is the problem motivating this RFC in the first place, so "do
  nothing" is really just naming the status quo's cost plainly rather than a real alternative.
- **Notify, don't diff.** A portal notification ("your template has been updated, here's what changed
  upstream") with no auto-generated PR — the team ports the change manually if they choose to. Lower
  engineering cost, weaker guarantee, and sidesteps the override-vs-drift problem entirely by never
  attempting to solve it automatically. Worth real consideration as a cheaper first step.

## Rollout Plan

1. **Do not start building the sync job against `handlers/scaffold.go` while it's still a named
   god-file candidate for the v0.6.0 refactor** — `fleet-sync-and-golden-path-evolution.md`'s own
   constraint, restated here because it still holds: the integration point should be decided against
   the post-refactor shape, not the current one.
2. **Lock-file writing is useful and low-risk on its own** — persisting `buildTemplateVars`'s param map
   + `templateRef` at scaffold time could ship independently of the sync job itself, purely as
   forward-compatibility. Repos scaffolded without it can't be synced later without a backfill, so
   earlier is better regardless of when the rest of this RFC lands.
3. **File-classification metadata in `template.yaml` is additive schema** — safe to add in
   `wxops-templates` independently of any portal-side work.
4. **The sync job / diff-and-PR mechanism itself is the largest, riskiest piece and the one this RFC is
   least settled on** — should not ship until the override-vs-drift question above has a real, chosen
   answer, not a placeholder "we'll figure it out."

## Open Questions

1. Does the sync job live in the portal (new backend package, running on a schedule rather than
   per-request — a real departure from the stateless, request-driven model everything else follows), or
   as a standalone tool/CI job outside the portal entirely? This is the same shape of question
   `RFC-002` asks about Portal-vs-Core ownership, applied here to Portal-vs-standalone-tool.
2. Batched vs. per-repo PRs — does a platform-wide fix open one PR per affected repo (simple, matches
   the existing per-repo review model everywhere else in this project) or a summarized batch somewhere
   else, with a less obvious owner for who actually merges what?
3. Which override-vs-drift option (a/b/c above) is right — and does the right answer differ by file
   type? A changed Dockerfile is probably a rare, intentional override; a stale CI step is probably
   common, unnoticed drift. One policy for both may be wrong for one of them.
4. Should Governance-owned files get *stricter* treatment than Platform-owned ones — e.g. a drifted
   security-gate file blocking lifecycle promotion until resolved, versus a drifted Dockerfile staying
   purely advisory? Nothing today distinguishes enforcement level by classification tier.
5. Is this strictly application-repo scope (Dockerfile, CI, source boilerplate), or does it ever reach
   catalog/Kustomize-adjacent files? Those already have their own regeneration path via edit-config
   (and its own real gap — see `RFC-003`) — worth stating explicitly that this RFC does not extend
   there, so the two efforts don't collide later.
