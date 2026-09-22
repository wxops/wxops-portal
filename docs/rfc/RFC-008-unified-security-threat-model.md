# RFC-008: A Threat Model That Actually Spans Core and Portal

> **Status:** proposed — brainstorm draft. **Owner:** platform-team, jointly with whoever owns
> `wxops-core`'s security doc. **Spans:** `wxops-portal-v2` (`docs/security/security-assurance.md`,
> `docs/security/permissions.md`) and `wxops-core`
> (`docs/core-ideas/security-threat-model.md`) — genuinely both, not primarily one with the other as
> a footnote.
>
> **Grounding:** direct comparison of the two source documents. Core's is fetched from
> `github.com/wxops/wxops-core/blob/main/docs/core-ideas/security-threat-model.md` (v0.4.0, a STRIDE-
> flavored consolidation doc feeding that repo's `SECURITY.md`); Portal's is this repo's
> `security-assurance.md` + `permissions.md`, read in full. **Real, factual overlap with**
> [`RFC-004-multi-cluster-sequencing.md`](RFC-004-multi-cluster-sequencing.md) and
> [`../platform/multi-cluster-authentication.md`](../platform/multi-cluster-authentication.md) — both
> describe the same hub-credential-projection mechanism independently; noted below as a verified fact,
> not an assumed relatedness.

---

## Summary

Two security documents already exist, and each is genuinely good on its own ground — Core's is a
proper STRIDE threat model with an honest, ordered gaps list; Portal's is an evidence-backed assurance
document written for an auditor who wants to verify claims, not just read them. Neither cites the
other. That's not a cosmetic problem: a reviewer evaluating whether to run W'xOps in a regulated
environment is evaluating **one system**, and several of the real risks only become visible when both
documents are read together — several are invisible in either one alone.

## Motivation

Four concrete gaps, found by reading both documents side by side rather than either in isolation:

1. **Portal's Darlane story quietly borrows credibility from a control that doesn't exist yet.**
   `security-assurance.md` §5 draws a clean line — "the portal never touches traffic; Darlane is a
   separate, gated trust boundary" — and defers entirely to `darlane.md`. But Core's threat model is
   explicit that the actual enforcement layer for that boundary, Guardian, **"is designed, not
   built"** — its own gap #6 states the Darlane-on-prod residual "remains open until audit exists." A
   reviewer who reads only the Portal doc gets a tidier story than reality supports.
2. **The RBAC story is told as two separate halves that never get assembled into one picture.** Portal's
   A8 claim describes what a *logged-in user's* exchanged credential can reach. Core's B3 boundary
   describes what the *platform's own provisioning identity* (`provider-kubernetes`'s ClusterRole) can
   reach — deliberately wide within its API groups, with the composition's write path as the actual
   ceiling. Both are true and neither is the whole answer; a reviewer needs both halves stitched
   together, not filed in two repos.
3. **The hub-credential problem is being solved twice, independently, in the same shape.** Core's threat
   model names "hub compromise → fleet" with the mitigation "projected tokens + structured authn
   (design)... OCM evolution removes hub-held creds." `multi-cluster-authentication.md` — already read
   in full for `RFC-004` — proposes almost exactly this (SA-token projection, a second
   `JWTAuthenticator` per spoke) for a specific caller (ArgoCD). Two documents converging on the same
   mechanism from different angles, with no cross-reference, is exactly the situation a unified model
   should catch before two teams build two incompatible versions of it.
4. **Portal has no supply-chain story at all, and this session found real evidence it needs one.**
   Core's document treats composition/package supply chain seriously (pinned catalog SHAs, image
   signing named as an open gap). Portal's `security-assurance.md` says nothing about its own dependency
   posture — and earlier this session, `npm audit` found a **critical unauthenticated RCE in Next.js**
   in the frontend's own dependency tree, and `govulncheck` found four reachable CVEs in the backend's
   OIDC path (`golang.org/x/net`, `golang.org/x/text`, `go-jose`). That's not hypothetical; it's this
   repo, checked directly. Core has thought about supply chain; Portal hasn't written down that it
   needs to think about its own.

## Detailed Design

### The mapping exercise this RFC actually proposes

Not a rewrite of either document — a **bridge table** mapping Core's trust boundaries (B1–B5) against
Portal's assurance claims (A1–A8), making explicit which claims are load-bearing on which boundary
holding, on the *other repo's* side:

| Portal claim | Depends on (Core boundary) | What breaks if that boundary moves |
|---|---|---|
| A1 — no cluster writes | B3 (`provider-kubernetes` RBAC ceiling) | Portal's UI never asks for a write, but if the provider's ClusterRole is ever widened, the *platform's own reconciler* can still do damage the portal's own claim says nothing about — A1 is true but insufficient on its own |
| A8 — user-scoped RBAC | B1 (Pinniped/OIDC identity, GitOps-only RBAC) | If B1's "RBAC is GitOps-only" constraint is ever violated (a manually-applied RoleBinding), Portal's claim that "the session IS the role" (`permissions.md`) stops being provably true from Portal's own evidence alone |
| §5's Darlane trust-boundary claim | B5 (Guardian audit + TTL/Kyverno cleanup) | Named directly above — Guardian's "designed, not built" status is the residual risk Portal's own doc doesn't state |

