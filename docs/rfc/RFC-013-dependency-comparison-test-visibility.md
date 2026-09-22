# RFC-013: Dependency Comparison Performance & Test Visibility

> **Status:** proposed — formalizing already dev-ready specs into RFC form.
> **Owner:** platform-team. **Spans:** `wxops-portal-v2` only — `internal/gitea/`,
> `internal/handlers/catalog.go`, `internal/testreport/` (new). No cross-repo dependency, no CI
> prerequisite for the dependency-comparison half.
>
> **Grounding:** `devex-integrations.md` (removed) §2 (Test Visibility) and §4 (Dependency Comparison)
> — grouped together here because both are Portal-only surfacing work with no enterprise-track anchor
> strong enough to justify folding into `RFC-011`/`RFC-012`, unlike that document's other two sections
> which explicitly named their parent tracks.

---

## Summary

Two independent, low-risk improvements to data the portal already reads. Dependency comparison is
mostly a **performance and correctness fix wearing a feature's clothes** — the current package-reads
path has no cache and a real N+1 read pattern, and adding a `ref` parameter turns "what changed since
we shipped?" from an unanswerable question into a cache-hit. Test visibility is a small, fully opt-in
read-only panel showing CI-produced test results — the portal never runs or requires tests, only
displays what already exists.

## Motivation

**Dependency comparison** is motivated by two specific, already-diagnosed problems, not a hypothetical:
`GetEntityPackages` has no cache and `DiscoverPackages` probes up to `4 × (1 + N)` Gitea file reads per
page view for manifests that change roughly weekly — the portal re-derives on every load what barely
moves. Separately, `GetRepoFile` takes no `ref` and always reads the default branch, so "which
dependencies moved since v0.4.1?" has no answer in the portal today; a developer leaves to read two
`go.mod` files side by side on Gitea manually.

**Test visibility** is motivated by a stance, not a bug: testing is and stays the developer's
responsibility, running in CI — but test *results* are currently invisible outside CI logs, and a team
that wants to showcase a green suite and real coverage as evidence of maturity has no way to.

## Detailed Design

### Dependency comparison — four changes, in dependency order

1. **Thread a `ref` through the read path.** `GetRepoFile` and `DiscoverPackages` take an optional ref;
   empty preserves today's default-branch behavior exactly. `?ref=` already exists as a pattern
   elsewhere in `internal/gitea/write.go` — this follows precedent, doesn't invent one.
2. **Cache by `owner/repo@ref`, with two TTLs.** A tag is immutable — `v0.4.1` resolves to the same tree
   forever, cacheable aggressively. The default branch moves and gets a short TTL. This distinction is
   the entire performance win: a compare against a release is a cache hit on the second request onward.
3. **Diff in Go, not the browser.** `DiffManifests(base, head)` — a pure function over two
   `[]PackageManifest`, no I/O, trivially unit-testable, one round-trip instead of two, and it avoids
   shipping two full 200-package manifests to the client just to diff them there.
4. **Server-render the default view; keep compare client-side.** The Component detail page is already a
   server component — fetch during render, pass as props, wrap in `<Suspense>` so a cold cache streams
   rather than blocks (matching the v0.5.0 dashboard treatment). The card paints with data instead of a
   spinner.

**Compare scope is deliberately narrow:** current default branch vs. **one** selected release from
`ListReleases` (which already exists), not arbitrary ref pairs — "what changed since we shipped?" is
the actual question people ask. The diff shows only what changed (added/removed/version-bumped);
unchanged packages collapse to a count, since a Go service with 200 indirect dependencies produces
three interesting rows and 197 that would bury them.

```json
{
  "base": "v0.4.1", "head": "main",
  "manifests": [{
    "ecosystem": "go", "file": "go.mod", "unchanged": 197,
    "changes": [
      { "name": "github.com/gin-gonic/gin", "status": "added", "to": "1.10.0" },
      { "name": "github.com/coreos/go-oidc/v3", "status": "changed", "from": "3.11.0", "to": "3.12.0" }
    ]
  }]
}
```

