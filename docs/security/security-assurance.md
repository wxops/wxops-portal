# Security Assurance — The Portal as a Passive Reflector

> **Purpose:** Evidence for the claim that the W'xOps Portal is a **passive reflector of
> GitOps state**, not an active agent inside the infrastructure. Written for enterprise
> security reviewers who must sign off before the portal runs in a regulated environment.
> **Companion:** [permissions.md](permissions.md) (role model),
> [../concepts/architecture.md](../concepts/architecture.md) (auth + topology).

## The one-sentence assurance

> **The portal reads infrastructure state and reflects it. Every change it makes is a
> reviewed Git commit. It never writes to a cluster, never reads or deletes a secret,
> never intercepts traffic, and never connects anywhere it was not explicitly configured
> to reach.**

These are not policies bolted on — they are **structural properties of the code**. This
document states each as a verifiable claim, points at the evidence, and tells you how to
check it yourself. Nothing here asks you to trust an assertion.

---

## 1. The assurance claims

| # | Property | What it means | Evidence in the system | How to verify |
|---|---|---|---|---|
| A1 | **No cluster writes** | The portal never mutates a Kubernetes cluster. | Cluster access is read-only; every change is a Gitea PR reconciled by ArgoCD. | Portal ServiceAccount RBAC is read-only (`get`/`list`/`watch`); grep the backend for K8s write verbs — none exist. |
| A2 | **No traffic interception** | The portal never mirrors, steals, sniffs, or proxies user traffic. | No `mirrord`, `steal`, `tcpdump`, or packet capture anywhere in the backend. | `grep -rniE 'mirrord\|steal\|tcpdump\|sniff\|intercept' backend/` → empty. |
| A3 | **No secret reads or deletes** | The portal can seed a secret but can never read one back or delete one. | `internal/vault/client.go` implements create/update only — no GET/LIST/DELETE methods exist. | Review the Vault client surface; the Vault policy bound to the portal grants `create`/`update` only. |
| A4 | **Bounded egress** | The portal only connects to a small set of operator-configured services. | Outbound calls resolve to Gitea, Vault, the OIDC issuer (Pinniped), spoke K8s APIs, and — when explicitly enabled — Alertmanager. Every base URL comes from config. | Apply the egress `NetworkPolicy` in §3; review `internal/config/config.go`. See §4b for the Alertmanager addition. |
| A5 | **No phone-home** | No analytics, telemetry, crash-reporting, or third-party beacons. | No Sentry/Segment/Datadog/PostHog/etc. in `go.mod` or the frontend. | `grep -rniE 'telemetry\|analytics\|sentry\|segment\|posthog'` → only unrelated `DarlaneTelemetryPort` (an OTEL port field). |
| A6 | **No portal database** | There is nothing to exfiltrate or breach at rest. | Stateless: sessions are client-side AES-256-GCM cookies; the catalog lives in Git; caches are in-memory TTL. | No DB driver in `go.mod`; review `internal/auth/session.go` and `internal/catalog/store.go`. |
| A7 | **GitOps-only writes** | Every state change is an attributable, reviewable, revertible commit. | Scaffold, promote, deprecate, and config-edit all write to Gitea (PR or direct commit for Docs). | Git history of `gitops-infra` is the change log; portal PRs carry the `portal-managed` label. |
| A8 | **User-scoped RBAC** | The portal acts *as the logged-in user*, never as a superuser. | Cluster reads use the user's Pinniped-exchanged, short-lived mTLS credential — scoped to their K8s RBAC. | Review the auth sequence in [architecture.md](../concepts/architecture.md); a user only ever sees what their RBAC allows. |

---

## 2. Assume-breach: what the portal cannot do even if fully compromised

The strongest assurance is not "it is secure" — it is "here is the blast radius if it
is not." If an attacker achieved full code execution inside the portal container, the
structural constraints still hold:

| The attacker still **cannot**… | Because… |
|---|---|
| Write to, scale, or delete anything in any cluster | The portal's K8s credentials are read-only; there is no write path in the code or the RBAC. |
| Read or delete any secret | The Vault policy grants create/update only; a read/delete call has no code path and no policy grant. |
| Deploy anything | Deployment requires a **merged** PR — a human gate the portal cannot bypass. |
| Steal a database | There is no database. |
| Exceed a user's permissions | The portal holds no standing cluster credential of its own for tenant resources — it exchanges the *user's* token per request. |
| Exfiltrate to an arbitrary host | The egress `NetworkPolicy` (§3) drops any connection outside the allowlist. |

The realistic worst case is: the attacker can **open portal-managed PRs** (labeled,
reviewed, not auto-merged) and **write/update Vault paths that already exist** (gated by
a remote-resource-existence check). Both are human-reviewed before they take effect.
That is a dramatically smaller surface than any tool that holds cluster-admin or a
secrets-read credential.