This table is the actual deliverable this RFC is scoping — not a merged 40-page document, a **bridge**
between two documents that both stay where they are, owned by whoever already owns them.

### Concrete disclosure gaps worth porting immediately, independent of the bridge table

These don't need the full reconciliation to be worth doing now:

- **Port Core's Guardian-not-built caveat into `security-assurance.md` §5.** One sentence: Darlane's
  production-session safety model depends on Guardian, which is not yet built — matching the honesty
  standard the rest of that document already holds itself to.
- **Port Core's "namespace-wide `pods/exec`" disclosure into `permissions.md`.** Core states this
  plainly as an accepted limit; Portal's permissions matrix lists "Exec / port-forward into Darlane pod"
  as a Developer action scoped to "own team" without stating that the underlying RBAC grant is
  namespace-wide, not pod-scoped — a developer's exec access isn't actually limited to their own
  service's Darlane pod, just their team's namespace.
- **Add a Portal-side dependency/supply-chain claim.** Given this session's own findings, a claim in
  the shape of A1–A8 — something like "dependency vulnerabilities are tracked" — currently doesn't
  exist and should, even if the honest current answer is "no automated scanning in CI yet" (true as of
  this session — `go test`/`npm audit` aren't wired into either CI workflow).

### The convergence with RFC-004 / `multi-cluster-authentication.md`

Not something to resolve inside this RFC — flagged so it isn't independently rediscovered. Core's "hub
compromise → fleet" mitigation and Portal's exec-plugin broker design are close enough in shape that
whoever builds either should read both before committing to an implementation. This RFC's job is
pointing that out, not picking between them.

## Drawbacks

| Approach | Drawback |
|---|---|
| The bridge table | Two documents to keep in sync is real ongoing maintenance — a claim or boundary that changes on one side needs someone to notice it affects the other |
| Porting disclosures now | Small, immediate, low-risk — the honest drawback is just that it's more words in an already-long document |
| Full merge into one document | Not proposed here, but worth naming as rejected: forces a single owner across two repos and one document format to win over the other, for a much larger rewrite than the actual gaps justify |

## Alternatives

- **Just add "See also" cross-links between the two documents and stop there.** Cheaper than the bridge
  table, catches a reader who follows the link but not the reviewer who reads only one document start
  to finish — which is the realistic failure mode this RFC is responding to. Worth doing regardless of
  whether the bridge table happens, but not sufficient by itself.
- **Fully merge into one cross-repo document.** Rejected above under Drawbacks — the two documents serve
  genuinely different audiences and methodologies (STRIDE threat-model vs. auditor assurance-claims)
  well; forcing one format loses real value from the other.

## Rollout Plan

1. **Port the three concrete disclosure gaps now** (Guardian-not-built caveat, namespace-wide exec
   disclosure, a Portal-side supply-chain claim) — independent of everything else, low-risk, and each
   is a same-day fix to an existing document.
2. **Build the bridge table second** — it's the piece that actually needs both documents' owners in the
   same conversation, and depends on nothing else in this RFC to start.
3. **Flag the RFC-004/`multi-cluster-authentication.md` convergence to whoever picks up either the
   ArgoCD broker or Core's "hub compromise → fleet" mitigation** — not this RFC's decision to resolve,
   just its job to make sure it's seen before either is built twice.
4. Whatever CI/dependency-scanning gap the new supply-chain claim (step 1) exposes is real follow-up
   work, not something this RFC's scope covers — noted so it doesn't get silently absorbed into "done"
   once the claim itself is written down.

## Open Questions

1. Who owns the bridge table once it exists — a doc in Portal, a doc in Core, or a third,
   neither-repo's-territory location? Both source documents stay where they are; the bridge is the only
   piece without an obvious home.
2. Should Portal adopt Core's STRIDE-style threat/mitigation/residual-risk table format for anything, or
   does the claims-and-evidence format Portal already has serve its auditor-facing purpose better as-is?
   Not obviously "pick one" — worth asking directly rather than assuming.
3. Does the hub-credential convergence (Motivation #3) mean Core's "projected tokens + structured
   authn" design and Portal's exec-plugin broker design are actually the *same* mechanism described
   twice, or different enough in scope (fleet-wide identity vs. one caller's, ArgoCD's, credentials)
   that they're correctly separate and just need to reference each other?
4. Portal's new supply-chain claim (Detailed Design) — does it belong as a new `A9`, or fold into the
   existing `A4` (bounded egress) / `A6` (no portal database) claims? It doesn't cleanly fit either
   today.
5. Core's open gap #5 (no runtime kernel-level detection — Falco/Tetragon/KubeArmor absent) is named
   for the cluster/Darlane surface. Does the same blind spot apply to the Portal container itself, and
   if so, does `security-assurance.md`'s assume-breach section (§2) need the same honest caveat Core
   already states for its own surface?
