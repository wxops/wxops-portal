# WxOps Portal — Permissions Reference

Every action in the portal maps to one of three roles derived directly from
Gitea OIDC group membership. There is no separate permission database — the
portal reads the groups inside the session token on every request.

---

## Roles

| Role | How it is assigned | Gitea group format |
|------|--------------------|--------------------|
| **Developer** | Member of any org team | `{org}:{team}` (e.g. `wxops:rocket-team`) |
| **Manager** | Member of a team's `Managers` sub-group | `{team}:Managers` (e.g. `rocket-team:Managers`) |
| **Platform Team** | Member of the platform-team group | `platform-team` |

**Managers inherit all Developer permissions** for their own team.
**Platform Team inherits all Developer and Manager permissions** across every team.

---

## Role × Action Matrix

### Service Catalog

| Action | Developer (own team) | Developer (other team) | Manager (own team) | Platform Team |
|--------|:---:|:---:|:---:|:---:|
| Browse catalog (all entities) | ✓ | ✓ | ✓ | ✓ |
| View entity detail | ✓ | ✓ | ✓ | ✓ |
| View draft Doc (own authorship) | ✓ | — | ✓ | ✓ |
| View draft Doc (other author) | — | — | — | ✓ |
| Register entity (any kind) | ✓ own team | — | ✓ | ✓ |
| Register Doc entity (direct commit) | ✓ own team | — | ✓ | ✓ |
| Edit entity | ✓ own team | — | ✓ | ✓ |
| Edit entity (no owner set) | — | — | — | ✓ |
| **Delete entity** | — | — | — | ✓ only |
| Update Vault secrets | ✓ own team | — | ✓ | ✓ |
| Edit config (XTenantApp features) | ✓ own team | — | ✓ | ✓ |
| Import repo into catalog | ✓ own team | — | ✓ | ✓ |
| View activity feed | own PRs only | — | own PRs only | all PRs |

---

### Lifecycle Promotion

| Transition | Developer | Manager (own team) | Platform Team |
|------------|:---------:|:------------------:|:-------------:|
| `experimental` → create dev overlay PR | ✓ | ✓ | ✓ |
| `experimental` → confirm dev lifecycle | ✓ | ✓ | ✓ |
| `development` → create staging overlay PR | — | ✓ | ✓ |
| `development` → confirm staging lifecycle | — | ✓ | ✓ |
| `staging` → create production overlay PR | — | ✓ | ✓ |
| `staging` → confirm production lifecycle | — | ✓ | ✓ |
| Update overlay config (any env) | dev overlay only | ✓ | ✓ |
| **Deprecate entity** | — | ✓ | ✓ |

> Lifecycle is never directly editable. It is a consequence of verified overlay
> state in `gitops-infra`. Transitions that require a PR are not instant — they
> take effect after platform-team merges the PR and the developer clicks Confirm.

---

### Darlane (Parallel Debug Pods)

| Action | Developer | Manager (own team) | Platform Team |
|--------|:---------:|:------------------:|:-------------:|
| Enable Darlane on `dev` (direct commit) | ✓ own team | ✓ | ✓ |
| Reconfigure Darlane on `dev` | ✓ own team | ✓ | ✓ |
| Enable Darlane on `staging` (opens PR) | — | ✓ | ✓ |
| Enable Darlane on `production` (opens PR) | — | ✓ | ✓ |
| Exec / port-forward into Darlane pod | ✓ (kubectl, out-of-band) | ✓ | ✓ |
| File-sync (`wxops darlane sync`) | ✓ | ✓ | ✓ |

> `staging` and `production` Darlane always go through a PR — even after the
> Manager/platform-team submits from the portal. The PR gate is the enforcement
> mechanism, not the UI.

---

### Golden-Path Scaffolding

| Action | Developer | Manager | Platform Team |
|--------|:---------:|:-------:|:-------------:|
| Run scaffold wizard (create project) | ✓ own team | ✓ | ✓ |
| View YAML preview during scaffold | ✓ | ✓ | ✓ |
| Scaffold for another team | — | — | ✓ |

> Scaffold validates team membership against the `Team` field selected in the
> wizard. A developer cannot scaffold under a team they are not a member of.

---

### Cluster Views

