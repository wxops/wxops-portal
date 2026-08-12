# Multi-Cluster Authentication — Zero-Static-Secret M2M for ArgoCD

> **Status: deferred, not scheduled.** Nothing in this document is implemented
> or planned for v0.6.0 / v0.7.0. It is written down now because the credential
> machinery it depends on already exists in the portal, and because the design
> touches security claims the OSS release leads with — so the reasoning should
> be on record before anyone starts building.
>
> **Companion:** [cluster-registry.md](cluster-registry.md) (how spokes are
> registered), [../concepts/architecture.md](../concepts/architecture.md) (the
> hub-spoke auth model this extends),
> [../security/security-assurance.md](../security/security-assurance.md)
> (the claims this would change).

## The problem

ArgoCD in push mode needs a credential for every spoke it syncs. Two options
are normally available, and both are bad at scale:

- **Static credentials** — a bearer token or kubeconfig per spoke, stored in a
  `Secret` on the hub. Long-lived, drifts, has to be rotated by hand, and the
  hub becomes a vault of permanent cluster-admin credentials. Blast radius is
  every cluster, forever.
- **Interactive OIDC** — Pinniped's browser-based Authorization Code flow. No
  browser, no human, so it cannot run in a controller. Pinniped *does* document
  a non-interactive alternative for exactly this case, but it is unavailable
  here and would not meet the goal anyway — see
  [What Pinniped documents for CI/CD](#what-pinniped-documents-for-cicd) below.

The portal already solves this for *humans*: it holds no standing spoke
credential and mints a short-lived one per request from the logged-in user's
identity. The question is whether the same machinery can serve a headless
caller.

## The proposed shape

ArgoCD cluster secrets carry no credential. They point at a
[client-go credential plugin](https://kubernetes.io/docs/reference/access-authn-authz/authentication/#client-go-credential-plugins)
which calls the portal for a short-lived credential on demand.

```
[ ArgoCD sync triggered ]
          │
          ▼
1. Controller runs the exec plugin  (execProviderConfig in the cluster Secret)
          │
          ▼
2. Plugin reads its projected SA token
   /var/run/secrets/kubernetes.io/serviceaccount/token
          │
          ▼
3. Plugin calls the portal:  SA token + target cluster ID
          │
          ▼
4. Portal validates the caller, then mints a short-lived spoke credential
          │
          ▼
5. Plugin emits ExecCredential JSON on stdout
          │
          ▼
6. ArgoCD caches it in memory until expiry and authenticates to the spoke
```

The cluster `Secret` contains no `bearerToken` and no embedded kubeconfig:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: spoke-cluster-secret
  labels:
    argocd.argoproj.io/secret-type: cluster
type: Opaque
stringData:
  name: <spoke-cluster-id>
  server: https://<spoke-api-endpoint>:6443
  config: |
    {
      "execProviderConfig": {
        "command": "/usr/local/bin/wxops",
        "args": ["get-token",
                 "--cluster-id", "<spoke-cluster-id>",
                 "--portal-url", "http://portal-api.hub.svc.cluster.local"],
        "apiVersion": "client.authentication.k8s.io/v1"
      },
      "tlsClientConfig": { "insecure": false, "caData": "<BASE64_SPOKE_CA>" }
    }
```

## What the portal already has

This is not a greenfield build. Roughly 60% of it exists:

| Piece | Where | State |
|---|---|---|
| Token exchange → refresh → Concierge → cache | `backend/internal/handlers/credentials.go:88` (`SpokeClientFor`) | Working. Extracted in v0.5.0 precisely so more than one caller could borrow an identity |
| `TokenCredentialRequest` → mTLS cert | `backend/internal/cluster/pinniped.go:36` | Working |
| Credential cache with early renewal | `credentials.go:43`, `certBuffer = 2m` | Working |
| Per-cluster `audience`, `jwt_authenticator_name`, `concierge_endpoint`, CA bundle | `backend/internal/cluster/static.go:40-49` | Working |
| A CLI to host the plugin | `cli/` — Cobra, with `WXOPS_TOKEN` already designed for CI/CD (`cli/internal/client/credentials.go:24`) | Working |

The missing 40% is not plumbing. It is the identity model.

## Correction to the ExecCredential contract

A naive implementation returns `status.token`. **Against a Pinniped
Concierge-fronted spoke that will 401 on every call.** The Concierge does not
issue bearer tokens — it issues a short-lived mTLS client certificate
(`ClusterCredential` at `cluster/pinniped.go:19-23` is `ClientCertificateData` +
`ClientKeyData`, PEM). The plugin must emit:

```json
{
  "apiVersion": "client.authentication.k8s.io/v1",
  "kind": "ExecCredential",
  "status": {
    "clientCertificateData": "<CERTIFICATE>",
    "clientKeyData": "<PRIVATE_KEY>",
    "expirationTimestamp": "<TIMESTAMP_EXPIRATION>"
  }
}
```

`ExecCredential` supports both shapes; the certificate form is the correct one
here. Clusters registered *without* Concierge (`audience` and
`jwt_authenticator_name` unset) fall back to a bearer token — see the fallback
branch at `credentials.go:177` — so a complete plugin has to handle both.

## Design constraints, checked against reality

| Constraint | Today |
|---|---|
| No static tokens or kubeconfigs on the hub | ✅ Already true — the portal stores no spoke credential of any kind |
| No interactive OIDC in automated loops | ❌ **The portal is interactive-only.** Every credential derives from `auth.GetSession(c)` → `session.AccessToken`, obtained via Authorization Code + PKCE. Pinniped's own non-interactive path (password grant) is not usable with Gitea — see below |
| Issued credentials ≤ 15 min | ✅ Concierge already issues 5–15 min certs; `ExpirationTimestamp` passes straight through to `ExecCredential` |
| Portal validates the caller before issuing | ❌ **No mechanism.** Portal API auth is cookie-only (`cli/internal/client/client.go:30`). The only bearer path is `WEBHOOK_TOKEN` (`handlers/catalog.go:62`) — one shared static secret, exactly what this design exists to eliminate |

## The two real blockers

### 1. There is no machine identity

Pinniped states this plainly:

> Pinniped provides user authentication to Kubernetes clusters. It does not
> provide service-to-service (non-user) authentication.
>
> — [Pinniped CI/CD howto](https://pinniped.dev/docs/howto/cicd/)

There is no `client_credentials` grant. The whole `SpokeClientFor` chain begins
with a user's `access_token`, so the portal cannot today obtain a credential on
behalf of ArgoCD-the-controller.

#### What Pinniped documents for CI/CD

Pinniped is *not* browser-only, and it is worth being precise about this. Its
CI/CD guidance is to create a **non-human user account in the upstream IDP** and
authenticate with the **password grant** — the `cli_password` flow, driven by
`PINNIPED_USERNAME` / `PINNIPED_PASSWORD` environment variables. That is fully
headless and needs no broker at all. It requires:

- `allowPasswordGrant: true` on the `OIDCIdentityProvider`, **and**
- an upstream IDP that supports the OAuth 2.0 Resource Owner Password
  Credentials grant (or an LDAP / Active Directory identity provider).

**Neither condition holds here.** The upstream IDP is Gitea, whose OAuth2
provider supports only the Authorization Code grant, `refresh_token`, and PKCE —
there is no password grant to enable. Adopting this path means introducing a
second IDP (LDAP/AD, or an OIDC provider that permits ROPC) in front of or
alongside Gitea, which is a much larger change than it first appears: Gitea
group membership is what the entire tenancy model keys on
(`org:team` → namespace, RBAC subjects, platform-team detection).

It also **would not achieve the goal in the title.** A password grant relocates
the static secret from a per-cluster kubeconfig to a single username/password
pair on the hub. That is a genuine improvement — one credential instead of N,
centrally revocable, rotatable in the IDP, issuing short-lived downstream tokens,
and auditable as a distinct identity — but it is a *smaller* static secret, not
the absence of one. Worth knowing as a pragmatic fallback; not a substitute for
the design below.

#### The workable path here

Avoid the Supervisor entirely for machines: give each spoke
a **second `JWTAuthenticator`** that trusts the hub's ServiceAccount issuer, and
present ArgoCD's projected SA token directly to the Concierge. Concierge
supports multiple authenticators, and the portal's registry is already
per-cluster — so this is one added field alongside `jwt_authenticator_name`:

```json
"machine_jwt_authenticator_name": "hub-serviceaccounts"
```

Two authenticators, two identity populations, separately mappable to groups:
humans via the Supervisor, machines via the hub SA issuer. That separation is
worth having on its own merits.

Prerequisite: the spoke must be able to verify the hub's SA issuer — either the
hub's `--service-account-issuer` is a URL the spoke can resolve with a reachable
JWKS, or the JWKS is copied into each spoke's authenticator config. This is real
infrastructure work and is the gating dependency for everything else here.

### 2. Caller validation requires a standing hub credential

Verifying the ArgoCD SA token means a `TokenReview` — a `POST` to the hub API
server. The portal has **no hub client at all**; every client it builds is a
spoke client constructed per-request from a user session.

This collides with the read-only constraint in `CLAUDE.md`. `TokenReview` is
non-mutating (as is `TokenCredentialRequest`, which the portal already POSTs),
so the constraint is not violated in spirit. But the portal would acquire a
**permanent hub ServiceAccount** with `create tokenreviews`. The property
described at `credentials.go:26` — that the portal holds no standing cluster
credential — survives for tenant resources, and stops being unqualified.

## The question worth asking first

Follow blocker 1 to its conclusion: **if the spoke's Concierge already trusts
the hub SA issuer, ArgoCD can present its projected token itself.** The exec
plugin collapses to roughly ten lines — read the file, emit `ExecCredential` —
with no portal in the path, no static secret, and kubelet handling rotation.

So the broker is not cryptographically necessary. What it actually buys:

- **Central authorization policy** — "may this caller sync cluster X?" decided
  in one place rather than encoded across every spoke's RBAC.
- **A single audit point** for machine access to every cluster.
- **Works when hub OIDC discovery is not reachable from spokes**, which is a
  common topology constraint.
- **Revocation without touching spokes** — cut a cluster off centrally.

Those are good reasons. They are *policy* reasons, and should be argued as such
rather than as a security requirement, because the cost is not small.

## What it costs

- **Availability.** Portal down today means a dashboard is down. As broker it
  means every sync on every spoke fails. ArgoCD caches credentials in memory
  until expiry, so a 15-minute TTL buys ~15 minutes of ride-through — no more.
  The portal moves from "nice to have up" to a hard dependency of CD.
- **Blast radius.** Today, compromising the portal yields whatever
  currently-logged-in users can read — bounded by session lifetime and per-user
  RBAC. As broker it yields on-demand credentials for every registered spoke.
  That is a Tier-0 component and changes the assume-breach analysis in
  [security-assurance.md](../security/security-assurance.md) materially.
- **Packaging.** Exec plugins run inside `argocd-application-controller` and
  `argocd-server`, so the `wxops` binary must be present in those images —
  a custom image or an initContainer populating a shared `emptyDir`. Verify
  ArgoCD's exec timeout against the latency of a five-hop credential mint,
  particularly on a cold cache.
- **Failure modes are new.** A credential mint that fails mid-sync surfaces as
  an opaque ArgoCD error. Plan the observability for this before shipping it,
  not after.

## Recommendation

Build it — but **not inside the portal process.**

Ship it as a separate Deployment with its own ServiceAccount and NetworkPolicy,
importing the shared `internal/cluster` package rather than living in the portal
binary. That preserves the passive-reflector property the OSS release leads
with: the read-path portal continues to hold zero standing credentials, while
the broker stays small, separately scaled, independently auditable, and its
availability requirements do not drag the dashboard along with them.

Sequencing: this is **post-v0.7.0 at the earliest**. It lands directly on the
security assurance claims being published with the OSS release, and reworking
those mid-launch would be poor timing. The dependency order is fixed regardless:

1. **Hub SA issuer verifiable from spokes** — infrastructure, gates everything.
2. **Second `JWTAuthenticator` per spoke** for machine identities, plus
   `machine_jwt_authenticator_name` in the cluster registry.
3. **Decide broker vs. direct** — with 1 and 2 done, direct SA-token projection
   works and costs nothing. Adopt the broker only when central policy or audit
   is worth the availability coupling.
4. **If broker: caller validation** — hub client, `TokenReview`, bearer auth
   mode on the portal API, and a rewrite of the relevant assurance claims.
5. **`wxops get-token`** and image packaging for ArgoCD.

Steps 1 and 2 are useful on their own and carry no commitment to the rest.

If multi-cluster CD becomes urgent before step 1 is feasible, the Pinniped
password-grant path is the sanctioned stopgap — but only if an IDP supporting
it is already in play. It is not worth adopting a second IDP to reach it.

## Reference

- [cluster-registry.md](cluster-registry.md) — spoke registration and per-cluster auth fields
- [../concepts/architecture.md](../concepts/architecture.md) — hub-spoke topology and the human auth flow
- [../security/security-assurance.md](../security/security-assurance.md) — the claims this design would revise
- [../cli/cli.md](../cli/cli.md) — the CLI that would host the credential plugin
- [Client-go credential plugins](https://kubernetes.io/docs/reference/access-authn-authz/authentication/#client-go-credential-plugins) — the `ExecCredential` contract
- [Pinniped: CI/CD howto](https://pinniped.dev/docs/howto/cicd/) — the password-grant path and Pinniped's explicit non-goal of service-to-service auth
- [Gitea OAuth2 provider](https://docs.gitea.com/development/oauth2-provider/) — supported grants (Authorization Code, `refresh_token`, PKCE); no password grant