---

## 3. Evidence: the egress allowlist you can enforce

The portal's egress is small and known, so you can **pin it with a NetworkPolicy** and
make A4/A5 enforced rather than merely true. Template (fill in your real CIDRs/labels):

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: wxops-portal-egress
  namespace: wxops-system
spec:
  podSelector:
    matchLabels: { app: wxops-portal }
  policyTypes: ["Egress"]
  egress:
    - to: [{ namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } } }]
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]   # DNS
    - to: [{ ipBlock: { cidr: <GITEA_CIDR>/32 } }]
      ports: [{ protocol: TCP, port: 443 }]                                # Gitea
    - to: [{ ipBlock: { cidr: <VAULT_CIDR>/32 } }]
      ports: [{ protocol: TCP, port: 8200 }]                               # Vault
    - to: [{ ipBlock: { cidr: <PINNIPED_SUPERVISOR_CIDR>/32 } }]
      ports: [{ protocol: TCP, port: 443 }]                                # OIDC issuer
    - to: [{ ipBlock: { cidr: <SPOKE_APISERVER_CIDR>/32 } }]
      ports: [{ protocol: TCP, port: 6443 }]                               # spoke K8s APIs
```

Anything the portal is *not* configured to reach — including any hypothetical
phone-home — is dropped by default. Intra-pod traffic (nginx → Go → Next.js) is loopback
and never leaves the pod, so no allowance is needed for it.

---

## 4. Honest disclosure: the one egress worth hardening

Assurance is only credible if it names its own edges. There is exactly one path where
the portal can fetch from a host it was not statically configured with:

**Catalog-declared spec fetch.** When an `API` entity declares an OpenAPI/AsyncAPI spec
by absolute URL and the higher-priority resolution paths (inline definition → relative
Gitea path → Gitea-authenticated fetch) do not apply, the portal performs a plain
`GET` on that URL (`httpGet` in `handlers/catalog.go`). This is a read-only GET to a
**catalog-declared** location.

Why it is low-risk today, and how to close it entirely:

- The URL lives in a catalog entity. Non-`Doc` entities are added/changed via **PR
  review**, so the URL is human-reviewed before it is ever fetched.
- It is a `GET` for a spec document — no request body, no credentials attached to
  non-Gitea hosts.
- The **egress NetworkPolicy in §3 contains it** — the fetch cannot reach anything
  outside the allowlist.

**Recommended hardening (tracked):** add a config flag
`CATALOG_SPEC_FETCH=gitea-only|allowlist|any` (default `gitea-only`) so operators can
disable arbitrary-URL spec fetching entirely and require specs to live in Gitea. This
turns the last open edge into an explicit, opt-in operator decision.

---

## 4a. Runtime observability changes nothing structural

The Runtime Status panel reads ArgoCD `Application` and Crossplane `XTenantApp`
objects and renders deep links into Grafana. It is worth stating explicitly why
this does **not** move any of the claims above:

| Claim | Effect | Why |
|---|---|---|
| A1 — no cluster writes | **unchanged** | Both new calls are `GET`. |
| A4 — bounded egress | **changed — see §4b** | Grafana/Loki/Tempo/Pyroscope are only ever *linked*, never called. Alertmanager is now the exception. |
| A8 — user-scoped RBAC | **unchanged for cluster reads** | ArgoCD/XR reads use the caller's Pinniped credential. A user who cannot `kubectl get application` cannot see it in the portal either. Alertmanager is the exception — see §4b. |

Every function in `internal/observability/links.go` is pure string construction
with no network access — verifiable by inspection, and covered by the package's
unit tests.

**One RBAC note worth disclosing.** `XTenantApp` is a Crossplane v2 composite
with `scope: Cluster`, so it cannot be scoped to a namespace by RBAC. The
prerequisite role (`tenant-platform-reader`) therefore grants **`get` only, never
`list`**: the portal reads composites by exact name, so `list` would add no
capability while allowing one tenant to enumerate every other tenant's
composites. Tenant filtering in the UI is a convenience; the `get`-only grant is
the actual boundary.

If the prerequisite bindings are absent the panel degrades to "Cluster RBAC not
applied" — the portal has no privileged fallback credential to reach for.

See [../platform/observability.md](../platform/observability.md) for the full
model and its known limitations.

---

## 4b. Alertmanager — the one egress added on purpose

Earlier versions of this document stated the portal had **no** egress beyond
Gitea, Vault, the OIDC issuer and the Kubernetes APIs. That is no longer true,
and pretending otherwise would be exactly the kind of stale assurance claim
this document exists to prevent.

**What changed.** The Runtime tab shows whether a service is currently
alerting. Answering that needs a real query — Alertmanager holds alert state,
and nothing in Git or the Kubernetes API can substitute for it.

**The shape of the addition:**

| Property | Detail |
|---|---|
| **Opt-in** | Disabled unless an operator sets `ALERTMANAGER_URL`. Unset is the default, and the panel is hidden entirely. |
| **Read-only** | One `GET /api/v2/alerts`. No silencing, no acknowledgement, no POST/DELETE — there is no code path for them. |
| **Bounded** | 5-second timeout, 50-alert result cap, redirects explicitly not followed (a redirect could otherwise send the request to a host outside the allowlist). |
| **No credentials sent** | Alertmanager is reached in-cluster with no auth header attached. |
| **Enforceable** | Add the entry below to the §3 NetworkPolicy so this stays a bounded, enforced egress rather than a documented intention. |

```yaml
    - to: [{ namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: monitoring } } }]
      ports: [{ protocol: TCP, port: 9093 }]                # Alertmanager
