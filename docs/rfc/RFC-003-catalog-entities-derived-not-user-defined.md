# RFC-003: Catalog Entities Are Derived, Not User-Defined

> **Status:** proposed — brainstorm draft, opened to structure a design conversation, not to settle
> it. **Owner:** platform-team. **Spans:** `backend/internal/handlers/catalog.go` (`CreateEntity`),
> `backend/internal/handlers/scaffold.go` (`GenerateCatalogEntities`, `UpdateProjectConfig`),
> `frontend/src/components/catalog/register-entity-form.tsx`, `frontend/src/components/scaffold/
> import-wizard.tsx`, and Gitea itself (as the intended source of truth for Group/User).
>
> **Companion:** [`RFC-002-system-documentation-knowledge-graph.md`](RFC-002-system-documentation-knowledge-graph.md)
> — the `Doc` design below is a deliberate on-ramp to that RFC's direction, not a separate effort;
> called out here because it's a real dependency, not an assumed one.

---

## Summary

Catalog entities can be created today through three independent paths with three very different
integrity guarantees: golden-path **scaffold** (guaranteed to match manifests it just generated),
**Import** (guaranteed to match a real, already-existing repo), and manual **Register Entity**
(guarantees nothing — arbitrary hand-typed YAML, for any of the seven kinds, with no check that
what it claims exists). This RFC proposes replacing the third path, per kind, with whatever structured
derivation actually fits that kind — golden-path scaffold for Component/Resource/API, a Gitea
org/team/user sync for Group/User, and a guided, knowledge-graph-aware form for Doc — while explicitly
preserving Import as a permanent, deliberately scoped exception for onboarding pre-existing
infrastructure.

## Motivation

Four concrete findings, not hypotheticals — each checked directly against the current code while
scoping this RFC:

1. **`CreateEntity` has no backing-infra check.** It validates schema shape and ownership, then
   commits whatever JSON it's given — including a `Component` whose `gitea/source-location` points at
   a repo with no `XTenantApp`, or a `Resource` claiming a Vault path nothing writes to. This is the
   headline gap this RFC exists to close.
2. **A silent hole in the golden path itself.** `UpdateProjectConfig` (the edit-config flow) rewrites
   `xtenant-app.yaml` when a toggle like `VaultSecrets`/`DatabaseSecrets`/`APIEnabled` flips on — but
   never calls `GenerateCatalogEntities`. Today, enabling Vault after initial scaffold produces working
   infrastructure with **no matching catalog entity at all**. "Map scaffolding to catalog" has to fix
   this too, or tightening `CreateEntity` alone just moves where the drift comes from.
3. **Group/User entities can drift from the RBAC reality that actually governs access.** Pinniped
   groups are Gitea `orgName:teamName` strings — the real source of truth. A hand-typed `Group` entity
   has no structural relationship to that at all; it can say anything.
4. **Doc entities are the same problem at the knowledge layer**, and it's the one this RFC shouldn't
   solve in isolation — `RFC-002` is already asking what a `Doc`'s links should even point at (another
   Doc? a commit? an incident?). Building a structured Doc-creation form without that answer risks
   building the wrong form twice.

## Detailed Design

Per kind, since the answer isn't the same shape for all seven.

### Component / Resource / API — golden path only

- Close `CreateEntity` for these three kinds as a direct, hand-typed path.
- **Fix finding #2 first, or this makes things worse, not better:** extend `UpdateProjectConfig` to
  regenerate (or incrementally add) the relevant `Resource`/`API` entity whenever a toggle flips from
  off to on — reusing `GenerateCatalogEntities`'s existing per-toggle logic rather than duplicating it.
  Until this exists, "enable Vault later" has no path to a catalog entity at all if manual creation is
  also closed — a real regression, not a tightening.
- **The genuinely new capability your original framing implies:** a standalone "register a resource"
  action for infrastructure that isn't itself an `XTenantApp`-backed service — a shared Kafka cluster,
  a shared Postgres instance nobody scaffolded. This can't reuse "an `XTenantApp` exists" as its
  verification signal, so it needs its own — see Open Questions.

### Group / User — Gitea-derived, not hand-typed

- `Group` entities become a sync/derivation from Gitea's org/team API instead of authored YAML — Gitea
  orgs map to catalog Groups the same way `groupToTenant` already derives `tenant-{orgName}` namespaces
  from the identical `orgName:teamName` string. One source of truth for "what teams exist," reused,
  not a second one invented in YAML.
- `User` entities follow the same reasoning if they're kept at all — see Open Questions on whether a
  separate `User` entity is worth maintaining once Gitea is authoritative for identity.

### Doc — structured, and sequenced after RFC-002's direction

- Replace raw-YAML Doc creation with a guided form (`docType`, `docStatus`, `owner`, `relatedTo`,
  `contentUrl`) that enforces the per-`docType` markdown structure already defined in
  `documentation-strategy.md` — this part is low-risk and doesn't need to wait for anything.
