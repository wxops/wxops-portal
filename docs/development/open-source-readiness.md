# Open-Source Readiness Checklist

> **Status:** Plan — to execute *after* KubeCon / CNCF, informed by what you hear there.
> **Model:** Open core. The open-source **portal + core** is the real project; the
> enterprise layer lives *beside* it, private, added only when a real user asks.
> **Companions:** [refactor-and-hardening.md](refactor-and-hardening.md) (the pre-launch
> gate), [../security/security-assurance.md](../security/security-assurance.md) (the trust
> story that gets 10× stronger in the open), [`RFC-010`](../rfc/RFC-010-enterprise-audit-trail.md)
> and its siblings `RFC-011`–`RFC-012` (what stays enterprise).

## How to use this

You are going to KubeCon/CNCF **first** to hear the community's voices — that's the right
order. Don't rush the code open before the trip. This checklist is what you execute
**when you're back**, shaped by the feedback you gathered. Section J is your listening-tour
kit for the conference itself.

The strategic frame (decided across prior discussion):

- **Open the core generously.** A single team must be able to run the OSS version in
  production forever and be happy — never *needing* enterprise.
- **Darlane is in the open.** It's the wedge; it's the reason anyone shows up.
- **Extract, don't hard-fork.** Enterprise depends on OSS, never the reverse.
- **The OSS repo is the center of gravity**, not a marketing brochure.

---

## A · The split manifest — what's open, what's enterprise

### Portal (`wxops-portal-v2`)

| Open core | Enterprise (private overlay, later) |
|---|---|
| Catalog (browse, search, graphs, OpenAPI, Docs) | Audit-export to SIEM + SOC2/compliance report packs |
| Golden-path scaffold + promotion + config-edit | Cost / FinOps (OpenCost) |
| Cluster views (Pinniped-scoped) | Fleet-scale governance / multi-cluster ops |
| **Darlane** (field model now, `XDarlane` later) | Cross-tenant scorecard aggregation at org scale |
| CLI (`wxops`) in full | SSO beyond OIDC / SCIM provisioning |
| Pinniped RBAC + the **security-assurance posture** | Support / SLA |
| Activity feed, single-team scorecards, DORA-lite | — |
| SBOM + CVE panel (read + open-issue) | Automated compliance packs built *on* that data |
| Structured logging (`slog`) | Audit *pipeline* + retention integrations |

### Core (`wxops-core`)

| Open core | Enterprise (private overlay, later) |
|---|---|
| `tenant-app`, `tenant-database`, `platform-database-clusters` | Guardian **Phase 3** AI review (in-cluster LLM) |
| `gitea-*` packages, `random-password` | Fleet-scale composition management |
| **Darlane composition** (+ future `XDarlane` XRD) | — |
| Kyverno TTL policies | — |
| Guardian **Phase 1–2** (tooling + scan + audit sidecar) | — |

**The line, stated once:** open core = the complete developer experience (catalog,
scaffold, Darlane, CLI, the safe read-only model). Enterprise = governance, compliance,
cost, fleet scale, and support — the things only large orgs need. Revisit this line with
whatever you hear at KubeCon; if in doubt, move it toward *more open*.

- [ ] Split manifest reviewed against KubeCon feedback and finalized
- [ ] Confirmed: nothing a single team *needs* to run in prod is behind the enterprise line

---

## B · Repo & extraction strategy

- [ ] **Do not maintain two divergent copies.** OSS repo is the base; enterprise is a
      separate private repo/module that *imports* it. One-way dependency only.
- [ ] Decide the boundary mechanism: Go build tags / plugin interfaces for backend,
      a private module for enterprise handlers, private KCL modules for Guardian Phase 3.
- [ ] Public repos: `wxops-portal` and `wxops-core` (drop the `-v2` suffix for the public
      name — it reads as internal iteration history).
- [ ] Squash or curate history if the internal history is noisy/embarrassing — a clean
      initial public commit is acceptable and common (but see §C first).

---

## C · Scrub & safety (launch-blocking)

