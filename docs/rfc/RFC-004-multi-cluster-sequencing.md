# RFC-004: Multi-Cluster — Sequencing Three Independent Blocker Tracks

> **Status:** proposed — brainstorm draft. **Owner:** platform-team. **Spans:** `wxops-gitops-infrastructure`
> (Alloy config, ArgoCD cluster secrets, RBAC bootstrap) and a possible new standalone service (the
> credential broker, per `multi-cluster-authentication.md`'s own recommendation) — **not primarily
> Portal code**, which is itself worth noting up front.
>
> **Grounding:** three existing docs each name real, independently-discovered blockers to a second
> cluster, with no doc sequencing them against each other:
> [`../platform/ecosystem-tool-strategy.md`](../platform/ecosystem-tool-strategy.md) (spoke
> RBAC/CRD bootstrap bundle, `spec.parameters.cluster` defaulting to hub),
> [`../platform/observability-architecture.md`](../platform/observability-architecture.md) (Alloy
> cluster label, ingest reachability, Loki tenancy), and
> [`../platform/multi-cluster-authentication.md`](../platform/multi-cluster-authentication.md)
> (ArgoCD M2M credentials — already a fully-formed, dev-ready design with its own recommendation).

---

## Summary

"Add a second cluster" is blocked by three independent tracks that live in three different documents,
each written by someone reasoning about their own slice correctly, with no combined critical path
anywhere. This RFC doesn't propose new architecture — the architecture is already well-specified in
each source doc — it consolidates the dependency graph across all three and asks what actually has to
happen before what, and what's safe to parallelize.

## Motivation

`observability-architecture.md` warns, about its own three-step sequence: *"doing these out of order
produces a system that silently mislabels data."* That warning doesn't extend across documents today —
nobody has checked whether the observability sequence, the Crossplane spoke-bootstrap sequence, and the
ArgoCD-auth sequence collide, block each other, or are safely independent. `multi-cluster-authentication.md`
also explicitly asks its own best question and answers it honestly: *"is the broker cryptographically
necessary?"* — no, direct SA-token projection works once the prerequisite is done — which means part of
that track might not need building at all. That kind of "actually, do we need this" question deserves to
be asked once, across the whole multi-cluster effort, not per-document.

## Detailed Design

### The three tracks, as currently specified

**Track 1 — Observability parameterization** (`observability-architecture.md`):
1. Parameterize Alloy's hardcoded `cluster = "kubeweekend"` label; add Prometheus `externalLabels`.
2. Decide and build the ingest path from spoke to hub (ingress+auth / private network / gateway).
3. Add per-cluster observability endpoints to the cluster registry Secret schema.
4. Revisit Loki multi-tenancy if isolation becomes unacceptable.

**Track 2 — Spoke provisioning** (`ecosystem-tool-strategy.md`):
- A reproducible, scripted bootstrap bundle per spoke: CNPG, ESO, Prometheus Operator (+ RBAC grant),
  cert-manager, ingress, Reloader, Concierge, a storage provisioner — applied as one idempotent unit.
- Exactly one new scoped hub-side credential for `provider-kubernetes`'s `ProviderConfig` per spoke.
- Today `spec.parameters.cluster` defaults to `"default"` (the hub) and no spoke `ProviderConfig`
  exists — so this track is currently at zero, not partially done.

**Track 3 — ArgoCD machine credentials** (`multi-cluster-authentication.md`, already dev-ready):
1. Hub SA issuer verifiable from spokes (infrastructure, gates everything in this track).
2. A second `JWTAuthenticator` per spoke for machine identities.
3. **Decide broker vs. direct** — with 1 and 2 done, direct SA-token projection works and costs
   nothing; the broker is a policy choice (central authz, single audit point, revocation without
   touching spokes), not a security necessity. This decision point is explicitly *not yet made*.
4. If broker: hub client + `TokenReview` + bearer auth mode + assurance-claim rewrite.
5. `wxops get-token` + image packaging for ArgoCD's controller/server images.

### Where the tracks actually touch each other

- **Track 1 and Track 2 don't block each other technically** — Alloy's label config and Crossplane's
  spoke bootstrap are unrelated systems. But Track 1's parameterization is meaningless to *validate*
  without a real second cluster, which is what Track 2 produces — so they can be *built* in parallel
  but the end-to-end proof needs Track 2 done first, or at least a throwaway kind/k3d spoke standing
  in for it.
- **Track 3 is the most independent** — it doesn't need Track 1 or 2 to make progress on its own steps
  1–2 (hub SA issuer, second JWTAuthenticator), and per `multi-cluster-authentication.md`'s own
  recommendation, steps 1–2 "are useful on their own and carry no commitment to the rest."
- **All three tracks share one real prerequisite nobody has named as shared:** a second cluster to test
  any of this against. Track 2's bootstrap bundle is the thing that produces that cluster. Practically,
  Track 2 (or a stand-in) is the soft gate on *validating* Tracks 1 and 3, even though it doesn't gate
  writing their code.

## Drawbacks

| Track | Cost of doing it now vs. later |
|---|---|
| 1 — Observability | Low cost to parameterize now (config change), but nothing to validate against until a second cluster exists |
| 2 — Spoke provisioning | Real engineering effort (a genuinely new bootstrap artifact) with no existing partial progress |
| 3 — ArgoCD auth | `multi-cluster-authentication.md` already recommends this explicitly as **post-OSS, after v0.6.0** — building it earlier collides with the security-assurance claims being published at OSS launch |

## Alternatives

- **Don't chase multi-cluster until an adopter asks for it.** Consistent with the project's own
  "Beyond v0.6.0 — driven by adoption, not by a date" stance in `ROADMAP.md`. Multi-cluster is
  substantial, cross-cutting infra work with no current concrete user; sequencing three tracks that
  nobody has asked to use yet is optimizing prematurely. Worth stating as the honest default until
  proven otherwise.

## Rollout Plan

Sequencing only:

1. **Track 1 steps 1 (Alloy label, Prometheus `externalLabels`) can happen now, cheaply, regardless of
   everything else** — it's config, not infra, and the source doc itself says to do it "while there is
   still only one cluster, so nothing is ambiguous during the transition." No reason to wait.
2. **Track 3 steps 1–2 (hub SA issuer, second JWTAuthenticator) can also start now independently** —
   explicitly low-commitment per that doc's own recommendation.
3. **Track 2 (spoke bootstrap bundle) is the real, larger effort and the one that unblocks *validating*
   1 and 3** — this is the track to prioritize resourcing for if multi-cluster becomes a real near-term
   goal, since it's currently at zero progress and everything else needs it to prove out end-to-end.
4. **Track 3 steps 3–5 (broker decision onward) stay exactly where `multi-cluster-authentication.md`
   puts them: post-OSS, after v0.6.0** — do not pull this forward regardless of how Tracks 1/2 progress.
5. Track 1 steps 2–4 (ingest path, registry schema, Loki multi-tenancy) follow Track 2's completion,
   per that document's own internal sequencing.

## Open Questions

1. Is there an actual adopter or use case pulling for multi-cluster right now, or is this entirely
   speculative against the docs' own "driven by adoption" philosophy? If speculative, should this RFC's
   Rollout Plan even start before v0.6.0 ships?
2. Should Track 2's bootstrap bundle be proven against a throwaway local second cluster (kind/k3d)
   before any real spoke onboarding, purely to validate Track 1's parameterization safely?
3. `multi-cluster-authentication.md` leaves "broker vs. direct" genuinely open pending steps 1–2 —
   who makes that call, and on what evidence (a named adopter needing central revocation/audit, or a
   default toward the cheaper direct-projection path unless someone asks for more)?
4. Does Track 2's RBAC/CRD bootstrap bundle want to be its own versioned artifact in `wxops-core`
   (a `make bootstrap-spoke` target, mirroring the existing `validate`/`render`/`lint` pattern), or a
   one-off runbook the first real spoke onboarding writes as it goes?
