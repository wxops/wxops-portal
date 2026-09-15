# Ecosystem Tool Strategy — Hub/Spoke Division, Dependencies, and Lightweight Alternatives

> **Status: research notes, not a decision record.** This captures a design conversation about
> how the wider W'xOps ecosystem (portal + `wxops-core` + whatever cluster it runs on) divides
> work across the hub-spoke model, what each piece actually depends on, and which tool choices
> are cheap versus expensive to reverse. Nothing here is implemented or scheduled. It's written
> down now so the reasoning survives past the conversation it came from — the intent is for this
> to be refactored into proper ADRs, runbooks, and RFCs in `wxops-core` once the decisions below
> are actually made, not to stay in this shape long-term.
>
> **Companion:** [../concepts/architecture.md](../concepts/architecture.md) (the hub-spoke
> topology this assumes), [multi-cluster-authentication.md](multi-cluster-authentication.md)
> (the credential-brokering problem this is adjacent to). `wxops-core`'s own
> `docs/multi-cluster.md`, `docs/multi-cluster-proposal.md`, and `docs/solution-matrix.md` are
> the authoritative, much deeper research on multi-cluster mechanics (CAPI, ArgoCD join
> patterns, identity) — this doc doesn't duplicate that; it's scoped to a narrower question
> those docs don't fully answer yet: *which tools, and at what cost to change later.*

---

## The product philosophy this assumes

W'xOps should be built to **integrate with an org's existing Kubernetes investment first**,
and offer a from-scratch bootstrap second — not the other way around. Concretely: if a cluster
already has cert-manager, an ingress controller, a secrets-sync tool, and a monitoring stack
running, W'xOps' job is to organize those into the hub-spoke model and layer the portal/catalog/
golden-path experience on top — not to reinstall its own opinionated copy of everything. The
from-scratch bootstrap (a full "batteries included" install) matters for greenfield adopters,
but it's the secondary path, not the primary product bet.

