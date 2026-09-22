# RFC-010: Enterprise Audit Trail

> **Status:** proposed — formalizing an already dev-ready spec into RFC form.
> **Owner:** platform-team. **Spans:** `wxops-portal-v2` (`internal/audit/` new package,
> `internal/handlers/audit.go`, mutating-handler instrumentation).
>
> **Grounding:** this is `enterprise-roadmap.md` §2 (Track A), migrated into RFC form now that
> `ROADMAP.md` and the RFC series are the only surviving roadmap artifacts. The design below was
> already dev-ready in the source — this RFC restructures it, it does not re-derive it. **Depended on
> by** `RFC-011` (Governance
> scorecards consume Track A's compliance posture signal, per the source doc's own Phase 1 pairing).

---

## Summary

Every mutating action in the portal already produces a reviewable Git artifact (a PR, a commit), but
three things an auditor needs are missing: who clicked the button and with what intent (not just the
resulting commit's author, which may be the portal's service account), read/access events on
secret-bearing entities, and the approval chain surfaced back in the portal next to the action it
gates. This RFC proposes a stateless `internal/audit/` package — structured JSON events to stdout,
consumed by the cluster's existing SIEM pipeline — plus a compliance posture panel computed live from
the caller's own Pinniped credentials.

## Motivation

An enterprise security review's easiest boxes to check are the ones this project already satisfies
structurally (immutable audit via signed commits, least-privilege via read-only cluster access,
one RBAC system). The remaining gap is narrow and specific: **actor + intent at click-time** isn't
captured as a first-class event, only the resulting commit is — and that commit's author may be the
portal's own service account, not the human who triggered it. Closing this gap is what turns "every
change is a reviewed Git commit" from a true statement into an *auditable* one.

## Detailed Design

### The event model — stateless by construction

```go
// internal/audit/event.go
type Event struct {
    Time     time.Time `json:"time"`
    Actor    string    `json:"actor"`      // session username (Gitea login)
    Groups   []string  `json:"groups"`     // Pinniped groups at action time
    Action   string    `json:"action"`     // "promote", "scaffold", "darlane.enable", "kubeconfig.download", …
    Kind     string    `json:"kind"`       // "Component", "Cluster", "Secret", …
    Target   string    `json:"target"`     // entity name / cluster id
    Env      string    `json:"env,omitempty"`
    Result   string    `json:"result"`     // "ok" | "denied" | "error"
    Reason   string    `json:"reason,omitempty"`
    PRNumber int       `json:"prNumber,omitempty"`
    TraceID  string    `json:"traceId"`
}
```

Wired as Gin middleware on every mutating route, plus explicit `audit.Emit` calls in sensitive-read
handlers (`GetKubeconfig`, `GetEntitySpec` for Vault-annotated entities). No database — events go to
stdout only, consistent with the design rule threaded through every enterprise-track document: *"the
moment we add a stateful audit DB or a secrets cache, we forfeit the thing that makes the security
review easy."*

### Approval chain — derived, not stored

When the Activity feed shows an action, it fetches the merging PR's reviewers from the Gitea API
(`GET /repos/{owner}/{repo}/pulls/{n}/reviews`) and renders them as the approval chain. The
gitops-infra URL stays hidden per the existing security model — only reviewer usernames and approval
timestamps surface.

### Compliance posture panel

A read-only "Compliance" tab on the Cluster view, computed with the caller's own Pinniped-scoped
credentials — never a portal service account:

| Signal | Source | Read path |
|---|---|---|
| RBAC audit | `RoleBinding`/`ClusterRoleBinding` subjects in `tenant-{org}` | K8s API via Pinniped |
| Pod security | `pod-security.kubernetes.io/*` labels + running `securityContext` | K8s API via Pinniped |
| Vault policy coverage | Entities with `wxops.cloud/vault-path` + matching `ExternalSecret` | Catalog + K8s status |
| Network policy coverage | Presence of the Kyverno-generated `NetworkPolicy` per namespace | K8s API via Pinniped |

This is surfacing, not enforcement — enforcement stays in Kyverno on the cluster, unchanged.

### Backend surface

```
internal/audit/                NEW — Event type, Emit(), Gin middleware
internal/handlers/audit.go     NEW — GET /compliance/:clusterId
internal/handlers/catalog.go   + emit on promote/deprecate/darlane/secrets
internal/handlers/clusters.go  + emit on kubeconfig download
internal/gitea/                + PullReviews(owner, repo, n)
```

```
GET  /api/v1/compliance/:clusterId
GET  /api/v1/catalog/entities/:kind/:name/approval-chain
```

## Drawbacks

- Every mutating handler needs an audit-emit call added — mechanical, but real surface area to touch
  and to miss (the acceptance criteria below exist specifically to catch omissions).
- The approval chain depends on Gitea's review API faithfully reflecting who approved what — if a
  repo's branch protection allows self-merge or bypass, the approval chain silently reflects that
  weaker guarantee without flagging it as weaker.

## Alternatives

- **A stateful audit database instead of stdout→SIEM.** Rejected in the source document on principle —
  it's the one thing that would compromise the "portal holds no data" security pitch this whole
  enterprise track exists to strengthen, for a capability (retention, cross-session query) the SIEM
  already provides.

## Rollout Plan

1. `internal/audit/` package + Gin middleware first — this alone gives every mutating route consistent
   `ok`/`denied`/`error` event emission, independent of the compliance panel.
2. Explicit `audit.Emit` calls on the two named sensitive-read handlers (`GetKubeconfig`,
   `GetEntitySpec`) — small, additive, no dependency on step 1 beyond sharing the same package.
3. `PullReviews` + the approval-chain endpoint — depends on nothing else here, can parallelize with 1–2.
4. Compliance posture panel last — it's the most UI-facing piece and the one most naturally deferred if
   resourcing is tight, since the audit events themselves are the load-bearing part for an auditor.
5. Per the source document's own sequencing: `RFC-011`'s scorecards consume this RFC's posture signal —
   this RFC should land first if both are being built.

## Open Questions

1. Is `schemaVersion` on the event type needed from day one (so SIEM parsers stay stable across
   changes), or is that safe to add later since nothing consumes the schema yet?
2. Does Guardian's own audit layer (per `RFC-008`'s and `RFC-009`'s cross-repo findings) end up sharing
   this exact event schema family (`layer: "portal" | "workspace"`), or does that reconciliation wait
   until Guardian actually ships?
3. What's the actual SIEM/log pipeline this targets in a real deployment — is "stdout, captured by the
   cluster's existing Loki" a safe assumption for every adopter, or does this need to be documented as
   an operator responsibility with an explicit fallback if no log pipeline exists?