```

**The honest caveat — this read is not user-scoped.** Every other cluster read
in the portal borrows the caller's Pinniped credential, so Kubernetes RBAC
decides what they see. Alertmanager has no Kubernetes RBAC and no tenant model:
the portal queries it with no identity at all. Scoping to one tenant is done by
the portal, filtering on `namespace=` and the workload's pod-name prefix — a
**correctness measure, not a security boundary.** A bug in that filter would
show one tenant an alert belonging to another.

Two things bound the damage, and neither is a substitute for the caveat above:
alert payloads carry metadata (alert name, severity, pod, namespace, summary)
rather than application data, and the endpoint requires an authenticated portal
session. If that residual exposure is unacceptable in your environment, leave
`ALERTMANAGER_URL` unset — the feature is off and A4 reverts to its original,
narrower form.

**Why not solve it properly?** Per-tenant alert scoping needs alerts to carry a
team or app label, which no rule emits today, plus an Alertmanager that
understands tenancy. Both are platform changes rather than portal changes. This
is deliberately the simple version first, documented as such.

---

## 4c. Grafana authentication and what it does *not* isolate

The portal links into Grafana constantly, so what Grafana enforces is part of
this system's security story even though the portal does not control it.

**Authentication: Dex only.** Grafana's basic-auth login form is disabled
(`auth.basic.enabled: false`, `disable_login_form: true`). The only way in is
`auth.generic_oauth` against Dex, which federates to the upstream identity
providers. There are no local Grafana accounts to provision, rotate, or forget
to revoke — deactivating a user upstream removes their Grafana access by the
same act that removes their portal and cluster access.

**Authorization: two roles, mapped from group membership.**

```ini
role_attribute_path = contains(groups[*], 'platform-team') && 'Admin' || 'Editor'
allow_assign_grafana_admin = true
```

| Group | Grafana role | Can |
|---|---|---|
| `platform-team` | **Admin** | Manage datasources, users, org settings, all dashboards |
| Every other authenticated user | **Editor** | Query freely in Explore, create and edit dashboards |

Editor rather than Viewer is a deliberate choice: developers need Explore to
write ad-hoc LogQL and PromQL when debugging, and Viewer cannot. The portal's
deep links land in Explore, so Viewer would make them read-only dead ends.

**What this does not give you — state this plainly to reviewers.** The mapping
is binary. Every non-platform user, from every tenant, receives the same Editor
role with the same access. There is no per-team scoping, and adding it would
not help as much as it appears:

- **Grafana OSS has Teams and folder permissions, but no Team Sync.** Automatic
  OIDC-group→Grafana-Team mapping is a Grafana Enterprise feature. Teams could
  be created manually, but membership would drift from Gitea groups immediately.
- **Folder permissions scope dashboards, not queries.** An Editor in Explore
  can type any query against any datasource. Restricting which dashboards
  someone sees does nothing about ad-hoc queries.
- **Loki has no tenant boundary underneath.** `auth_enabled: false` means every
  log line for every namespace lives in one unpartitioned store, so there is no
  lower layer for Grafana to enforce against even if it wanted to.

**The accurate statement:** the portal's links are scoped by *convention* — they
pre-fill the namespace and app filters so a developer lands on their own
service. Nothing prevents an authenticated Grafana user from deleting that
filter and querying another tenant's logs or metrics. **Observability data is
shared across tenants; only the Kubernetes API, Vault, and Git are
tenant-isolated.**

Closing that gap means Loki multi-tenancy (`auth_enabled: true` with per-tenant
IDs propagated from identity), which is platform work tracked in
[../platform/observability-architecture.md](../platform/observability-architecture.md).
Until then it should be an accepted, written-down risk rather than an assumed
protection.

---

## 5. Traffic stealing: portal vs. Darlane (an important distinction)

Enterprise reviewers rightly ask about `mirrord`/steal-mode, since the platform
documents it. The distinction is categorical:

| | The **Portal** | **Darlane** + `mirrord` |
|---|---|---|
| What it is | The web app / API | A developer's **CLI tool** targeting a **Darlane twin pod** |
| Intercepts traffic? | **Never** — no interception code exists in the backend | Optionally, in *mirror* (read-only copy) or *steal* mode |
| Who initiates | n/a | The **developer**, from their laptop |
| Prod guardrail | n/a | Steal mode on production requires `productionOverride: true` (double opt-in) **and** an audit trail; enforced by Kyverno, not the portal |

The portal never touches traffic. Darlane traffic tooling is a developer-invoked,
policy-gated, audited capability that lives in the cluster and the CLI — a separate
trust boundary. See [../darlane/darlane.md](../darlane/darlane.md) for its safety model.

---

## 6. RBAC readiness

The portal introduces **no parallel authorization system** — a deliberate choice that
means there is only one RBAC to audit:

- **Identity:** one OIDC login via Pinniped Supervisor (PKCE/`S256`), federated to the
  upstream IdP. Session is an `HttpOnly`, `SameSite=Lax`, AES-256-GCM-encrypted cookie.
- **Authorization:** the user's **Kubernetes RBAC**, reached via RFC 8693 token exchange
  + Concierge-issued short-lived mTLS certs. The portal shows only what the user's RBAC
  permits — namespace listing is derived from group membership, never a cluster-wide list.
- **Role gates:** promotion to staging/production and deprecation are limited to
  `platform-team` or `{team}:Managers`; enforced in the backend, not just the UI.
- **Least standing privilege:** the portal holds no standing cluster credential for
  tenant resources — it borrows the user's, per request, short-lived.

Result: revoking a user in the IdP/Kubernetes revokes their portal access. There is no
portal-side account, password, or permission to also remember to revoke.

---

## 7. Mapping to common control families

Illustrative, not a certification. Shows where the structural properties land.

| Control area (SOC 2 / ISO 27001) | How the portal satisfies it |
|---|---|
| Logical access (CC6.1 / A.9) | Single OIDC identity; K8s RBAC; role-gated actions; no local accounts. |
| Transmission & egress (CC6.6–6.7 / A.13) | TLS to all dependencies; bounded, enforceable egress allowlist (§3). |
| Change management (CC8.1 / A.14) | All changes are reviewed Git PRs; `git revert` is the rollback; PR reviewers are the approval chain. |
| Monitoring (CC7.2 / A.12.4) | Structured audit events → SIEM (see [`../rfc/RFC-010-enterprise-audit-trail.md`](../rfc/RFC-010-enterprise-audit-trail.md)); Git history is a second, immutable log. |
| Data at rest (A.8) | No portal database; secrets are write-only to Vault; sessions are client-side and encrypted. |

---

## 8. Reviewer verification checklist

An auditor can confirm the core claims in minutes:

- [ ] **A1** — `kubectl auth can-i --list --as=system:serviceaccount:wxops-system:wxops-portal` shows only read verbs on tenant resources.
- [ ] **A2** — `grep -rniE 'mirrord|steal|tcpdump|sniff|intercept' backend/` returns nothing.
- [ ] **A3** — `internal/vault/client.go` exposes only create/update; the bound Vault policy grants `create`/`update` (no `read`/`delete`).
- [ ] **A4** — the egress `NetworkPolicy` (§3) is applied and its allowlist matches `config.go`'s configured hosts. If `ALERTMANAGER_URL` is set, confirm the policy includes the Alertmanager rule from §4b; if the alerts feature is not wanted, confirm the variable is unset.
- [ ] **A5** — `grep` for telemetry SDKs returns nothing; egress policy would block them regardless.
- [ ] **A6** — `go.mod` contains no database driver; sessions decode from the cookie with `SESSION_SECRET`.
- [ ] **A7** — recent `gitops-infra` changes are all commits/PRs; portal PRs carry `portal-managed`.
- [ ] **A8** — a tenant user's cluster views 403 outside their namespaces; platform-team sees more — driven entirely by K8s RBAC.

---

## Reference

- [permissions.md](permissions.md) — the role model and action-to-role mapping
- [../concepts/architecture.md](../concepts/architecture.md) — auth sequence, session model, hub-spoke topology
- [../platform/observability.md](../platform/observability.md) — runtime status reads, selectors, and known limitations
- [../platform/observability-architecture.md](../platform/observability-architecture.md) — hub/spoke target architecture and the Loki tenancy gap
- [../darlane/darlane.md](../darlane/darlane.md) — Darlane's separate (developer-invoked, gated, audited) traffic model
- [../rfc/RFC-010-enterprise-audit-trail.md](../rfc/RFC-010-enterprise-audit-trail.md) — the audit trail that makes A7 continuously verifiable