This has a real, load-bearing consequence: any place a Composition *hardcodes* one vendor's
resource shape instead of detecting what's already there breaks this philosophy for anyone who
made a different, equally valid choice before W'xOps showed up. See [the ingress
section](#the-one-place-this-already-breaks-ingress-is-hardcoded) below — this isn't
hypothetical, it's a real gap found while writing this doc.

---

## Hub / Spoke tool division

Grounded directly in `wxops-core`'s own `docs/concepts/architecture.md` hub-spoke diagram, plus
what each dependent CRD/controller actually requires to function. Workload type follows each
tool's own upstream convention, not a guess.

### Hub cluster

| Component | Workload type | Why |
|---|---|---|
| Pinniped Supervisor | Deployment | Stateless federation/token-issuance; state is CRs in the API, not local disk. |
| Dex (upstream IdP broker) | Deployment | Stateless at the pod level if using Dex's Kubernetes storage backend — state lives in API objects, not a local file. Connector/client config should be GitOps-declared, not left as click-configured, bootstrap-only state, or a full hub rebuild loses who's even allowed to log in. |
| ArgoCD — `application-controller` | StatefulSet | Upstream ArgoCD's own chart deploys this as a StatefulSet — shards need stable identity to partition Application ownership. |
| ArgoCD — `server`/`repo-server`/`applicationset-controller`/`notifications-controller` | Deployment | Stateless. |
| ArgoCD — `redis` | StatefulSet (or Deployment, single-instance) | Stable identity + volume once run with more than one replica. |
| ArgoCD Image Updater | Deployment | Stateless; its "state" is Git commits, not local storage. |
| Crossplane core + `rbac-manager` + providers (`provider-kubernetes`, `provider-terraform`, `provider-sql`, …) | Deployment | Controller-manager style reconcilers; state is CRs/XRs in the API. Providers live wherever Crossplane's own control loop lives — **not** wherever the resources they compose end up (see [CRD dependencies](#crd-dependencies--what-a-spoke-actually-needs) below). |
| Vault | **StatefulSet** | Non-negotiable — Raft integrated storage needs stable identity + a volume per replica, and HashiCorp's own chart deploys it this way even with an external backend. |
| Prometheus + Alertmanager (hub-level) | StatefulSet | Not a choice — the Prometheus Operator's CRDs always generate StatefulSets, for TSDB/WAL persistence and Alertmanager's gossip clustering. |
| Loki, Tempo (if self-hosted) | StatefulSet | Persistent chunk/block storage. |
| Grafana | Deployment (+ small PVC if not fully API/code-provisioned) | Auth is Dex-only, no local accounts — the usual reason to want a StatefulSet (local user DB) isn't in play. |
| Alloy — edge tier | DaemonSet | Per-node collection — also runs on every spoke, not hub-only. |
| Alloy — gateway tier (new) | Deployment, hub-only, small replica count | Centralized trace processing — see [Alloy gateway tier](#alloy-gateway-tier--why-traces-need-a-second-hop) below. |
| The Portal itself | Deployment | Zero local state by design — session state derives from Pinniped tokens, catalog is an in-memory cache of Git. |
| Gitea, if kept in-cluster | StatefulSet | Needs persistent Git data + its own DB/LFS storage. **Recommended to stay external** regardless — see [Gitea vs. Dex placement](#why-gitea-stays-external-while-dex-moves-in) below. |

### Spoke clusters (each registered spoke)

| Component | Workload type | Why |
|---|---|---|
| Pinniped Concierge + `JWTAuthenticator` | Deployment | Confirmed directly in `architecture.md`'s component table — stateless validator, matches upstream Pinniped's chart. |
| Prometheus Operator + Prometheus (local) | StatefulSet | Scraping has to happen where the workload is — this is *why* the `monitoring.coreos.com` RBAC grant has to be applied per spoke, not just once on the hub. |
| Alloy | DaemonSet | Same role as on the hub — local collection, forwarded centrally. |
| Tenant workloads (`XTenantApp`-composed Deployment + Darlane twin) | Deployment | Confirmed from the XRD schema — always composes a `Deployment`, never a StatefulSet. Golden-path apps are stateless by design. |
| PgBouncer poolers | Deployment | Stateless connection multiplexer. |
| `XTenantDatabase`-composed CNPG clusters | StatefulSet | CNPG's own operator always generates StatefulSets — Postgres HA needs stable identity + storage per replica. |

**The one real gap between this table and today's actual state:** `spec.parameters.cluster`
(the field that would let Crossplane place composed resources on a spoke via a
`provider-kubernetes` `ProviderConfig`) defaults to `"default"` — the hub — and no spoke
`ProviderConfig` exists yet. So today, everything Crossplane composes lands on the hub
regardless of which spoke it's logically meant for. The spoke rows above are the target
architecture (and match what `wxops-core`'s own `multi-cluster-proposal.md` is already
designing toward), not the current reality for the write path. The read path (Concierge,
status, local Prometheus scraping once a spoke exists) is unaffected by this gap.

---

## CRD dependencies — what a spoke actually needs

If Crossplane ever does place composed resources on a spoke, that spoke needs every CRD those
resources depend on *registered there* — not because Crossplane can't reach it, but because
Kubernetes CRDs are schema registered per-cluster. If a spoke doesn't have a CRD registered, the
API server rejects the write outright (`no matches for kind`) — a hard failure, not a soft
degradation.

Confirmed directly from `wxops-core`'s own XRD schemas (not assumed):

| CRD group | Operator needed | Where it's used |
|---|---|---|
| `postgresql.cnpg.io` | CloudNativePG | `Cluster`/`Pooler`/`ScheduledBackup` — composed by `XTenantDatabase`/`XPlatformDatabaseCluster` |
| `external-secrets.io` | External Secrets Operator | `ExternalSecret`/`ClusterSecretStore`/`PushSecret` — the Vault-sync mechanism used throughout |
| `monitoring.coreos.com` | Prometheus Operator | `ServiceMonitor`/`PodMonitor` — the exact RBAC gap already found; the CRD *and* the operator both have to exist, RBAC alone isn't sufficient |
| `cert-manager.io` | cert-manager | `Certificate`/`ClusterIssuer` — confirmed directly in `tenant-app`'s XRD, gated by `ingress.tls.clusterIssuer` |
| `traefik.io` | Traefik (CRD mode) | `IngressRoute`/`Middleware`/`TraefikService` — confirmed directly in `tenant-app`'s XRD; this is how ingress *and* Darlane traffic splitting both work today |
| `stakater.com` annotation | Stakater Reloader | confirmed in `tenant-app`'s XRD — `reloader.stakater.com/auto` does nothing without the controller running to watch it |

**Checked and confirmed absent:** SchemaHero is not referenced anywhere in either repo — it
came up as a candidate in conversation but isn't part of this stack.

**What does *not* need to be on the spoke:** `provider-kubernetes` itself. Providers are
Crossplane's plugins — they run wherever Crossplane's core control loop runs (the hub), and
reach a spoke *remotely* through the credential its `ProviderConfig` points at (a kubeconfig
Secret), the same way ArgoCD's own remote-cluster sync already works. Installing
`provider-kubernetes` on a spoke would do nothing — there's no controller loop there for it to
run.

**The practical implication:** a real "add a spoke" action isn't a config toggle. It's (a) a
reproducible, scripted bootstrap bundle on the spoke — CNPG, ESO, Prometheus Operator (+ the
RBAC grant), cert-manager, Traefik/ingress, Reloader, Concierge, a storage provisioner — applied
as one idempotent unit, plus (b) exactly one new scoped credential on the hub side for
`provider-kubernetes` to use. Everything in (a) has to be true *before* (b) is worth adding.

---

## Alloy gateway tier — why traces need a second hop

The per-node Alloy DaemonSet (edge tier, hub and every spoke) is enough for logs, Kubernetes
events (`loki.source.kubernetes_events` — confirmed to exist directly in Alloy's own docs), and
node/pod metrics. It is **not** enough for correct trace sampling, and this is worth stating
precisely rather than leaving traces as permanent pass-through: Alloy's own
`otelcol.processor.tail_sampling` docs state the processor requires "all spans for a given trace
[to] reach the same collector instance for effective sampling decisions." A single trace's spans
can land on different nodes' edge Alloy instances, so no per-node agent can make a correct
keep/drop decision on its own — it can only see part of the trace.

The fix is a second Alloy tier, not a second tool. Alloy is itself a wrapper/distribution over
OpenTelemetry Collector Contrib's components (confirmed directly: the `tail_sampling` processor
doc says outright it "is a wrapper over the upstream OpenTelemetry Collector Contrib
`tail_sampling` processor") — so the gateway tier is **another Alloy instance, deployed
differently**, not vanilla `otelcol-contrib` introduced as a separate binary/config
language/upgrade cadence to maintain:

- **Edge tier** (unchanged): Alloy as a DaemonSet, per node, hub and spoke.
- **Gateway tier** (new): Alloy as a Deployment, hub-only, small replica count —
  `otelcol.receiver.otlp` (receives spans forwarded from every edge Alloy) →
  `otelcol.processor.tail_sampling` (the actual sampling decision, now correctly seeing every
  span of a trace) → `otelcol.exporter.otlp` onward to Tempo.

Same binary, same config language, same operational surface — one running as an agent, a few
running as a gateway. Reach for a genuinely separate tool only if a specific processor/exporter
turns out not to be wrapped by Alloy yet; that's a thing to check per-component, not assume.

---

## Git-as-source-of-truth read optimization (`git-sync`)

The catalog-read bottleneck discussed earlier (every cache-miss re-fetches every file over the
Gitea REST API, one round trip per file) has a cheap fix (incremental webhook-diffing, pure Go
code) and a more complete one: `git-sync`, the well-established sidecar pattern that maintains a
live local clone of a repo in a shared volume, so reads become local-disk reads with zero
per-file network round trips. It doesn't compete with the incremental-diff fix — git's own
transfer protocol already does delta-aware incremental pulls and efficient full clones natively,
so `git-sync` is a more complete version of the same idea, not a third alternative.

**Sequencing:** build the cheap fix first (it's pure code, zero new infrastructure) and confirm
whether it's actually enough before reaching for `git-sync`. When it is added, keep it optional
— it costs a shared `emptyDir` (fine, no PVC needed; a pod restart just re-clones), a credential
of its own to the repo, and a staleness/liveness check as a new failure mode. It does **not**
reduce total read traffic to Gitea to zero — today each portal replica already runs its own
independent in-memory cache (no shared cache across replicas exists), so N replicas already mean
N independent periodic fetches; `git-sync` changes that into N independent continuous small
pulls. That's a wash in aggregate traffic, not a new cost — worth being precise about rather
than overselling it as "eliminates API load."

**Where this gets more interesting than just the catalog:** the same per-file REST round-trip
pattern exists in the Pipeline tab's dependency discovery (`DiscoverPackagesAtRef`,
`GetRepoFileAtRef`) — reading `go.mod`/`package.json`/etc. from a *tenant application's own
source repo*, not just `gitops-infra`. A local clone (via the same `git-sync` mechanism) would
make that discovery faster and open room for richer analysis than "read four known filenames" —
walking a full local checkout is a fundamentally different, cheaper operation than N individual
API calls guessing which files might exist.

**The scope boundary that matters here:** this is a read/discovery optimization, not a reason to
start executing anything on the tenant's behalf. Applying `git-sync` to tenant app repos is about
*seeing more* (dependency trees, manifest discovery) — it must never become a path toward the
portal running or replicating the tenant's own CI/CD workflow. That stays exactly where it already
is: on the hosting provider (Gitea Actions, GitHub Actions, whichever the tenant actually uses).
This isn't a new rule — it's the same one already on record: *"W'xOps is not a CI/CD platform. It
reads from the CI pipeline... It does not replace your pipeline."* A faster, richer read path
doesn't change what side of that line the portal sits on.

---

## The one place this already breaks: ingress is hardcoded

`tenant-app`'s own XRD states plainly: *"`ingress.enabled: true` always emits a Traefik
`IngressRoute` — never a standard `Ingress`."* That's an opinionated choice baked into the
Composition, not a detect-and-adapt design — and ingress is exactly the piece of an existing
cluster most likely to already be decided before W'xOps arrives (nginx-ingress, Kong, Istio
gateway, a cloud LB controller). An org already standardized on nginx-ingress can't use the
golden path today without *also* running Traefik — precisely the forced-stack-replacement
friction the philosophy above is meant to avoid.

**The fix isn't a per-vendor branch in the Composition.** A `ingress.controller: traefik |
nginx | kong` switch feels like it meets people where they are, but it means every future
ingress feature has to be re-solved once per vendor's mechanism, forever.

**The fix is the Kubernetes Gateway API** (`gateway.networking.k8s.io` — `Gateway`/`HTTPRoute`),
not a vendor adapter layer. It exists specifically to solve this: Traefik, nginx (recent
versions), Kong, Istio, Contour, and others all implement the same portable schema. If the
Composition emits `HTTPRoute` with weighted `backendRefs` instead of a Traefik-only
`TraefikService`, any compliant controller can serve it — no migration, the org just needs
their existing controller's Gateway API support enabled. This also happens to map cleanly onto
Darlane's weighted A/B split, which is a native `HTTPRoute` `backendRefs[].weight` concept, not
a compromise.

**Where it stops being clean:** `ingress.auth.enabled`, the ForwardAuth SSO piece, depends today
on Traefik-specific `Middleware` CRDs. Gateway API deliberately doesn't standardize auth — it
leaves an extension point (`ExtensionRef` filters) for exactly this, because SSO/auth plugins
genuinely differ per vendor. That field would still need a per-controller reference even after
everything else moves to Gateway API. Worth documenting as an honest, named limitation rather
than quietly leaving it Traefik-only.

**Lowest-migration path if Traefik is already what's shipped:** don't even change the
controller — change what shape it's fed. Keep Traefik, move the Composition to emit `HTTPRoute`
instead of `IngressRoute`. Recent Traefik versions already speak Gateway API natively.

---

## Why Gitea stays external while Dex moves in-cluster

Both are self-hosted, so it's a fair question why the recommendation differs. The distinction
is what each one *is*:

- **Dex** is a broker. Its important state (which upstream IdP to trust, client registrations)
  is small and should be GitOps-declared, so it survives a full hub rebuild from Git. Moving it
  in-cluster (ideally using Dex's Kubernetes storage backend for runtime state) is safe.
- **Gitea holds the actual source of truth** — every GitOps manifest, including the ones that
  describe how to rebuild the hub cluster itself. If Gitea runs *inside* the cluster it's the
  source of truth for, rebuilding the cluster requires reading Git, but Git lives in the cluster
  being rebuilt. That circular dependency is exactly what makes "no break-glass kubeconfig,
  rebuild from Git" a viable recovery story *only if* Gitea's data survives independently of any
  single cluster's lifecycle.

If Gitea-on-Kubernetes is ever offered as a user choice, this tradeoff should be documented
right there in the option, not left implicit.

---

## Lightweight alternatives — where to spend "hard to reverse" budget

Storage and the metrics backend are the two decisions in this whole list that are genuinely
expensive to change later — data has to move, dashboards/alerts have to be rebuilt. Everything
else here is comparatively cheap to swap if the first choice turns out wrong.

| Layer | Heavier option | Lightweight alternative | Recommendation |
|---|---|---|---|
| Storage (CNPG data + tenant PVCs) | Longhorn / Rook-Ceph | `local-path-provisioner` or OpenEBS LocalPV Hostpath | **Go lightweight.** CNPG already replicates at the application layer (`instances: 3` streaming replication) — adding Longhorn's disk-level replication on top duplicates durability the app already provides, for real operational complexity (iSCSI, per-volume engine/replica pods, upgrade pain). A single tiny hostPath provisioner has none of that, and CNPG's own HA already covers the failure case that matters. Keep Longhorn/Rook as a later option only for non-replicated stateful workloads. If a spoke is cloud-hosted, skip the decision — use the cloud's native CSI. |
| Ingress | New controller install | Keep whatever's already there | Not really a "pick lighter" question — see [above](#the-one-place-this-already-breaks-ingress-is-hardcoded). Don't touch the controller; change the resource shape fed to it. |
| Secrets sync | Vault Agent Injector (sidecar per pod) | External Secrets Operator | Already the lightweight choice — one controller, no per-pod injection. Nothing to reconsider. |
| Certificates | — | cert-manager | Already the lightweight choice — no meaningfully simpler alternative does ACME automation this well. |
| Metrics backend | Full `kube-prometheus-stack` (Prometheus + Thanos + Alertmanager + node-exporter + kube-state-metrics) | VictoriaMetrics Operator | **Worth switching, and it's close to free.** VictoriaMetrics Operator consumes the *same* `ServiceMonitor`/`PodMonitor` CRDs Prometheus Operator does — the `monitoring` block in `tenant-app`'s XRD doesn't change at all. Materially smaller footprint on resource-constrained spokes, zero Composition rework. |
| Policy | OPA/Gatekeeper (separate Rego language) | Kyverno | Already the lightweight choice — YAML-native policy, no second language to operate. |
| Log/trace/metric collection | Separate Promtail + OTel Collector + Prometheus agent | Alloy | Already the lightweight choice — one consolidated agent replacing three; splitting it back out would be a regression. |

**If only one of these gets locked in before the next release, make it storage** — it's the one
choice that's genuinely expensive to reverse once real tenant data exists on it. The rest carry
real but bounded migration cost if revisited later.

---

## Open decisions for this release

Recorded here so they aren't relitigated from scratch next time — not yet decided, just framed:

1. **Storage provisioner default** for bare-metal/on-prem spokes — `local-path-provisioner` is
   the lightweight recommendation above; needs an actual decision, not just a leaning.
2. **Metrics backend** — Prometheus Operator (already shipping) vs. VictoriaMetrics Operator
   (same CRDs, lighter footprint). Low-risk to change later since the CRD contract is identical
   either way, but still worth deciding deliberately rather than by default.
3. **Ingress Composition rework** — moving `tenant-app`'s ingress block from Traefik-native
   `IngressRoute`/`TraefikService` to Gateway API `HTTPRoute`. Real engineering work, not a
   config flag; the `ingress.auth` extension-point question needs its own design pass.
4. **Discovery/pre-flight mechanism** — the actual "detect what's already on this cluster before
   installing anything" step that makes the "integrate first, bootstrap second" philosophy real
   rather than aspirational. Doesn't exist today in any form.
5. **RBAC/CRD prerequisite bundle for spoke onboarding** — a reproducible, scripted unit (not a
   manual checklist) covering CNPG, ESO, Prometheus Operator + RBAC, cert-manager, ingress,
   Reloader, Concierge, and storage. This is the actual blocker on `spec.parameters.cluster`
   ever becoming real, ahead of any credential-wiring work.
6. **Alloy gateway tier** — a second, centralized Alloy deployment doing `tail_sampling` on
   forwarded OTLP spans. Fixes the existing "only traces flow through Alloy's OTLP pipeline, no
   real processing" limitation. No new tool required, just a second Alloy role.
7. **`git-sync` for catalog reads** — sequenced *after* confirming the cheaper incremental-diff
   fix isn't sufficient on its own. Optional, not default.
8. **`git-sync` for tenant-repo dependency discovery** — same mechanism applied to the Pipeline
   tab's package-manifest discovery. Read/discovery scope only — explicitly not a step toward the
   portal executing or replicating tenant CI/CD workflows, which stay owned by whatever the
   tenant already hosts them on.
