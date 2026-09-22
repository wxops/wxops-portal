# RFC-006: Darlane — What to Build on the Current Model vs. What to Wait for `XDarlane`

> **Status:** proposed — brainstorm draft. **Owner:** platform-team. **Spans:** `wxops-core`
> (`darlane.*` field today; `XDarlane` XRD if/when built) and `wxops-portal-v2`
> (`internal/scaffold/overlay.go`'s Darlane patch logic, the Promotion panel, `cli/internal/commands/darlane.go`).
>
> **Grounding:** [`../darlane/darlane.md`](../darlane/darlane.md) (shipped v0.4.0, current field-based
> model, its own "Not In Scope" table), `enterprise-roadmap.md` §6 (removed — its `XDarlane` XRD design
> is this RFC's own subject, referenced not re-derived; its Tracks A–D migrated separately to
> `RFC-010`/`RFC-011`/`RFC-012`), and `system-intelligence.md` (removed — content migrated to
> `RFC-009`; Darlane as the mandatory execution substrate for the intelligence vision — `XDarlane` is
> named there as a hard Phase-3 dependency, not optional polish).

---

## Summary

Darlane's current model (`darlane.*` on `XTenantApp`) has known, documented gaps — no TTL enforcement,
no CLI write path, image override not exposed, one-per-app ceiling. Separately, `enterprise-roadmap.md`
§6 already specs a complete replacement (`XDarlane` as a standalone XRD) that structurally fixes several
of the same gaps. This RFC's only real question is which current-model gaps are worth fixing now versus
which ones `XDarlane` will fix for free, where fixing them twice would be wasted work.

## Motivation

`darlane.md`'s "Not In Scope" table and `enterprise-roadmap.md` §6.1's comparison table describe
overlapping territory from two different angles — one lists what the shipped feature doesn't do, the
other lists what a structural rewrite would fix. Nobody has cross-referenced them. Two concrete examples
of why that matters:

- **TTL enforcement** is "informational only" today — `darlane.md` explicitly defers it to "the
  composition team." But `XDarlane`'s design makes `ttl` **mandatory, not advisory**
  (`enterprise-roadmap.md` §6.2's schema: `ttl: "8h"  # MANDATORY — ephemeral by design`). Building real
  TTL enforcement on the current field-based model, then rebuilding it again for `XDarlane`'s
  claim-based lifecycle, is exactly the kind of double work this RFC exists to prevent.
- **A CLI write path** (`wxops darlane enable`) was explicitly deferred — "CLI is read-only for Darlane
  config" per `darlane.md`. But `enterprise-roadmap.md` §6.3 already specs `wxops darlane new`/`rm`/`ls`
  against `XDarlane` claims specifically because multi-session, per-agent workspaces are the whole point
  of that redesign. A current-model `wxops darlane enable` would need to be thrown away, not migrated.

There's a second reason this isn't just internal tidiness: `system-intelligence.md` names `XDarlane` as
a **hard Phase-3 dependency**, not a nice-to-have — the SRE-agent incident-response loop specifically
needs "the agent opens its own `XDarlane` claim (TTL-bound, per-agent)," which the current one-per-app
model cannot provide at all. Darlane's roadmap isn't just developer-experience polish; it's the
long-pole dependency for the project's most ambitious stated direction.

## Detailed Design

### Gaps that are genuinely independent of `XDarlane` — safe to build now

- **Image override in the wizard.** Schema field already exists (`darlane.md`'s field table has
  `image`), just not exposed in the UI. Small, no structural dependency either way.
- **Sync-transport improvements** (`ROADMAP.md`'s "Inner-Loop Sync Transport" backlog: rsync delta sync,
  the sidecar file-receiver for distroless images, `config-gen` for Skaffold/DevSpace). These operate
  below the XR schema entirely — `wxops darlane sync`'s transport mechanism doesn't care whether the
  pod it's talking to is provisioned by a `darlane.*` field or an `XDarlane` claim. Fully decoupled from
  everything else in this RFC.
- **CLI `darlane.go` decomposition** (already scoped in `refactor-and-hardening.md`'s C2 workstream —
  1,272 lines, split by subcommand). Structural cleanup, orthogonal to the schema question. Note: the
  `platform-team` namespace bug that motivated workstream C1 is **already fixed** — verified directly by
  this session's test suite (`resolveTarget` and `debug.go` derive identically today) — so C1's
  bug-fix rationale is stale, though the "shared resolution package" dedup goal may still be worth doing
  for its own sake.

### Gaps that should wait for `XDarlane` — building them now is likely wasted work

- **TTL enforcement.** `XDarlane` makes this a first-class, mandatory field with (implied) Kyverno
  `ClusterCleanupPolicy` deletion of the claim itself — a fundamentally cleaner mechanism than
  scale-to-zero on a field embedded in the app's own XR. Building an inactivity-based or hard-cutoff
  controller against the current model now is very likely throwaway.
- **`wxops darlane enable`/write CLI verbs.** `enterprise-roadmap.md` §6.3 already specs the
  `XDarlane`-native equivalents (`new`/`rm`/`ls`) as "the primary driver for the agent workflows" —
  building a current-model write path first means either maintaining two CLI surfaces or discarding one.
- **Multi-session support.** Structurally impossible on the current model — `enterprise-roadmap.md`
  §6.1's comparison table states it plainly: "One Darlane per app" today vs. "Multiple concurrent claims
  per app" under `XDarlane`. Not a build-now-vs-later question; it's a hard blocker either way.
- **Guardian integration.** Explicitly gated on `XDarlane` shipping first (`enterprise-roadmap.md` §7:
  "strictly after `XDarlane`"). Not this RFC's decision to relitigate.

### The one thing worth preserving carefully as new work lands

`darlane.md` draws a sharp, correct line: *"`trafficWeight` is a dev tool, not a production A/B
mechanism"* — it's a Mirrord-controlled dev-cluster-traffic knob, structurally distinct from Argo
Rollouts' `canary.weight` for real production A/B. This distinction is a genuine strength (most
platforms blur exactly this line). Any sync-transport or CLI work landing in the "build now" bucket
above should not casually extend `trafficWeight`'s semantics without re-stating this boundary
explicitly — it's cheap to blur by accident and hard to un-blur once documented behavior depends on it.

## Drawbacks

| Choice | Drawback |
|---|---|
| Building "wait for `XDarlane`" items now anyway | Real risk of throwaway work, per the TTL and CLI-write examples above |
| Waiting for `XDarlane` before touching TTL/CLI-write | Those gaps stay open (TTL still "informational only," CLI still read-only) for however long `XDarlane` takes — which is itself gated on Phase 1/2 of `enterprise-roadmap.md`'s sequencing, not scheduled |
| Shipping sync-transport / image-override / CLI-decomposition now | None significant — genuinely independent, this is the low-risk bucket |

## Alternatives

- **Build `XDarlane` sooner specifically to unblock TTL/CLI-write**, rather than treating it as the
  capstone gated behind Phase 1–2 (`enterprise-roadmap.md`'s sequencing: Audit+Scorecards → Security+Cost
  → `XDarlane` → Guardian). This would mean re-ordering `enterprise-roadmap.md`'s own phase sequence,
  which that document frames as dependency-driven, not preference-driven — worth challenging explicitly
  if TTL/CLI-write urgency turns out to outweigh the stated dependency order, rather than assuming the
  existing order is final.

## Rollout Plan

1. **Ship the "safe now" bucket independently and immediately** — image override, sync-transport
   improvements, CLI file decomposition. None of these have a reason to wait.
2. **Do not start TTL enforcement or CLI-write verbs against the current field model** unless
   `XDarlane` is confirmed to be genuinely far out (re-check against `enterprise-roadmap.md`'s Phase
   1–2 timeline before committing resourcing either way).
3. **If `XDarlane` timing moves up** (see Alternatives), TTL and CLI-write become part of that
   workstream directly rather than a separate current-model effort — don't build them twice under any
   sequencing outcome.
4. This RFC does not touch Guardian's timeline — it stays exactly where `enterprise-roadmap.md` §7
   already puts it, strictly after `XDarlane`.

## Open Questions

1. Is there real, current user pain from TTL being informational-only (debug pods left running,
   consuming cluster resources) that justifies a stopgap on the current model despite the throwaway
   risk — or is this theoretical until real usage data says otherwise?
2. Same question for the CLI write path — is `wxops debug` (read-only, already shipped) actually
   sufficient for current users, making the deferred write path a non-issue until `XDarlane`?
3. Should `refactor-and-hardening.md`'s C1 workstream (shared `internal/resolve` package) still happen
   now that its bug-fix motivation is confirmed stale, purely for the dedup value — or is that better
   folded into whatever CLI restructuring `XDarlane`'s new verbs eventually require, to avoid touching
   the same code twice?
4. Does `enterprise-roadmap.md`'s phase ordering (`XDarlane` gated behind Phase 1–2 Audit/Security/Cost
   work) still hold, or does `system-intelligence.md` naming `XDarlane` as the load-bearing dependency
   for the intelligence vision argue for pulling it forward — and if so, who makes that tradeoff call?
