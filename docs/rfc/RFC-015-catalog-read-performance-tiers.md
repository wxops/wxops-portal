# RFC-015: Catalog Read Performance — A Three-Tier Escalation Path, Not a Rewrite

> **Status:** proposed — brainstorm draft. **Owner:** platform-team. **Spans:** `wxops-portal-v2`
> (`internal/catalog/` — `Store`, `RepoReader`, `LocalReader`; `internal/server/server.go`'s reader
> wiring) and, only at Tier 2, the Helm chart (a `git-sync` sidecar container + shared volume).
>
> **Grounding:** `docs/platform/ecosystem-tool-strategy.md` (still in `docs/`, not part of the RFC
> migration — it first named `git-sync` and the incremental-diff alternative, and set the sequencing
> rule this RFC follows: build the cheap fix first, confirm it isn't enough before reaching for
> `git-sync`) and this session's own direct reading of `internal/catalog/store.go`, `local.go`, and
> `internal/server/server.go`'s reader-selection wiring — the concrete findings below (the
> `RepoReader` interface, `LocalReader`'s existing reuse potential, and the `specFetcher` exclusivity
> gap) come from that code, not from the source doc.

---

## Summary

The catalog's read path has one real, named problem: on every cache miss, `Store` re-fetches every
catalog file over the Gitea REST API, one round trip per file, independently, per replica. There are
four candidate responses, not one. This RFC proposes treating them as an **explicit escalation
ladder with named triggers for moving up a tier** — never presented as "do all four," and never
skipping a tier without the evidence that justifies it. Two further options (a shared RWX volume, a
shared Redis-like cache) are evaluated and explicitly rejected as out of scope for this codebase's
current scale.

## Motivation

The problem is real but not urgent — worth stating plainly before proposing anything. Nothing in this
codebase today measures or complains about Gitea API load from the catalog read path; the motivation is
architectural foresight (`ecosystem-tool-strategy.md` named it), not a live incident. That distinction
should shape the Rollout Plan: **build the cheapest tier first, and don't move to the next one without
evidence the current tier is actually insufficient** — the opposite of picking the most sophisticated
option because it's the most interesting one to build.

## Detailed Design

### Tier 0 — status quo, and a legitimate place to stay

Per-replica in-memory cache, 5-minute TTL, full re-fetch of every file on miss. Zero new infrastructure,
fully preserves the stateless-replica model — every portal pod is independently self-sufficient, and
losing one costs nothing another replica shares. **Stay here if:** replica count is low, catalog size
matches the project's own designed-for scale (`ROADMAP.md`'s Architecture Decisions table: *"Client-side
filtering first — Catalog rarely exceeds hundreds of entities"*), and nothing indicates Gitea API load
or catalog-refresh latency is an actual, measured cost. This is not a strawman baseline — it's a real
node in the decision tree, and probably where most deployments should stay indefinitely.

### Tier 1 — incremental webhook-diff (the cheap fix)

Track the last-synced commit SHA per replica (in-memory only, no persistence — lost on restart, which
is fine, it just means the next fetch after a restart is a full walk, same as today). On the existing
`POST /api/v1/webhooks/catalog/refresh` trigger, diff against Gitea's compare-commits API instead of
re-fetching everything, and patch only the changed files into the cache.

**Move here when:** Gitea API call volume from catalog refreshes becomes a measured, named cost — rate
limiting, noticeable load, or latency on refresh becoming visible — but replica restarts/redeploys are
infrequent enough that "one full walk per replica lifetime" isn't itself the bottleneck.

**Cost:** pure Go, no new infrastructure, no new credential, no new failure mode. The smallest possible
move off Tier 0.

### Tier 2 — `git-sync` sidecar, per-replica

The escalation this session already scoped in detail. The key finding, worth restating as the center of
this RFC's Detailed Design: `RepoReader` is a 3-method interface (`GetFile`/`ListFiles`/`ListDirs`),
`Store` doesn't care which implementation backs it, and `LocalReader` — which already exists for
`CATALOG_LOCAL_DIR` — already does exactly what a `git-sync`-fed reader needs. **Production `git-sync`
integration is a deployment change, not new application code**: point `CATALOG_LOCAL_DIR` at the
sidecar's clone directory instead of a static example dir, and reads become local-disk reads with zero
per-file network round trips.

**Two concrete prerequisites, found by reading the current wiring, not hypothetical:**

1. **`server.go`'s reader-selection switch is exclusive** — `specFetcher` is only ever assigned in the
   `gc != nil` branch, which is skipped entirely when `CatalogLocalDir != ""`. Harmless today because
   the two are never both configured in a real deployment. A production `git-sync` setup needs *both*
   simultaneously (local dir for reads, `GITEA_URL` still configured for writes and OpenAPI spec-fetch)
   — so this switch must become non-exclusive before Tier 2 ships, or spec-fetching silently breaks.
2. **`git-sync`'s clone target must land at `GITEA_CATALOG_PATH` inside the repo, not the repo root** —
   `LocalReader` expects kind-dirs (`components/`, `apis/`, …) directly at its configured root, the same
   way `CATALOG_LOCAL_DIR` already must today. This is a `git-sync` config detail (its own `--root` /
   destination flag), not a Go change, but it's exactly the kind of thing that's silently wrong once and
   costs an hour to debug if it isn't decided explicitly up front.