**A real security detail worth stating explicitly, not just in acceptance criteria:** `ref` is
user-supplied and gets interpolated into a Gitea API path. It needs the same treatment
`auth.SafeReturnPath` already applies to `return_to` — constrained to a safe charset (or the set
`ListReleases` actually returned), with `../` or a query separator rejected outright, not
escaped-and-hoped.

### Test visibility

Reads a JUnit XML or coverage-summary artifact from CI or a Gitea release — the same way the CI/release
cards already read Gitea Actions data. Renders pass/fail counts, suite duration, coverage %, and trend
over the last N runs. The portal computes nothing; it displays what CI already produced. Opt-in via
annotation, so a team without CI-produced reports sees no panel and no nudge to add one:

```yaml
metadata:
  annotations:
    wxops.cloud/test-report: junit    # junit | coverage | both | (absent = hidden)
```

A team that opts in can also mark a run as a curated **case study** — a shareable snapshot appearing on
the System page as maturity evidence, published by the team, never auto-generated.

### Backend surface

```
internal/gitea/write.go       GetRepoFile(ctx, owner, repo, path, ref)     + ref
internal/gitea/packages.go    DiscoverPackages(ctx, c, owner, repo, ref)   + ref
internal/gitea/packages.go    DiffManifests(base, head) []ManifestDiff    NEW — pure, tested
internal/handlers/catalog.go  GetEntityPackages                            + ?ref=, + cache
internal/handlers/catalog.go  GetEntityPackageDiff                        NEW
internal/testreport/          NEW — JUnit/coverage parser
internal/handlers/catalog.go  + GetEntityTests
```

```
GET /api/v1/catalog/entities/:kind/:name/packages?ref=v0.4.1
GET /api/v1/catalog/entities/:kind/:name/packages/diff?base=v0.4.1
GET /api/v1/catalog/entities/:kind/:name/tests
```

## Drawbacks

- Dependency comparison's `ref` validation is a real, if small, new attack-surface consideration — a
  user-controlled string reaching an external API path is exactly the shape of bug this project's own
  test suite (`isCLIRedirect`, `SafeReturnPath`) has already had to guard elsewhere; this needs the same
  discipline, not a shortcut.
- Test visibility's "never a gate" promise is only as durable as the teams using it — a platform could
  choose to weaponize an opt-in signal later; the acceptance criteria (below) exist to keep that from
  happening by default, not to make it structurally impossible.

## Alternatives

- **Cache invalidation via webhook instead of TTL for dependency reads.** More precise, more
  infrastructure. TTL matches every other caching decision already made in this codebase (catalog,
  manifest cache) — consistency with the existing pattern outweighs the marginal freshness gain here.

## Rollout Plan

1. **Dependency comparison's four changes ship together as one unit** — they're listed "in dependency
   order" in the source design for a reason; the `ref` threading has to land before caching makes
   sense, which has to land before the diff endpoint is useful.
2. **Test visibility is fully independent** — no shared code, no shared sequencing constraint with
   dependency comparison. Gated only on CI actually emitting a report artifact somewhere first.
3. Neither item has a hard dependency on any other RFC in this batch, unlike `RFC-011`/`RFC-012` which
   reference test-trend and CVE-burn-down as Team Health inputs — those RFCs depend on this one
   shipping first if Team Health's full dimension set matters, not the reverse.

## Open Questions

1. Should `ref` validation reuse `SafeReturnPath`'s exact pattern, or does a Git ref's valid-charset
   rule differ enough (refs can contain characters a URL path can't) to need its own dedicated
   validator?
2. Is a two-TTL cache (tag vs. branch) worth a generalized cache-key abstraction, or is this specific
   enough to `GetEntityPackages` that a purpose-built cache is fine and a generalization would be
   premature?
3. For test visibility's case-study snapshots — does "curated by the team, not auto-published" need any
   enforcement beyond UI convention (a button only a team member can click), or is that a real gap given
   the "never a gate, never weaponized" promise this RFC makes?
