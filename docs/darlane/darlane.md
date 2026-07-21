# Darlane — Per-Environment Parallel Debug Pods

> **Status:** Shipped (v0.4.0).
> - Darlane config is on-demand and per-environment; it is **not** set at scaffold time.
> - Enabled via the Promotion panel UI (portal) or `wxops debug` CLI.
> - XR schema is defined in this document to serve as the **contract** for the
>   platform team when shipping the next XTenantApp composition version.

---

## What Darlane Is

Darlane is a parallel debug pod that runs alongside the production workload
inside the spoke cluster. It allows a developer to:

- **Scale a dev replica up** on demand without touching the main deployment
- **Exec directly** into the container with their own image overrides or start command
- **File-sync** a local source tree into the pod (via `wxops darlane sync` or VS Code Remote)
- **Mirror live traffic** to their local process (via Mirrord) without re-deploying
- **Scale back to zero** when done, releasing cluster resources

The pod is governed by the same XTenantApp XR as the regular deployment — it is
not a separate object. The `spec.parameters.darlane` block tells the composition
to provision an additional Deployment (or PodSpec override) with the debug
configuration, scoped to that environment.

---

## Architecture: Overlay-Driven, Not Scaffold-Time

Darlane config lives in the **overlay kustomization**, not the base XTenantApp.
This mirrors how ingress host, TLS issuer, DB cluster, and replica counts are
managed: base stays environment-agnostic; per-env behaviour is a JSON 6902 patch.

```
tenants-apps/{team}/{app}/
  base/
    xtenant-app.yaml          ← no darlane block here
  overlays/dev/
    kustomization.yaml        ← darlane patch injected here
    patch-xtenant-app.yaml
    image-transformer.yaml
  overlays/staging/
    kustomization.yaml        ← optional separate darlane config for staging
  overlays/production/
    kustomization.yaml        ← optional, requires productionOverride: true in composition
```

The portal reads each overlay's `kustomization.yaml` at request time to determine
`darlaneEnabled` per environment. There is no catalog annotation that signals
this — the overlay file is the single source of truth.

---

## The Patch Format

The portal generates a [JSON 6902](https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/patches/)
`op: add` patch targeting the `XTenantApp` resource by name.

**Minimal patch (replicas=0, ttl=4h):**

```yaml
- op: add
  path: /spec/parameters/darlane
  value:
    enabled: true
    replicas: 0
    ttl: 4h
```

**Full patch with all optional fields:**

```yaml
- op: add
  path: /spec/parameters/darlane
  value:
    enabled: true
    replicas: 1
    ttl: 8h
    command:
    - uvicorn
    - main:app
    - --reload
    - --host
    - "0.0.0.0"
    - --port
    - '8080'
    fileSync:
      enabled: true
      mountPath: /app
      initFromImage: true       # copy image filesystem into the volume before sync
    env:
    - name: FEATURE_NEW_RANKING
      value: "true"
    resources:
      requests:
        cpu: 100m
        memory: 128Mi
      limits:
        cpu: 500m
        memory: 512Mi
    trafficWeight: 30           # % of ingress traffic routed to Darlane pod
    stickySession:
      enabled: true
      cookieName: darlane-ab    # Traefik sets this; value is an opaque backend hash
      secure: true
      sameSite: lax
    headerRouting:
      enabled: true             # bypasses trafficWeight; works with trafficWeight: 0
      header: X-Target-Env      # HTTP header name (case-sensitive)
      value: darlane            # header value to match
      # e.g.: curl -H "X-Target-Env: darlane" https://payment-api.example.com/
    containerPort: '8080'       # if dev server uses a different port than the main app
    telemetryPort: '4318'       # OTEL collector port for A/B observability
    productionOverride: true    # required for staging/production environments
```

---

## XR Schema Contract

> This section is the source of truth for the **next XTenantApp composition**.
> The portal writes exactly these fields; the composition must read them.

