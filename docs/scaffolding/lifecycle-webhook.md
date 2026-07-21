# Lifecycle Promotion

> **v0.3.0 change:** `POST /api/v1/webhooks/promote/:kind/:name` has been removed.
> Lifecycle promotion is now fully UI-driven via the Promotion panel on each
> Component detail page. This document describes the current model.

---

## How Promotion Works (v0.3.0+)

Lifecycle transitions are a two-step UI flow, not an automated webhook:

```
experimental ──(1. overlay PR)──► development ──(2. confirm)──► staging ──► production
     │                                                                           │
     └──────────────── deprecated (removal PR, entity locked) ──────────────────┘
```

### Step 1 — Create overlay PR

The developer opens the **Promotion panel** on the Component entity detail page and
clicks "Create overlay" for the target environment. The portal:

1. Generates the Kustomize overlay files (`kustomization.yaml`,
   `image-transformer.yaml`, `patch-xtenant-app.yaml`)
2. Writes Vault secrets for that environment (if any were provided)
3. Opens a `[Promote] {team}/{app} → {env}` PR in `gitops-infra`
4. Platform-team reviews and merges the PR

### Step 2 — Confirm

Once the PR is merged, the Promotion panel shows a **Confirm** button.
Clicking it:

1. Calls `GET /api/v1/catalog/entities/:kind/:name/promostatus` to verify
   the overlay file is present on `main` in `gitops-infra`
2. On confirmation, calls `POST /api/v1/catalog/entities/:kind/:name/promote`
   with `action: confirm` — updates the catalog entity lifecycle
3. Panel refreshes immediately; the confirm button clears

If the PR is still open (not yet merged), the panel shows "PR #N pending"
and the Confirm button is disabled.

---

## Permission Matrix

| Transition | Who can trigger |
|---|---|
| `experimental` → `development` | Any team member |
| `development` → `staging` | Platform-team or `{team}:Managers` |
| `staging` → `production` | Platform-team or `{team}:Managers` |
| Deprecation | Platform-team or `{team}:Managers` |

---

## Overlay Configuration

The overlay wizard (accessible from the Promotion panel) exposes per-environment
configuration committed into the Kustomize overlay:

| Field | Notes |
|---|---|
| Replicas | Per-environment pod count |
| Ingress host | Per-environment hostname |
| CPU / memory limits | Per-environment resource requests and limits |
| Vault secrets | Written to `{team}/{app}/{env}/env` at creation; optional on update |
| Database | Shared or dedicated CNPG tier, per-environment naming (`{appName}-{env}-db`) |

See [cross-environment-promotion.md](./cross-environment-promotion.md) for the
full overlay structure and permission details.

---

## Catalog Cache Refresh Webhook

The only remaining webhook is the **catalog cache invalidation** endpoint.
It flushes the in-memory 5-minute TTL cache so new catalog entities appear
immediately after a gitops-infra push.

```
POST /api/v1/webhooks/catalog/refresh
Authorization: Bearer <WEBHOOK_TOKEN>
```

**Setup** (one-time, platform-team):
- Repository: `gitops-infra` → Settings → Webhooks → Add
- URL: `https://<portal-host>/api/v1/webhooks/catalog/refresh`
- Content type: `application/json`
- Authorization header: `Bearer <WEBHOOK_TOKEN>`
- Trigger: Push events (optionally restrict to `catalog/**` paths)

`WEBHOOK_TOKEN` is the same env var used previously for lifecycle promotion —
no new secret is needed if it was already configured.

---

## Migration from v0.2.x

If you had a CI workflow in `gitops-infra` calling
`POST /api/v1/webhooks/promote/:kind/:name`, it can be safely removed.

The workflow that watched `tenants-apps/**/overlays/dev/kustomization.yaml`
on push is no longer needed. Lifecycle updates are now confirmed by the
developer in the portal UI after the overlay PR merges.

**Existing services** that already have `overlays/dev/` on `main` and are
currently `experimental` can be reconciled by clicking **Confirm** in the
Promotion panel — the portal will detect the overlay and update lifecycle
to `development` in one click.

---

## WEBHOOK_TOKEN Configuration

| Location | Variable | Purpose |
|---|---|---|
| Portal backend (env) | `WEBHOOK_TOKEN` | Validates incoming catalog/refresh calls |
| `gitops-infra` repo secrets | `PORTAL_WEBHOOK_TOKEN` | CI passes it as `Bearer` header to the cache refresh webhook |

```bash
# Generate a token if not already set
TOKEN=$(openssl rand -hex 32)

# Set in portal deployment (same as before)
kubectl create secret generic wxops-portal-secrets \
  --from-literal=webhook-token=$TOKEN \
  --namespace wxops-system

# Set in gitops-infra Gitea repo secrets
# Settings → Secrets → Actions → PORTAL_WEBHOOK_TOKEN = $TOKEN
```