**Move here when:** Tier 1 isn't enough — specifically, when replica restarts/scale events are frequent
enough that "a full walk once per replica lifetime" becomes a recurring, measured cost (frequent
redeploys, active HPA scaling), or when Gitea's *live availability/latency itself* — not just call
volume — becomes the actual bottleneck, since `git-sync` decouples serving from Gitea being reachable at
request time.

**Cost:** a sidecar container, a shared `emptyDir` (no PVC — a pod restart just re-clones, matching the
project's own storage-decision-avoidance stance elsewhere), and its own scoped repo credential. Does
**not** reduce aggregate outbound traffic to zero — N replicas still mean N independent continuous small
pulls, same order as today, different shape. The win is latency and Gitea-availability decoupling, not
traffic elimination — stated precisely here so it isn't oversold the way the original framing of this
idea risked doing.

## Drawbacks

| Tier | Drawback |
|---|---|
| 1 — incremental diff | In-memory last-synced-SHA is lost on restart — the "cheap" tier's saving is proportional to how long a replica lives between restarts, which this codebase doesn't currently control tightly |
| 2 — `git-sync` | New sidecar, new credential, new staleness/liveness failure mode; the two prerequisites above are real work, not free, even though the core reuse is close to free |
| Escalating too early | Every tier above 0 is real engineering and operational cost for a problem that, as of this RFC, has no measured evidence behind it — the biggest risk here is building Tier 2 because it's the most interesting option, not because Tier 0/1 were shown insufficient |

## Alternatives — evaluated and explicitly rejected

Two further options exist and were part of the comparison that led to this RFC. Recorded here as
**rejected for now**, not omitted, so they aren't independently rediscovered and re-proposed without
this reasoning attached:

- **A shared `ReadWriteMany` volume + one singleton sync Deployment**, all replicas mounting the same
  pre-cloned volume read-only. Genuinely reduces outbound traffic to O(1) regardless of replica count —
  the one thing Tier 2 doesn't achieve. **Rejected** because it requires an RWX-capable storage class
  this project doesn't otherwise need (`ecosystem-tool-strategy.md`'s own storage section leans toward
  the lightest possible option, `local-path-provisioner` — RWX is a step in the opposite direction), and
  it introduces a singleton component the portal depends on to boot, breaking the independently-stateless
  replica model every other tier preserves.
- **A shared cache service (Redis or similar)**, giving every replica one shared, dedup'd read. Also
  reduces traffic to O(1), and adds a general-purpose shared-state primitive future features could lean
  on. **Rejected** because it directly contradicts the security-assurance A6 claim ("no portal
  database... nothing to exfiltrate or breach at rest") and the same reasoning `RFC-010`'s source
  material already stated generally: *"the moment we add a stateful cache, we forfeit the thing that
  makes the security review easy."* That reasoning isn't specific to audit data — it applies here
  identically.

Both are worth revisiting only if replica count and catalog size both grow well past this project's
current designed-for scale ("hundreds of entities," per `ROADMAP.md`) — not as a default direction.

## Rollout Plan

This RFC's rollout *is* the tier ladder — restated as steps rather than architecture:

1. **Instrument before escalating.** Neither Tier 1 nor Tier 2 should start without first confirming
   there's something to measure — Gitea API call volume from catalog refreshes, refresh latency, or
   replica restart frequency. Building the escalation path before there's a number to point at inverts
   the point of having named triggers at all.
2. **Tier 1 first, always**, if the evidence from step 1 justifies moving at all. Zero new
   infrastructure, smallest possible change, reversible.
3. **Tier 2 only after Tier 1 is confirmed insufficient** — not "Tier 1 is done, might as well add Tier
   2 for extra safety." The two prerequisites (the `specFetcher` switch fix, the `git-sync` root-path
   decision) land as their own small, reviewable changes before the sidecar itself.
4. **The rejected Alternatives don't get a rollout step** — they're recorded, not scheduled, and
   revisiting either requires a fresh scale argument, not inheritance from this RFC's momentum.

## Open Questions

1. What's the actual metric and threshold that constitutes "Tier 1 isn't enough" — a specific Gitea API
   call rate, a specific p99 refresh latency, a specific restart frequency? This RFC names the triggers
   qualitatively; someone needs to pick real numbers before they're actionable.
2. Does Tier 1's in-memory last-synced-SHA need to survive a graceful pod shutdown (e.g. written to a
   local temp file an `emptyDir` restart could recover), or is "lose it every restart" genuinely
   acceptable given how infrequently that's expected to matter?
3. Is there a real deployment (self-hosted `kind`/`k3d` demo included) where Gitea itself is
   rate-limited or resource-constrained enough that Tier 0's current behavior already causes visible
   pain — i.e., is there a shortcut to skip straight to "step 1: instrument" with real data already in
   hand, rather than needing to wait for it?
4. Should the `git-sync` credential (Tier 2) be scoped identically to the existing `gc` Gitea client's
   credential, or does running two credentials with different scopes against the same repo (one
   read-only for `git-sync`, one read-write for `gc`) reduce blast radius enough to be worth the extra
   credential to manage?