### `spec.parameters.darlane` (object, optional)

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | bool | — | Must be `true` for the composition to act. If absent or `false`, ignore the entire block. |
| `replicas` | int32 | `0` | Desired replica count for the debug pod. `0` = scaled down; `1+` = always-on. The composition should allow the TTL controller to override this. |
| `ttl` | string | `"4h"` | Advisory duration for auto scale-down. Format: Go duration string (`"1h"`, `"8h"`, `"24h"`). The composition or a sidecar controller reads this. See [TTL semantics](#ttl-semantics) below. |
| `command` | []string | — | Override the container entry-point. Replaces the image `CMD`. If absent, use the image default. |
| `image` | string | — | Override the container image for the debug pod. If absent, use the same image as the main deployment. |
| `fileSync.enabled` | bool | — | Mount a writable `emptyDir` volume (or a PVC, composition decides) at `fileSync.mountPath`. Required for `wxops darlane sync` / VS Code Remote. |
| `fileSync.mountPath` | string | `"/app"` | Mount path inside the container. |
| `fileSync.initFromImage` | string | `"true"` | Seed the writable volume via an init container. `"true"` = copy from the Darlane pod's own image; an image reference (`registry/app:tag`) = copy from a specific image; `"false"` = start with an empty volume (sync from scratch). |
| `trafficWeight` | int32 | `0` | Percentage of ingress traffic routed to the Darlane pod. `0` = debug-only. `1–99` = A/B split. `100` = full canary. The composition should no-op if the traffic-split controller is not installed. |
| `stickySession.enabled` | bool | — | Pin each user to the same backend for the session. Traefik sets a cookie whose value is an opaque backend hash — the app does not control the cookie value. |
| `stickySession.cookieName` | string | `"darlane-ab"` | Cookie name Traefik uses for sticky routing. Override if multiple apps share the same domain. |
| `stickySession.secure` | bool | `true` | Set the `Secure` flag — cookie sent over HTTPS only. |
| `stickySession.sameSite` | string | `"lax"` | `lax` (default), `strict`, or `none`. `none` requires `secure: true`. |
| `headerRouting.enabled` | bool | — | Route requests that carry a specific HTTP header to the Darlane pod, bypassing `trafficWeight` and cookie assignment. Works with `trafficWeight: 0` — real users are unaffected. |
| `headerRouting.header` | string | `"X-Target-Env"` | HTTP header name to match (case-sensitive). |
| `headerRouting.value` | string | `"darlane"` | Header value to match (case-sensitive). Requests with this header→value are always sent to the Darlane pod. |
| `env` | []EnvVar | — | Extra env vars injected into the debug pod only (`name` / `value` pairs). Merged with the base deployment env. Use for feature flags — same image, different runtime behaviour. |
| `resources.requests.cpu` | string | — | CPU request for the debug pod. If absent, inherits from the main deployment spec. |
| `resources.requests.memory` | string | — | Memory request. |
| `resources.limits.cpu` | string | — | CPU limit. |
| `resources.limits.memory` | string | — | Memory limit. |
| `containerPort` | string | — | Dev server port if different from the main app (must be a quoted string, e.g. `'8080'`). |
| `telemetryPort` | string | — | OTEL collector port for side-by-side A/B observability (must be a quoted string). |
| `productionOverride` | bool | `false` | Safety gate. The composition MUST check this before provisioning a debug pod in staging or production. Portal enforces this — developers cannot set it via the wizard; only managers and platform-team can. |

### TTL Semantics

The `ttl` field is a **hint** to the composition about how long the debug pod
should remain alive. The composition team decides the enforcement mechanism:

- **Inactivity-based** (recommended): scale `replicas` to `0` after N hours with
  no traffic or exec sessions. Requires a controller (e.g. KEDA HTTP add-on, a
  custom operator watching pod last-access).
- **Hard cutoff**: scale `replicas` to `0` exactly N hours after the pod started.
  Simpler — implement as a `CronJob` or `ttlSecondsAfterFinished`-like annotation.

Until the composition implements TTL, the field is informational. Developers
scale down manually (`kubectl scale --replicas=0`) or via the portal/CLI.

### Object naming

The portal targets the XTenantApp by name in the patch `Target`:

| Environment | XR name |
|---|---|
| `dev` | `{team}-{appName}` |
| `staging` | `{team}-{appName}-staging` |
| `production` | `{team}-{appName}-production` |

This matches the existing naming convention used by the Promotion overlay patches
for ingress, cert, and DB config.

---

## API Endpoint

```
POST /api/v1/catalog/entities/{kind}/{name}/darlane
```

**Request body:**

```json
{
  "env": "dev",
  "replicas": 1,
  "ttl": "4h",
  "command": ["uvicorn", "main:app", "--reload", "--host", "0.0.0.0", "--port", "8080"],
  "fileSync": true,
  "mountPath": "/app",
  "initFromImage": "true",
  "envVars": [{ "name": "FEATURE_NEW_RANKING", "value": "true" }],
  "resourcesCpuReq": "100m",
  "resourcesCpuLim": "500m",
  "resourcesMemReq": "128Mi",
  "resourcesMemLim": "512Mi",
  "trafficWeight": 30,
  "stickySession": true,
  "cookieName": "darlane-ab",
  "sameSite": "lax",
  "secure": true,
  "headerRoutingEnabled": true,
  "headerRoutingHeader": "X-Target-Env",
  "headerRoutingValue": "darlane",
  "containerPort": 8080,
  "telemetryPort": 4318
}
```

All fields except `env` are optional.

**Responses:**

| Status | Meaning |
|---|---|
| `200` `{"committed": true}` | Dev env: patch committed directly to `main` in gitops-infra |
| `200` `{"committed": false, "prTitle": "...", "prNumber": N}` | Staging/prod: PR opened in gitops-infra for platform-team review |
| `400` | Invalid request (wrong kind, unknown env) |
| `401` | Not authenticated |
| `403` | Not a team member (dev) or not a manager/platform-team (staging/prod) |
| `409` | Overlay does not exist — create it via the Promotion panel first |
| `422` | Entity has no valid `gitea/source-location` annotation |

**Permission model:**

| Environment | Who can enable |
|---|---|
| `dev` | Any member of the owning team (`{org}:{teamName}`) |
| `staging` | `{org}:Managers` sub-group or `platform-team` |
| `production` | `{org}:Managers` sub-group or `platform-team` |

---

## Portal UI: Promotion Panel

Darlane is surfaced inside the **Promotion panel** on each Component detail page.
It does not appear in the scaffold wizard or the edit-config form.

The per-environment row shows one of three states:

| State | UI element |
|---|---|
| Overlay exists, Darlane not configured, user has permission | Green "Darlane" button — opens the wizard |
| Darlane enabled | Green "Darlane ●" badge + pencil (reconfigure) + chevron (expand debug commands) |
| Darlane expanded | Inline kubectl + mirrord copy-paste commands for that environment |

**Darlane wizard — Step 1 (Configure):**

- Replicas (default 0)
- Start command + preset buttons (uvicorn, flask, air, node, etc. — all default to port 8080)
- File sync toggle + mount path + `initFromImage` (boolean checkbox — "Seed volume from pod image"; platform manages the image reference)
- TTL select (1h / 2h / 4h / 8h / 12h / 24h, default 4h)
- Feature flags / env overrides — key/value rows injected only into the Darlane pod
- Traffic routing / A/B (ingress-enabled apps only):
  - Traffic weight 0–100 %
  - Sticky session (when weight > 0) — cookie name, SameSite, Secure
  - Header routing — header name + value; live `curl` preview; works with `trafficWeight: 0`
- Collapsible Advanced section — container port + telemetry port
- Production safety gate (production env only) — `productionOverride` confirmation checkbox

**Darlane wizard — Step 2 (Review):**

- Diff-aware summary (+ added / ~ changed / − removed badges per field when reconfiguring)
- Diff-aware YAML preview of the exact `kustomization.yaml` patch that will be written
- Submit: "Enable Darlane" / "Apply changes" (dev → direct commit) or "Open Darlane PR" / "Open update PR" (staging/prod)

---

## Mirrord vs `wxops darlane sync` — Choosing the Right Inner-Loop Tool

Both approaches connect a developer's local machine to a running pod, but they address
different workflows. The Darlane parallel pod supports both, and they are **not
redundant**.

### Where the code runs

| | Mirrord | `wxops darlane sync` |
|---|---|---|
| **Code executes** | On your **local machine** | Inside the **cluster pod** |
| **What it provides** | Pod's network, env vars, service mesh, and mounted secrets — tunnelled to your local process | Real-time file sync from your local filesystem into the pod's writable volume |
| **Pod replica required?** | Yes — as an impersonation target, but `replicas: 0` is fine if you scale up before running | Yes — pod must be running (`replicas: 1`) with `fileSync.enabled: true` |
| **Hot reload** | Your local toolchain (`uvicorn --reload`, `air`, `nodemon`) | The framework inside the pod handles it (e.g. `uvicorn --reload` running as `command`) |
| **Typical use case** | Step-debug a real production request locally with the full cluster context | Workload has hard sidecar or OS dependencies that can't be reproduced locally |

### Mirrord workflow

The pod is used only as an identity and network template. Your code runs locally
but receives the pod's environment — service discovery resolves correctly, Vault
secrets are present, Envoy sidecar headers arrive.

```bash
# Run your local process as if it were the pod (pod must already be running — set
# replicas ≥ 1 via the portal Darlane wizard before running this)
mirrord exec \
  --target deployment/payment-api-darlane \
  --target-namespace tenant-wxops \
  -- uvicorn main:app --reload
```

Darlane config needed:

```yaml
darlane:
  enabled: true
  replicas: 0   # scaled up manually before mirrord exec, or set to 1 if always-on
  ttl: 4h
  # fileSync is NOT required for Mirrord
```

### `wxops darlane sync` workflow

The pod runs the code. `darlane sync` watches your local directory and streams
changes into the pod's writable volume; the framework's hot-reload picks them up.

```bash
wxops darlane sync payment-api --local ./src --remote /app
```

Darlane config needed:

```yaml
darlane:
  enabled: true
  replicas: 1           # pod must be running
  ttl: 4h
  command:              # framework must support hot reload
  - uvicorn
  - main:app
  - --reload
  - --host
  - "0.0.0.0"
  fileSync:
    enabled: true
    mountPath: /app     # composition mounts a writable emptyDir here
```

### Which to use

| Situation | Tool |
|---|---|
| Debugging a specific live request with a debugger attached | Mirrord |
| Workload needs sidecars (Vault agent, Envoy, custom CNI) to function | Mirrord |
| Reproducing a bug that only manifests in the cluster environment | Mirrord |
| Framework requires running inside the cluster OS/arch (GPU, native libs) | `wxops darlane sync` |
| Team shares a dev cluster and you don't want to disrupt their traffic | `wxops darlane sync` (no traffic interception) |
| Testing file-watching behaviour of the app itself | `wxops darlane sync` |

Both approaches can be combined: `darlane sync` for continuous file sync + Mirrord
for intercepting a specific request when the bug is tricky. They target the same
debug pod.

---

## `trafficWeight` Is a Dev Tool, Not a Production A/B Mechanism

This distinction is important for anyone reading the XR schema.

The `trafficWeight` field in `spec.parameters.darlane` controls how much
**development cluster traffic** Mirrord mirrors or steals to the debug pod.
It is a **developer debug aid** — not the same as production A/B testing.

| Mechanism | Where it lives | What controls it | Audience |
|---|---|---|---|
| `darlane.trafficWeight` | Darlane overlay patch | Mirrord — routes a slice of dev cluster traffic to the local/debug process | Individual developer during a debug session |
| A/B testing in production | Argo Rollouts `canary.weight` in the overlay | ArgoCD + Argo Rollouts — shifts real user traffic between stable and canary Deployments | Platform team via a PR |
| Feature flags | `FlagConfiguration` CRD + Flagd sidecar | OpenFeature SDK in the app — reads flag state at runtime | Product team via config |

`trafficWeight: 0` (the default) means the debug pod receives no traffic — pure
debug-only. `trafficWeight: 100` in a dev environment means Mirrord steals all
dev traffic to the debug process; **use with caution in shared dev clusters** as
it will disrupt other developers targeting the same service.

The composition MUST scope `trafficWeight` enforcement to `dev` only unless
`productionOverride: true` is explicitly set.

---

## `wxops darlane sync` — Live File Sync

`wxops darlane sync` watches a local directory with `fsnotify`, batches changes
under a debounce window, and streams them into the Darlane pod using
`kubectl exec … tar xf -`. No daemon required.

```bash
wxops darlane sync <service>
wxops darlane sync <service> --local ./src --remote /app/src
wxops darlane sync <service> --exclude '*.log' --exclude 'tmp/' --no-initial-sync
```

### Flags

| Flag | Default | Description |
|---|---|---|
| `--local` | `.` | Local directory to watch |
| `--remote` | `/app` | Target path inside the container |
| `--env`, `-e` | `dev` | Target environment: `dev`, `staging`, `production` |
| `--namespace`, `-n` | _(derived)_ | Override the K8s namespace (default: `tenant-{org}`) |
| `--deployment` | _(derived)_ | Override the deployment name (default: `{app}-darlane`) |
| `--debounce` | `100` | Debounce window in milliseconds — waits this long after the last event before syncing |
| `--exclude` | — | Glob pattern to skip (repeatable). Combined with built-in excludes. |
| `--no-initial-sync` | `false` | Skip the initial full sync on startup |

### Built-in excludes

`.git`, `node_modules`, `__pycache__`, `.next`, `vendor` are always excluded
regardless of `--exclude` flags.

### Startup behavior

On launch the tool prints:
```
watching  ./src  →  tenant-wxops/payment-api-darlane:/app
→  initial sync: 42 file(s)
```

The initial full sync (`collectAllFiles` walk) ensures the pod volume is aligned
with local state before incremental events start. Pass `--no-initial-sync` to skip
this when the pod already has the correct content (e.g. seeded from image with
`fileSync.initFromImage: true`).

### Delete propagation

Files and directories deleted locally are removed from the pod on the next flush:

```
✗  deleted 1 file(s): handlers/old_handler.go
↑  synced  2 file(s): handlers/handler.go, handlers/util.go
```

Deletes are applied before syncs within each flush batch so that a
delete-then-recreate arrives in the correct order in the pod.
Under the hood a single `kubectl exec rm -rf` is issued per batch —
each path is a separate argv element, not a shell argument, so there is no
injection risk.

### Debounce and max-flush cap

Events are debounced for `--debounce` ms after the last event. If a continuous
burst (e.g. a `go build` emitting hundreds of files) keeps resetting the timer,
a flush is forced at the 2-second mark regardless. This prevents a long burst
from blocking all syncs indefinitely.

### kubectl retry

On each sync or delete the tool retries up to 3 times with a 2-second delay
between attempts. Pods restart during active development; this makes the sync
survive a pod restart without losing a batch:

```
⚠  pod not ready, retrying (1/3)…
↑  synced  3 file(s): main.go, handler.go, util.go
```

### Graceful shutdown

`Ctrl-C` (or `SIGTERM`) flushes any pending changes before exiting:

```
^C
↑  synced  1 file(s): main.go
stopped.
```

---

## Inline Debug Commands

> **Use the portal to enable, reconfigure, and disable Darlane — not `kubectl`.**
>
> - **Dev:** ArgoCD continuously syncs the dev overlay. Any manual `kubectl scale`
>   or `kubectl apply` will be reverted on the next sync cycle. The only durable
>   way to change replica count or config is through the portal, which commits the
>   patch to gitops-infra and lets ArgoCD apply it.
> - **Staging / production:** You likely do not have direct `kubectl` access to spoke
>   clusters — and you should not need it. Enabling or changing Darlane on these
>   environments opens a PR for platform-team review. Using `kubectl` to bypass
>   that gate defeats the purpose and can leave clusters in an inconsistent state.
>
> The commands below are **read-only or out-of-band** operations that the portal
> cannot do for you (exec, port-forward, traffic mirroring). They are safe to run
> because they do not mutate the gitops state.

When Darlane is enabled and expanded in the Promotion panel, the portal shows
copy-paste commands derived from the entity metadata. Namespace is derived from
the owner group: `{org}:teamName` → `tenant-{org}`.

```bash
# Exec into the running Darlane pod (read-only from gitops perspective)
kubectl -n tenant-{org} exec -it deployment/{appName}-darlane -- bash

# Port-forward (bypasses ingress — always hits the Darlane pod directly)
kubectl -n tenant-{org} port-forward deployment/{appName}-darlane 8080:8080

# Header routing — target Darlane through the real ingress, no port-forward needed
# Works even with trafficWeight: 0 — real users are unaffected
curl -H "X-Target-Env: darlane" https://{appName}.example.com/

# Traffic mirror (mirrord) — run your local process with the pod's cluster identity
mirrord exec \
  --target deployment/{appName}-darlane \
  --target-namespace tenant-{org} \
  -- <your-start-command>
```

**What to use the portal for instead:**

| Action | Portal path |
|---|---|
| Enable Darlane (set replicas, command, file sync, flags) | Promotion panel → Enable Darlane wizard |
| Change replicas, TTL, traffic weight, header routing | Promotion panel → Reconfigure |
| Disable Darlane (dev: direct commit, staging/prod: PR) | Promotion panel → Turn off / Open disable PR |

---

## Not In Scope

| Feature | Status |
|---|---|
| `image` override in the wizard UI | Schema field exists; not exposed in the wizard |
| TTL enforcement | Composition team defines the mechanism; portal writes the hint |
| Darlane status from cluster (pod phase, ready) | Cluster is read-only from the portal; status from overlay only |
| Mirrord steal-mode traffic routing | Use `mirrord exec` directly; portal only generates the kubectl commands |
| `wxops darlane enable` write command | Enable Darlane via the portal UI; CLI is read-only for Darlane config |
