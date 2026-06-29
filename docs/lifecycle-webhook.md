# Lifecycle Promotion Webhook

How the portal automatically transitions entity lifecycle from `experimental`
to `development` when the gitops-infra overlay for that environment is merged.

**Table of Contents**
- [Lifecycle Promotion Webhook](#lifecycle-promotion-webhook)
  - [Trigger Options](#trigger-options)
  - [Validation Chain](#validation-chain)
  - [Option A — GitOps CI Pipeline (Recommended Default)](#option-a--gitops-ci-pipeline-recommended-default)
    - [Required repo secrets](#required-repo-secrets)
    - [How it flows](#how-it-flows)
  - [Option B — ArgoCD Notification](#option-b--argocd-notification)
    - [Trust Chain](#trust-chain)
    - [ArgoCD Setup](#argocd-setup)
    - [How it flows](#how-it-flows-1)
  - [Two Routes, Two Auth Methods](#two-routes-two-auth-methods)
  - [Token Naming](#token-naming)
  - [Security Considerations](#security-considerations)
  - [Manual Promotion (Platform-Team UI)](#manual-promotion-platform-team-ui)

---

## Trigger Options

Two callers are supported — they use the same endpoint and the same token.
You can use either or both simultaneously; the endpoint is idempotent.

| Caller | Where the CI lives | When it fires | Best for |
|--------|--------------------|--------------|----------|
| **GitOps CI pipeline** | `gitops-infra` repo | On push to main (after scaffold PR merge) | All teams — set up once, works for every project |
| **ArgoCD Notification** | ArgoCD notification config | After sync + healthy in the dev cluster | Production-grade: confirms the app is actually running |

**Direct commit, not a PR.** When the promotion succeeds, the portal commits
`lifecycle: development` directly to the catalog entity YAML in gitops-infra
main. No PR is created — the approval already happened when the platform team
merged the scaffold PR that introduced the overlay.

For higher transitions (`development → staging`, `staging → production`),
human approval is required via the platform-team UI. Those create overlay PRs
as part of the [cross-environment promotion](cross-environment-promotion.md) flow.

---

## Validation Chain

```
Webhook arrives (GitOps CI or ArgoCD)
        │
        ▼
  1. Token matches WEBHOOK_TOKEN?  ─── no ──► 401 Unauthorized
        │ yes
        ▼
  2. Entity exists in catalog?     ─── no ──► 404 Not Found
        │ yes
        ▼
  3. Current lifecycle is           ─── no ──► 200 {"changed": false}
     "experimental"?                           (already promoted — no-op)
        │ yes
        ▼
  4. Commit lifecycle: development
     directly to main (metadata only, no PR)
        │
        ▼
     200 OK { "lifecycle": "development", "changed": true }
```

---

## Option A — GitOps CI Pipeline (Recommended Default)

The CI step lives in the **gitops-infra** repository, not in each scaffolded
project repo. Platform team sets it up once; it fires automatically for every
project when an overlay is merged into main.

```yaml
# gitops-infra/.gitea/workflows/lifecycle-sync.yaml
name: Sync lifecycle on overlay merge

on:
  push:
    branches: [main]
    paths:
      - 'tenants-apps/**/overlays/dev/kustomization.yaml'

jobs:
  promote:
    runs-on: ubuntu-latest
    steps:
      - name: Detect promoted apps and call portal
        env:
          PORTAL_URL: ${{ secrets.PORTAL_URL }}
          PORTAL_WEBHOOK_TOKEN: ${{ secrets.PORTAL_WEBHOOK_TOKEN }}
        run: |
          # Extract app names from changed overlay paths
          git diff-tree --no-commit-id -r --name-only ${{ gitea.sha }} \
            | grep 'tenants-apps/.*/overlays/dev/kustomization.yaml' \
            | sed 's|tenants-apps/[^/]*/\([^/]*\)/overlays/.*|\1|' \
            | sort -u \
            | while read APP_NAME; do
                echo "Promoting $APP_NAME to development"
                STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -X POST \
                  "$PORTAL_URL/api/v1/webhooks/promote/Component/$APP_NAME" \
                  -H "Authorization: Bearer $PORTAL_WEBHOOK_TOKEN" \
                  -H "Content-Type: application/json" \
                  --data '{"lifecycle":"development"}')
                echo "$APP_NAME → $STATUS"
              done
```

### Required repo secrets

Set these once on the **gitops-infra** repository
(`Settings → Secrets → Actions`):

| Secret | Value |
|--------|-------|
| `PORTAL_URL` | Public URL of the portal, e.g. `https://portal.example.com` |
| `PORTAL_WEBHOOK_TOKEN` | Same value as `WEBHOOK_TOKEN` in the portal environment |

### How it flows

```
Platform team merges scaffold PR into gitops-infra main
(PR contains XTenantApp + overlays/dev/kustomization.yaml):

  1. Gitea push event fires on gitops-infra main
  2. lifecycle-sync.yaml detects overlays/dev/kustomization.yaml in the diff
  3. CI calls POST /api/v1/webhooks/promote/Component/payment-api
  4. Portal validates token → commits lifecycle: development to gitops-infra main
  5. Catalog shows: payment-api — lifecycle: development
```

---

## Option B — ArgoCD Notification

Fires after ArgoCD confirms sync + healthy — stronger guarantee that the
app is actually running, not just that the overlay was merged.

### Trust Chain

```
Platform team manages:
  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
  │  Portal          │     │  ArgoCD          │     │  Gitea           │
  │                  │     │                  │     │  (gitops-infra)  │
  │  WEBHOOK_TOKEN   │◄───►│  Same token in   │     │                  │
  │  in env vars     │     │  notification    │     │  Branch          │
  │                  │     │  config          │     │  protection      │
  └─────────────────┘     └─────────────────┘     └─────────────────┘
```

| Component | Who configures | What they set |
|-----------|---------------|---------------|
| Portal | Platform team | `WEBHOOK_TOKEN` env var |
| ArgoCD | Platform team | Same token in `argocd-notifications-secret` |
| Gitea | Platform team | Branch protection on gitops-infra main |

### ArgoCD Setup

```bash
# 1. Store the token in ArgoCD's notification secret
kubectl -n argocd create secret generic argocd-notifications-secret \
  --from-literal=portal-webhook-token=<WEBHOOK_TOKEN> \
  --dry-run=client -o yaml | kubectl apply -f -
```

```yaml
# 2. argocd-notifications-cm
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-notifications-cm
  namespace: argocd
data:
  trigger.on-sync-succeeded: |
    - when: app.status.sync.status == 'Synced' && app.status.health.status == 'Healthy'
      send: [promote-lifecycle]

  template.promote-lifecycle: |
    webhook:
      portal:
        method: POST
        path: /api/v1/webhooks/promote/Component/{{.app.metadata.annotations.wxops-app-name}}
        body: |
          {"lifecycle": "development"}

  service.webhook.portal: |
    url: https://portal.example.com
    headers:
      - name: Authorization
        value: Bearer $portal-webhook-token
      - name: Content-Type
        value: application/json
```

```yaml
# 3. ApplicationSet template — annotate with the app name
spec:
  template:
    metadata:
      annotations:
        wxops-app-name: "{{path[2]}}"   # extracts from tenants-apps/<team>/<app>/
```

### How it flows

```
1. Portal opens scaffold PR → platform team merges
2. ArgoCD ApplicationSet detects overlays/dev/
3. ArgoCD syncs → Crossplane provisions → pods start
4. ArgoCD notification fires (Synced + Healthy)
   POST /api/v1/webhooks/promote/Component/payment-api
5. Portal validates → commits lifecycle: development
6. Catalog shows: payment-api — lifecycle: development
```

---

## Two Routes, Two Auth Methods

| Route | Auth | Who calls it | Allowed transitions |
|-------|------|-------------|-------------------|
| `POST /api/v1/webhooks/promote/:kind/:name` | `Authorization: Bearer <WEBHOOK_TOKEN>` | GitOps CI or ArgoCD | `experimental → development` only |
| `POST /api/v1/catalog/entities/:kind/:name/promote` | Portal session cookie | Platform-team via UI | Any: staging, production, demotion |

The webhook route is **outside** the session middleware — no cookie needed.
The UI route is **inside** the auth group — requires logged-in platform-team user.

---

## Token Naming

Two names, one value:

| Name | Where it lives | Who reads it |
|------|---------------|-------------|
| `WEBHOOK_TOKEN` | Portal backend environment | Portal validates incoming calls |
| `PORTAL_WEBHOOK_TOKEN` | Gitea repo secret on `gitops-infra` | CI workflow passes it as Bearer token |

Platform team sets the same generated value in both places:
```bash
# Generate once
TOKEN=$(openssl rand -hex 32)

# 1. Set in portal environment (Kubernetes Secret / .env)
# WEBHOOK_TOKEN=$TOKEN

# 2. Set as Gitea repo secret on gitops-infra
# Settings → Secrets → Actions → PORTAL_WEBHOOK_TOKEN = $TOKEN
```

---

## Security Considerations

| Concern | How it's addressed |
|---------|-------------------|
| Token leakage | Stored in K8s Secret (ArgoCD/portal) or Gitea repo secret. Never in git, never in logs. |
| Webhook replay | Idempotent — promoting an already-development entity returns `{"changed": false}`. |
| Unauthorized promotion to staging/prod | Webhook can ONLY do `experimental → development`. All other transitions require platform-team session. |
| Token rotation | Generate new token → update portal env + gitops-infra repo secret → restart portal. No downtime. |
| Portal down when webhook fires | CI logs the HTTP status. ArgoCD notifications retry with backoff. |

---

## Manual Promotion (Platform-Team UI)

For `development → staging` and `staging → production`, the portal UI
shows a promote button visible only to platform-team members.

```
POST /api/v1/catalog/entities/Component/payment-api/promote
Cookie: wxops_session=<session>
Body: {"lifecycle": "staging"}
```

See [cross-environment promotion](cross-environment-promotion.md) for
the full design including overlay generation and approval flow.