Findings from an actual scan of both repos:

- [ ] **`gitea.xeusnguyen.xyz` appears 185×** across both repos — genericize to
      `gitea.example.com` / documented placeholders. Grep again after: `grep -rn 'xeusnguyen'`.
- [ ] Re-scan for *any other* internal hostnames/registries before publishing
      (`kubewekend.*`, `wiki.*`, internal IPs, cluster names, org names).
- [x] `backend/.env` — verified **untracked, gitignored, never in history** (good; keep it that way).
- [ ] **Full-history secret scan** with `gitleaks` / `trufflehog` across all branches —
      not just the working tree. Any hit → scrub from history (`git filter-repo`) **and
      rotate the real credential**, since deletion ≠ un-leaked.
- [ ] Ship a real `backend/.env.example` with placeholders and no real values.
- [ ] Confirm no private image/chart pull secrets, kubeconfigs, or tokens anywhere in the tree.

---

## D · Hardening gate (the minimum bar to be *readable* in public)

People read the code before trusting it with their cluster — the code *is* the pitch.
The [refactor-and-hardening](refactor-and-hardening.md) release is the prerequisite, not
a nice-to-have. Minimum bar:

- [ ] **Tests exist and pass in CI** (currently zero) — at least the pure helpers +
      one handler path per package. A test suite is a trust signal to contributors.
- [ ] **`log.Printf` → structured `slog`** — also unblocks the audit story.
- [ ] **God-files split** — no reviewer's first impression should be a 2,700-line file
      (`catalog.go`, `promotion-panel.tsx`, `darlane.go`, `tenant-app/main.k`).
- [ ] **CLI namespace bug fixed** (`platform-team` divergence between `debug.go`/`darlane.go`).
- [ ] Core `make render-check` golden snapshots green.
- [ ] `go vet` / `tsc --noEmit` / eslint / `kcl-check` all clean in CI.

You do **not** need 100% coverage. You need a net and a first impression that says
"this is maintained."

---

## E · 10-minute path to "wow" (the #1 adoption factor)

The biggest adoption killer for infra projects: you can't try them fast. Nobody will
stand up Pinniped + Vault + Gitea + ArgoCD + Crossplane + spokes to evaluate you.

- [ ] **`docker compose up` / `make demo`** that boots the portal against a local
      `kind` cluster with **no external dependencies**.
- [ ] Lean on what already exists: `DEV_BYPASS_AUTH=true`, `CATALOG_LOCAL_DIR` + the
      example catalog — these are the seeds of a zero-dependency demo.
- [ ] The demo's payoff must be **Darlane** — scale a twin, exec in with "real" secrets,
      `wxops darlane sync`, hot-reload. That's the moment that makes someone care.
- [ ] A <3-minute screen recording of that loop in the README. Show, don't tell.
- [ ] `QUICKSTART.md`: clone → `make demo` → the wow, in under 10 minutes.

---

## F · OSS hygiene files (neither repo has any yet)

Add to **both** repos:

