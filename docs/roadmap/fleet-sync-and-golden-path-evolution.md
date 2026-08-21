# Fleet Sync-Back & Golden-Path Evolution — Idea

> **Status:** Idea — revisit after v0.6.0's refactor and the OSS-hygiene docs
> (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue templates) ship. Not
> scheduled. This is a pointer for whoever picks it up next, not a build spec.
> **Spans:** `wxops-templates` (source of the design) and `wxops-portal-v2`
> (`backend/internal/handlers/scaffold.go` — post-refactor shape not yet known).
> **Companion docs:** `wxops-templates/RFC-001-fleet-sync-and-gitflow-flexibility.md` (the
> original proposal) and the docs-site page
> `docs/scaffolding/fleet-sync-and-flexible-delivery.md` (the user-facing vision).

## Why this exists

Scaffolding today is one-directional and one-time: the portal copies and substitutes
template files into a new Gitea repo, and from that moment the repo has no link back to
`wxops-templates`. Every improvement made to a template — this session's own `packageManager`
wiring, ADR-002's real metrics instrumentation, any future base-image CVE patch — benefits
new scaffolds only. Every already-scaffolded repo stays frozen at whatever the template
looked like on its creation date. `wxops-templates/RFC-001` names this precisely and proposes
two related fixes: syncing template changes back into existing repos (Part A), and letting a
service choose its own delivery topology instead of the one hardcoded 3-env flow (Part B).

Both are real, multi-piece efforts. Neither should start against `handlers/scaffold.go` while
that file is one of the named "god files" the v0.6.0 refactor is about to split up — the
integration point would just need re-deciding once the refactor lands.

## What RFC-001 proposes

**Part A — Template Sync-Back.** A `.wxops/template.lock.yaml` marker written at scaffold
time (template name, `templateRef` sha, scaffold params) gives a future diff tool something
to compare against. Every template file is classified Platform-owned, Governance-owned, or
Scaffold-owned; only the first two are ever candidates for an automated sync. The mechanism is
a scheduled diff-and-PR bot — never a blind overwrite — that re-renders platform/governance
files against current template HEAD and opens a normal, CI-gated PR per repo.

**Part B — Configurable GitFlow.** A new `gitFlow: 3-env | 2-env | 1-env` field on
`template.yaml`, substituted into `ci.yaml` the same way `packageManager` is today. Only
promotion topology varies — `test`, `security`, doc-validation, and the release job stay
identical across all three flows, so choosing a shorter path never means losing a governance
guarantee.

Full detail, drawbacks, alternatives, and open questions for both parts live in the RFC
itself — this doc doesn't restate them.

## The correction: RFC-001's own technical foundation doesn't match reality

RFC-001's Appendix asserts (marked "Resolved... confirmed real, not a concept under
evaluation") that scaffolding runs through a `wxops.cloud/v1alpha1 Template` CRD reconciled
by a `wxops-system` operator, with an `actions:` pipeline
(`fetch-base-template` → `render-variables` → `write-lock-file` → `publish-github`). Part A's
entire mechanism — where the lock file gets written — is designed against that model.

**That CRD/operator doesn't exist anywhere in this codebase.** The real, current scaffold
flow is a synchronous Go HTTP handler: `POST /api/v1/scaffold/projects` →
`handlers/scaffold.go` → `buildTemplateVars` / `substituteVars` → direct Gitea API calls. No
CRD, no operator, no `actions` list. The same fictional CRD shape also turned up in
docs-site's `docs/scaffolding/golden-path.md` (inherited from the v0.4.x docs snapshot) —
fixed there separately, with a callout, alongside this doc.

**Concretely, this means:** any future `write-lock-file` step is a real code change inside
(whatever `handlers/scaffold.go` becomes after the refactor), not a fourth entry in a CRD's
`actions:` list. Whoever picks this up should verify the post-refactor scaffold code's shape
before designing the integration point — don't assume RFC-001's Appendix pipeline exists.

## The shape of the idea, kept at idea level

- **Lock file:** RFC-001's schema is reasonable as a starting point — `template`,
  `templateRepo`, `templateRef`, `scaffoldedAt`, `packageManager`, `runtimeVersion`. Drop
  `gitFlow` from it unless/until Part B is separately accepted.
- **File classification** (Platform-owned / Governance-owned / Scaffold-owned) is a good,
  directly reusable idea — it's an extension of the "Keep unchanged" list already in
  `wxops-templates/CLAUDE.md`'s "How to add a new template" section, not a new concept.
- **The diff-and-PR bot is the big, undecided piece.** RFC-001 leaves real questions open —
  who triages sync PRs, one-per-repo vs. batched, how to tell an intentional local override
  of a platform-owned file from genuine template drift so the bot doesn't produce noisy
  diffs. Each is a real design decision, not an implementation detail, and needs answering
  independent of when the refactor finishes.
- **Part B (GitFlow)** is independent of Part A — nothing about it requires sync-back to
  exist first. Its own risk is real and already named in the RFC: `1-env` drops the staging
  gate entirely, and the wizard likely needs an explicit warning step before a team can pick
  it, not just a dropdown option next to `2-env` and `3-env`.

## Next step, when it's time

Re-run an Explore/Plan pass against the post-refactor `handlers/scaffold.go` shape, and get
real answers to the bot's open questions above, before turning this into an implementation
plan.
