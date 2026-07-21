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
| A4 | **Bounded egress** | The portal only connects to a small set of operator-configured services. | Outbound calls resolve to Gitea, Vault, the OIDC issuer (Pinniped), and spoke K8s APIs — every base URL comes from config. | Apply the egress `NetworkPolicy` in §3; review `internal/config/config.go`. |
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
| Monitoring (CC7.2 / A.12.4) | Structured audit events → SIEM (see [enterprise-roadmap.md](../roadmap/enterprise-roadmap.md) Track A); Git history is a second, immutable log. |
| Data at rest (A.8) | No portal database; secrets are write-only to Vault; sessions are client-side and encrypted. |

---

## 8. Reviewer verification checklist

An auditor can confirm the core claims in minutes:

- [ ] **A1** — `kubectl auth can-i --list --as=system:serviceaccount:wxops-system:wxops-portal` shows only read verbs on tenant resources.
- [ ] **A2** — `grep -rniE 'mirrord|steal|tcpdump|sniff|intercept' backend/` returns nothing.
- [ ] **A3** — `internal/vault/client.go` exposes only create/update; the bound Vault policy grants `create`/`update` (no `read`/`delete`).
- [ ] **A4** — the egress `NetworkPolicy` (§3) is applied and its allowlist matches `config.go`'s configured hosts.
- [ ] **A5** — `grep` for telemetry SDKs returns nothing; egress policy would block them regardless.
- [ ] **A6** — `go.mod` contains no database driver; sessions decode from the cookie with `SESSION_SECRET`.
- [ ] **A7** — recent `gitops-infra` changes are all commits/PRs; portal PRs carry `portal-managed`.
- [ ] **A8** — a tenant user's cluster views 403 outside their namespaces; platform-team sees more — driven entirely by K8s RBAC.

---

## Reference

- [permissions.md](permissions.md) — the role model and action-to-role mapping
- [../concepts/architecture.md](../concepts/architecture.md) — auth sequence, session model, hub-spoke topology
- [../darlane/darlane.md](../darlane/darlane.md) — Darlane's separate (developer-invoked, gated, audited) traffic model
- [../roadmap/enterprise-roadmap.md](../roadmap/enterprise-roadmap.md) — the audit trail (Track A) that makes A7 continuously verifiable