- [ ] `LICENSE` — Apache-2.0 (see §G)
- [ ] `README.md` — **user-facing**, not the vision. What it is, the 10-min quickstart,
      the Darlane wow, an architecture diagram, links to docs. (The current README is a
      good internal overview — trim it for a newcomer's first 60 seconds.)
- [ ] `CONTRIBUTING.md` — build/test/PR flow, the conventions from
      [refactor-and-hardening](refactor-and-hardening.md), "no refactor+feature in one PR".
- [ ] `CODE_OF_CONDUCT.md` — Contributor Covenant (also a CNCF prerequisite later).
- [ ] `SECURITY.md` — how to report a vuln, response expectations. Link the
      [security-assurance](../security/security-assurance.md) doc — it's a differentiator.
- [ ] `.github/` — issue templates (bug / feature / **design-partner interest**),
      PR template, `CODEOWNERS`, a CI workflow that runs the §D gate on every PR.
- [ ] `CHANGELOG.md` / release notes convention (core already has git-cliff tooling).

---

## G · License decision

- [ ] **Recommendation: Apache-2.0** for both repos. Maximum trust, maximum adoption; the
      patent grant reassures enterprises; the risk of a hyperscaler forking a solo project
      today is ~zero. Don't burn adoption defending a threat that doesn't exist yet.
- [ ] Keep enterprise modules under a **separate commercial license** in the private repo
      (dual-license by separation, not by clause).
- [ ] Revisit only if a real commercial threat emerges — BSL/AGPL are always available
      later; you can't easily *re-open* after choosing restrictive, but you can always
      *close* new modules.

---

## H · Positioning & narrative

- [ ] **Lead with Darlane, not "another IDP."** The catalog/scaffold fight is crowded
      (Backstage, Port, Cortex); Darlane competes with nothing.
- [ ] The one-liner to test at KubeCon (§J): *"A read-only developer portal whose killer
      feature is Darlane — a safe production twin with real secrets and real traffic, built
      for the AI-era inner loop and for agents that need a safe place to run."*
- [ ] The trust angle is a headline, not fine print: *"the portal can't write to your
      cluster, can't read your secrets, can't intercept traffic — and you can read the code
      that proves it."* ([security-assurance](../security/security-assurance.md))
- [ ] Keep the vision docs (enterprise, intelligence, Guardian) as a clearly-labeled
      **"where this is going" annex** — inspiring to a reader, *not* presented as shipped.

---

## I · Community readiness

- [ ] GitHub Discussions on (questions, ideas, show-and-tell).
- [ ] A public, honest roadmap (link the existing docs; mark shipped vs planned truthfully).
- [ ] 5–10 **good-first-issues** curated from the refactor workstreams — the easiest way
      to convert a visitor into a contributor.
- [ ] A response-time intention you can actually keep (e.g. "issues triaged weekly").
      Under-promise; an unanswered issue tracker signals abandonment.
- [ ] A short `GOVERNANCE.md` even if it's just "BDFL for now" — sets expectations.

---

## J · The KubeCon / CNCF listening tour (do this *first*)

You're going to hear voices before you open anything — good. Make it count:

**What to bring**
- [ ] The <3-min Darlane demo (recorded, works offline — conference wifi is a lie).
- [ ] The one-liner (§H) and the trust angle. Test whether they land in 15 seconds.

**Questions to ask real platform engineers** (capture answers verbatim)
- [ ] "You have Backstage/Port already — would the *Darlane* part make you look? Why/why not?"
- [ ] "Would your security team accept a read-only, no-secrets portal? What would they demand?"
- [ ] "What would make you actually run this in a POC — and what would stop you?"
- [ ] "Open-core with enterprise for compliance/cost/scale — fair, or off-putting?"
- [ ] "If it were open today, would you `git clone` it this week?"

**How to capture it**
- [ ] One notes doc, tagged by theme (adoption blockers / must-haves / pricing signal /
      naming). Turn each recurring blocker into an issue when you're back.
- [ ] Collect **design-partner leads** — one team that will run it in anger is worth more
      than every feature on the roadmap.

**CNCF, as a *future* step (not a launch requirement)**
- [ ] Note that CNCF **Sandbox** wants: an OSI license (Apache-2.0 ✓), public repo,
      `CODE_OF_CONDUCT.md`, some governance, and real adoption signal. Most of this
      checklist doubles as Sandbox prep — but apply only *after* you have users, not before.
- [ ] Get on the **CNCF Landscape** once public — low effort, real discovery.

---

## K · Documentation — the OSS experience (do alongside E–F)

For an infra tool, **the docs are the product.** The code earns a `git clone`; the docs
decide whether someone stays, succeeds, and tells their team. This is where adoption
lives or dies — treat it as first-class, not an afterthought.

### Two surfaces, two audiences — keep them separate

| Surface | Audience | Answers | Rule |
|---|---|---|---|
| **Repo `docs/`** (this folder) | Contributors + maintainer | "How is it built / where is it going?" | Architecture, vision/roadmap annexes, refactor plan. An adopter should rarely need it. |
| **Released Docs** (`docs-site`, Docusaurus) | **Adopters** | "How do I succeed today?" | The user product. This is the OSS experience. |

> Naming note: the repo's `docs/catalog/documentation-strategy.md` is about RFC/ADR/Runbook
> **Doc entities in the catalog** (a product feature) — *not* the project's own docs
> strategy. Don't conflate them.

### What the released Docs (`docs-site`) must have for adoption

The public site already mirrors the category structure. Enrich it in this order of impact:

- [ ] **Getting Started = the 10-minute Darlane win** (§E). The single highest-leverage page.
- [ ] **How-to guides** — task-oriented, not feature-oriented: "enable Darlane", "scaffold
      a service", "promote to staging", "debug with mirrord", "sync code into a pod".
- [ ] **Concepts** — the "why" (architecture, legibility-over-control). Mostly written already.
- [ ] **Reference** — CLI, API, config/env vars, XRD schema. Complete and accurate.
- [ ] **Troubleshooting / FAQ** — *the retention layer.* When someone hits an error at 5pm,
      finding the answer here vs. rage-quitting **is** the OSS experience. Most projects
      forget this page; it matters more than any concept doc.
- [ ] **Day-2 / operations runbooks** — upgrade, TLS, cluster registration, "what to back up"
      (answer: almost nothing — a selling point).

### The honest enterprise boundary (the funnel, done right)

- [ ] The released docs **fully solve OSS-tier problems.** A single team must never hit a
      wall on *basic* usage — that's a docs bug, not a sales opportunity.
- [ ] Where a need is **genuinely enterprise-shaped** (SOC2 audit export, fleet governance,
      cost, SLA), say so plainly with a labeled **Enterprise** callout: "the open version
      does X; at compliance/fleet scale you'll want the enterprise layer."
- [ ] **Never** half-document a basic capability so users "discover" they must pay. Infra
      engineers smell it instantly, and the resentment spreads faster than any feature.
      The funnel only works if the enterprise pointer reads as *help*, not a toll booth.

## Launch sequencing

**Minimum bar to open (do not launch without):** §C scrub complete · §D hardening gate
green · §E 10-minute demo works · §F hygiene files present · §G license chosen ·
**§K getting-started + troubleshooting pages live on the public Docs.**

**Order when you're back:**
1. Fold KubeCon feedback into §A (the split line) and §I (good-first-issues).
2. §C scrub + §D hardening (this is the bulk of the work — the refactor release).
3. §E demo + §K released Docs (getting-started, how-to, troubleshooting) + §F hygiene + §H README/positioning.
4. Flip the repos public. Post the Darlane demo. Invite the design-partner leads.
5. §I community cadence + §J CNCF Landscape.

## Definition of "ready to open"

- [ ] A stranger can `git clone`, `make demo`, and see the Darlane wow in <10 minutes.
- [ ] The public Docs has a getting-started, at least the core how-to guides, and a
      troubleshooting page — an adopter can succeed and get unstuck without reading source.
- [ ] The first file a reviewer opens is <500 lines and has a test nearby.
- [ ] No internal identifiers, no secrets in history (scanned, not assumed).
- [ ] LICENSE + README + CONTRIBUTING + SECURITY + CoC present in both repos.
- [ ] The enterprise line is drawn generously and nothing a single team *needs* is behind it.
- [ ] You have at least one real conversation from KubeCon pointing at a design partner.

## Reference

- [refactor-and-hardening.md](refactor-and-hardening.md) — the hardening gate (§D)
- [../security/security-assurance.md](../security/security-assurance.md) — the trust story to headline (§H)
- [`RFC-010`](../rfc/RFC-010-enterprise-audit-trail.md), [`RFC-011`](../rfc/RFC-011-governance-scorecards-team-health.md), [`RFC-012`](../rfc/RFC-012-supply-chain-security-cve-cost.md) — what stays enterprise (§A)
- [`RFC-009`](../rfc/RFC-009-self-service-operations-portal-response.md) — the "where it's going" annex, not a shipped claim