- **What should wait:** if RFC-002 adds new link types (a commit reference, an `incident`/`postmortem`
  node) or decides Doc lineage lives partly in Core, the guided form is exactly where those fields get
  entered. Building the form's full shape before that's decided risks a rework; building the
  *mechanical* guided-form-instead-of-raw-YAML part now is still worth doing independently.

### Import — preserved, explicitly scoped, not tightened

- Stays exactly as it is: application-only (a `Component` plus its `Resource`/`API` entities), sourced
  from a real, already-existing repo the wizard reads directly.
- Framed deliberately, per your answer, as the **graceful-adoption path** — not a loophole alongside
  the manual form, but the intentional answer to "how does a team with pre-existing infra join W'xOps
  without re-scaffolding everything." This is the same "integrate with what's already there" stance
  already written down in `ecosystem-tool-strategy.md`; Import is that philosophy's concrete mechanism
  in the catalog specifically.

## Drawbacks

| Area | Drawback |
|---|---|
| Component/Resource/API | Closing `CreateEntity` removes a capability (however risky) before its replacements (edit-config regeneration, standalone resource registration) exist — sequencing matters, see Rollout Plan |
| Group/User | A Gitea-sync mechanism is new infrastructure (a sync job or on-demand derivation), not a subtraction — trades "anyone can mistype a Group" for "something has to keep this in sync correctly" |
| Doc | Deliberately coupling to RFC-002's timeline means this piece can't move faster than that RFC resolves, even though the mechanical part (form vs. raw YAML) doesn't strictly need to wait |
| Import | None from this RFC — explicitly out of scope by your answer, included here only so the boundary is stated, not implied |

## Alternatives

- **Soft gate instead of removal.** Keep `CreateEntity` open for Component/Resource/API but restrict
  it to platform-team plus a mandatory justification field, rather than closing the path outright.
  Cheaper to build, much weaker guarantee — doesn't stop drift, just narrows who can cause it.
- **Verify the claim instead of restricting the path.** Leave `CreateEntity` open for every kind, but
  have the backend check that a submitted Component/Resource's claimed backing (repo, `XTenantApp`,
  Vault path) actually resolves before accepting it. This was on the table when scoping this RFC and
  wasn't chosen — noted here so it isn't silently forgotten as an option if the golden-path-only
  approach turns out to be too restrictive in practice.

## Rollout Plan

Sequencing constraints, not dates:

1. **Fix the edit-config gap (finding #2) first, on its own.** It's a bug-shaped fix independent of
   every other decision here and should not wait for the rest of this RFC to resolve.
2. **Group/User Gitea-sync can proceed independently and in parallel** — it doesn't depend on the
   Component/Resource/API decision or on RFC-002.
3. **Don't close `CreateEntity` for Component/Resource/API until its replacements exist** — both the
   edit-config fix (step 1) and the standalone "register a resource" flow for non-`XTenantApp`-backed
   infrastructure (Open Questions). Closing the door before the replacement exists is a regression, not
   a tightening.
4. **Doc's guided-form mechanics can start now; its final field set waits on RFC-002.** Don't block the
   simple part on the harder, unresolved part.
5. Import is unaffected by any of the above — no rollout step needed for it.

## Open Questions

**Component / Resource / API**
1. What verifies a *standalone* Resource registration (no `XTenantApp` backing it) is real, if "an
   `XTenantApp` exists" isn't available as the signal? A Crossplane XR name check? Platform-team
   approval as the only guardrail?
2. What happens to entities that were already created through the manual form before this ships — an
   audit pass to flag ones with no verifiable backing, or a quiet grandfather-in?

**Group / User**
3. Sync cadence for Gitea-derived Groups — computed on demand at catalog-read time (like namespace
   derivation already is), or a periodic job that writes actual Group entity files? The former matches
   "no new persistence"; the latter gives Groups a real git history of their own.
4. When a Gitea team appears that has no Group entity yet, does it auto-create on first sight, or
   require an explicit "onboard this team" action? Auto-create risks catalog noise from teams that
   never intend to use the portal; requiring an action reintroduces a manual step for the one kind this
   RFC is trying to make automatic.
5. Is a separate `User` entity worth keeping at all once Gitea is authoritative for identity, or does
   it become a redundant second directory that can still drift even after Group is fixed?

**Doc**
6. Does the guided Doc-creation form ship now with today's fields and gain RFC-002's additions later
   without a rework, or is that optimistic — should it genuinely wait?

**Import**
7. Not urgent per your answer, but worth recording: if Import's scope ever grows beyond
   application/Component entities (e.g. importing a pre-existing shared Resource), does it need the
   same "what verifies this" question Component/Resource/API raises above, or does reading a real
   existing repo always count as sufficient verification regardless of kind?

**Scope check**
8. Is this one RFC, or does "fix the edit-config gap" (mechanical, low-risk, no disagreement likely)
   deserve to ship and be evaluated separately from "close manual creation across all seven kinds"
   (the bigger, slower decision with real open questions above)?