| Action | Developer | Manager | Platform Team |
|--------|:---------:|:-------:|:-------------:|
| View cluster list | ✓ | ✓ | ✓ |
| View pods / deployments (own namespace) | ✓ | ✓ | ✓ |
| View pods / deployments (all namespaces) | — | — | ✓ |
| Download kubeconfig | ✓ | ✓ | ✓ |
| Write to cluster (scale, apply, delete) | — | — | — (never) |

> The portal never writes to the Kubernetes API. Cluster views are strictly
> read-only for all roles. Config changes go through Gitea PR + ArgoCD.

---

### `wxops` CLI

| Command | Developer | Manager | Platform Team |
|---------|:---------:|:-------:|:-------------:|
| `wxops login` | ✓ | ✓ | ✓ |
| `wxops catalog list` | ✓ | ✓ | ✓ |
| `wxops catalog get <kind> <name>` | ✓ | ✓ | ✓ |
| `wxops debug <service>` (read-only) | ✓ | ✓ | ✓ |
| `wxops darlane sync <app>` | ✓ own team pod | ✓ | ✓ |
| `wxops version` | ✓ | ✓ | ✓ |

> CLI permissions are enforced server-side by the same backend rules as the
> portal UI. The CLI is read-only from a GitOps perspective — `wxops darlane sync`
> streams files into a running pod but does not modify `gitops-infra`.

---

## Vault Constraints (all roles)

The portal enforces these regardless of role — they are security invariants, not
role-based permissions:

| Operation | Allowed |
|-----------|---------|
| Create a Vault secret | ✓ (own team path only) |
| Update a Vault secret | ✓ (own team path only) |
| Read a Vault secret | — never |
| Delete a Vault secret | — never |

Vault path is always derived from the entity's `wxops.cloud/vault-path` annotation
(`{team}/{appName}/{env}`). The portal verifies the Gitea repo and gitops config
exist before writing.

---

## What No Role Can Do

These operations are locked at the API level regardless of who is logged in:

- Write to a spoke cluster K8s API (apply, scale, delete resources)
- Read or delete Vault secrets
- Access `gitops-infra` PR URLs (only status text is returned to the UI)
- Promote lifecycle beyond `experimental` without a merged overlay in `gitops-infra`
- Enable Darlane on staging/production without a portal-managed PR
- Delete catalog entities (platform-team only, but still gated by the action's
  destructive nature — see CLAUDE.md security constraints)

---

## How Roles Are Resolved

```
Gitea OIDC login
  └─► id_token contains groups[] claim
        ├─ "wxops:rocket-team"     → Developer on rocket-team
        ├─ "rocket-team:Managers"  → Manager on rocket-team
        └─ "platform-team"         → Platform Team (global)
```

The session cookie (`wxops_session`, AES-256-GCM encrypted, `HttpOnly`) carries
the decoded groups. Every backend handler reads them via `auth.GetSession(c)`.
There is no database lookup and no secondary cache — the session IS the role.

Three helper functions enforce all checks:

| Function | What it checks |
|----------|----------------|
| `auth.MemberOfTeam(groups, team)` | User is in `team` OR is `platform-team` |
| `auth.IsTeamManager(groups, owner)` | User is in `{team}:Managers` |
| `auth.IsPlatformTeam(groups)` | User is in `platform-team` |

---

## Namespace Derivation (Cluster Views)

The portal never calls `GET /api/v1/namespaces` for tenant users — the response
is all-or-nothing and 403s for most developers. Namespaces are derived from
the Gitea OIDC group format:

```
org:teamName  →  tenant-{org}
```

Platform-team users fall through to the K8s API and see all namespaces.

---

## Related Docs

| Doc | What it covers |
|-----|---------------|
| [docs/security/security-assurance.md](security-assurance.md) | Evidence that the portal is a passive reflector — no cluster writes, no traffic interception, bounded egress, assume-breach blast radius |
| [docs/architecture.md](../concepts/architecture.md) | Auth flow, session model, Pinniped token exchange |
| [docs/darlane.md](../darlane/darlane.md) | Darlane XR schema, wizard, per-env permission model |
| [docs/cross-environment-promotion.md](../scaffolding/cross-environment-promotion.md) | Full promotion flow, overlay config, deprecation |
| [docs/lifecycle-webhook.md](../scaffolding/lifecycle-webhook.md) | CI webhook that fires on dev overlay merge |
