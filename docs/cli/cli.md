# `wxops` CLI

> **Status:** Shipped (v0.4.0+). `wxops update` self-update command added in v0.4.3.
> Source: `cli/` — standalone Go module (`github.com/wxops/wxops-cli`).
> Released as cross-platform binaries attached to each Gitea tag release.

---

## Overview

`wxops` is a thin terminal client for the WxOps Internal Developer Portal.
It talks to the same REST API as the portal UI and shares the same authentication
model (Pinniped OIDC via the portal's session).

Use cases:

- Browse the service catalog from the terminal or a CI job
- Get the correct `kubectl` / `mirrord` commands for any service without opening a browser
- Script catalog queries in shell pipelines
- Keep the CLI itself up to date with `wxops update` — no Gitea access required

The CLI never writes to Kubernetes directly — it only reads from the portal API.
Write operations (create overlay, enable Darlane) remain UI-only.
The only local mutation is `wxops update`, which replaces the CLI binary in place.

---

## Installation

### From the portal (recommended)

The portal serves authenticated CLI downloads at `/api/v1/cli/download/:platform`.
You must be logged in — the request uses your active portal session.

```bash
# Linux amd64
curl -L https://<portal-host>/api/v1/cli/download/linux-amd64 \
  -b ~/.wxops/cookies.txt \
  -o /usr/local/bin/wxops && chmod +x /usr/local/bin/wxops

# macOS arm64 (Apple Silicon)
curl -L https://<portal-host>/api/v1/cli/download/darwin-arm64 \
  -b ~/.wxops/cookies.txt \
  -o /usr/local/bin/wxops && chmod +x /usr/local/bin/wxops
```

Or download directly from the **Overview** page in the portal — the CLI card in
the right panel has one-click download buttons for all four platforms, served
through the same authenticated proxy.

Available platforms: `linux-amd64`, `linux-arm64`, `darwin-amd64`, `darwin-arm64`.

The portal always serves the latest release; the download proxy calls the Gitea
releases API internally using the service-account token (`GITEA_TOKEN`), so
users never need direct Gitea access.

### Build from source (local development)

```bash
# From the repo root
make cli-build      # → cli/bin/wxops
make cli-install    # → GOPATH/bin/wxops (adds to PATH if GOPATH/bin is in PATH)

# Or from inside cli/
cd cli
make build
make install
```

Version is stamped from the nearest git tag:

```bash
wxops version
# wxops version v0.4.0
```

---

## Authentication

```bash
wxops login --portal https://portal.wxops.cloud
```

Opens the system browser to the portal OIDC login page. After authentication,
the session token is saved to `~/.wxops/credentials.json`:

```json
{
  "portal_url": "https://portal.wxops.cloud",
  "token": "<wxops_session_value>"
}
```

The token is the same `wxops_session` cookie the browser uses — it expires when
the portal session expires. Run `wxops login` again to refresh.

**CI/CD environments** — skip the browser flow by setting env vars:

```bash
export WXOPS_PORTAL_URL=https://portal.wxops.cloud
export WXOPS_TOKEN=<token>
wxops catalog list
```

`WXOPS_TOKEN` always takes precedence over the credentials file.

---

## Commands

### `wxops catalog list`

List all catalog entities in a tabwriter table.

```
wxops catalog list [--kind <kind>] [--lifecycle <lifecycle>]
```

| Flag | Description |
|---|---|
| `--kind` | Filter by entity kind: `Component`, `API`, `Resource`, `Group`, `User` |
| `--lifecycle` | Filter by lifecycle: `experimental`, `development`, `staging`, `production` |

**Example:**

```
$ wxops catalog list --kind Component --lifecycle production

KIND        NAME            LIFECYCLE    OWNER               DESCRIPTION
----        ----            ---------    -----               -----------
Component   payment-api     production   wxops:rocket-team   Payment processing service
Component   auth-service    production   wxops:platform-team Identity and token management
```

### `wxops catalog get <kind> <name>`

Print full details for a single entity.

```
wxops catalog get Component payment-api
```

Output:

```
Kind:        Component
Name:        payment-api
Title:       Payment API
Lifecycle:   production
Owner:       wxops:rocket-team
Type:        service
Description: Payment processing service
Source:      wxops/payment-api
```

### `wxops debug <service-name>`

Resolve a Component entity and print ready-to-run debug commands for that service.
Calls `promostatus` to show per-environment Darlane state, then prints
`kubectl` and `mirrord` commands.

```
wxops debug <service-name> [--env <env>]
```

| Flag | Default | Description |
|---|---|---|
| `--env`, `-e` | `dev` | Target environment: `dev`, `staging`, `production` |

**Example:**

```
$ wxops debug payment-api

Darlane debug  payment-api
Namespace       tenant-wxops
Deployment      payment-api-dev
Lifecycle       production

Darlane status
  dev          ✓  enabled
  staging      ·  overlay exists — Darlane not enabled
  production   —  no overlay

Commands (dev)

  # Exec (bash)
  kubectl -n tenant-wxops exec -it deployment/payment-api-dev -- bash

  # Port-forward
  kubectl -n tenant-wxops port-forward deployment/payment-api-dev 8080:8080

  # Traffic mirror (mirrord)
  mirrord exec \
    --target deployment/payment-api-dev \
    --target-namespace tenant-wxops \
    -- <your-start-command>

  # File sync — watch local files and stream changes into the pod
  wxops darlane sync payment-api
  # Customise paths:
  wxops darlane sync payment-api --local ./src --remote /app/src
```

Namespace is derived from the entity owner without a cluster API call:
`org:teamName` → `tenant-{org}`. The port defaults to `8080` unless
`wxops.cloud/container-port` is set on the entity.

### `wxops darlane sync <service>`

Watch a local directory and stream changes into the Darlane pod on every save.
Uses `fsnotify` + `kubectl exec tar xf -` — no daemon required.

```
wxops darlane sync <service> [flags]
```

| Flag | Default | Description |
|---|---|---|
| `--local` | `.` | Local directory to watch |
| `--remote` | `/app` | Target path inside the container |
| `--env`, `-e` | `dev` | Target environment |
| `--namespace`, `-n` | _(derived)_ | Override the K8s namespace |
| `--deployment` | _(derived)_ | Override the deployment name |
| `--debounce` | `100` | Milliseconds to wait after the last event before syncing |
| `--exclude` | — | Glob pattern to skip (repeatable) |
| `--no-initial-sync` | `false` | Skip the full sync that runs on startup |
| `--tail-logs` | `false` | Stream pod logs alongside sync events in the same terminal |

**Example session:**

```
$ wxops darlane sync python-demo --local ./app

 Darlane Sync

  component    python-demo
  env          dev
  namespace    tenant-rocket-team
  deployment   python-demo-darlane
  sync         /home/user/project/app/  →  /app/

  Pre-flight checks

  ✓  catalog entity found
  ✓  overlay exists
  ✓  darlane enabled
  ✓  file sync mount path  (/app/)
  ✓  language match  (python)
  ✓  tar available

→  initial sync: 12 file(s)
   tip: if the pod doesn't hot-reload, restart it:
        kubectl rollout restart -n tenant-rocket-team deployment/python-demo-darlane

↑  synced  1 file(s): app/main.py
↑  synced  2 file(s): app/handler.py, app/util.py
✗  deleted 1 file(s): app/legacy.py
⚠  pod not ready, retrying (1/3)…
↑  synced  1 file(s): app/main.py
^C
stopped.
```

**Behavior notes:**

- **Startup summary:** before the watcher starts, a colored summary prints the resolved namespace, deployment, and sync path. Pre-flight checks run against the catalog and the live pod — see table below.
- **Initial sync:** on startup, all non-excluded files under `--local` are synced to the pod so the volume is aligned with local state before incremental events begin. Pass `--no-initial-sync` to skip when the pod is already seeded.
- **Delete propagation:** locally deleted files and directories are removed from the pod on the next flush via `kubectl exec rm -rf`. Delete before recreate within the same batch is handled in the correct order.
- **Max-debounce cap:** if a burst of events (e.g. a `go build`) keeps resetting the debounce timer, a flush is forced at the 2-second mark to prevent starvation.
- **Retry:** kubectl calls are retried up to 3 times with a 2-second delay on failure — the sync survives a pod restart mid-session.
- **Pod-replaced re-seed:** if a retry succeeds after at least one failure (pod was replaced), the session automatically re-seeds all local files to the new pod and prints `⟳  pod replaced — re-seeding: N file(s)`. This fires regardless of `--no-initial-sync` — that flag controls startup only, not mid-session recovery.
- **Graceful shutdown:** `Ctrl-C` flushes any pending batch before exiting.

**Pre-flight checks:**

| Check | Behavior on fail |
|-------|-----------------|
| Catalog entity found | Soft warn — watcher still starts (useful for testing empty projects) |
| Overlay exists in gitops-infra | Soft warn |
| `darlaneEnabled: true` in overlay | Soft warn |
| `--remote` matches `fileSync.mountPath` | Soft warn + hint showing the correct path |
| Local project language matches catalog tags | Soft warn |
| `tar` available in the container image | **Hard fail** — watcher does not start; prints a copy-paste `kubectl debug -it <pod-name> --image=busybox --target=<container>` command |

Built-in excludes (always skipped): `.git`, `node_modules`, `__pycache__`, `.next`, `vendor`.

See [docs/darlane.md](../darlane/darlane.md#wxops-darlane-sync--live-file-sync) for the full reference.

### `wxops darlane push <service>`

One-shot sync — runs the same pre-flight checks and startup summary as `darlane sync`,
syncs all non-excluded files once, then exits. Useful in CI pipelines or as a pre-run
step before launching a local dev server.

```
wxops darlane push <service> [flags]
```

Accepts the same flags as `darlane sync` (`--local`, `--remote`, `--env`,
`--namespace`, `--deployment`, `--exclude`). On success, prints the rollout restart
tip when `darlaneEnabled: true`.

### `wxops darlane logs <service>`

Tail logs from the Darlane deployment. Wraps `kubectl logs -f` with namespace and
deployment name derived from the entity's owner group.

```
wxops darlane logs <service> [flags]
```

| Flag | Default | Description |
|---|---|---|
| `--follow`, `-f` | `true` | Stream logs continuously |
| `--tail` | `100` | Number of recent lines shown on start |
| `--env`, `-e` | `dev` | Target environment |

**Example:**

```
$ wxops darlane logs python-demo --tail 200

 * Serving Flask app 'main'
 * Running on http://0.0.0.0:5000
```

### `wxops darlane restart <service>`

Trigger a rolling restart of the Darlane deployment, wait for rollout to
complete, then automatically re-seed all local files into the new pod using the
paths from the last `darlane sync` or `darlane push` session.

```
wxops darlane restart <service> [flags]
```

| Flag | Default | Description |
|---|---|---|
| `--env`, `-e` | `dev` | Target environment |
| `--local` | _(from last session)_ | Override local directory |
| `--remote` | _(from last session)_ | Override remote path |
| `--exclude` | _(from last session)_ | Override exclude patterns |

`--local`, `--remote`, and `--exclude` are read from the session file written by
`darlane sync` / `darlane push` (`~/.wxops/darlane-<service>-<env>.json`). Pass
the flags explicitly only if you need to override them.

**Example — no flags needed after a sync session:**

```
$ wxops darlane restart python-demo

↻  restarting tenant-rocket-team/python-demo-darlane…
deployment "python-demo-darlane" successfully rolled out
⟳  re-seeding: 42 file(s)…
✓  done
```

> Prefer `wxops darlane restart` over raw `kubectl rollout restart` when a
> `darlane sync` session is active. The CLI re-seeds the new pod automatically
> so the session stays in sync. Raw `kubectl rollout restart` resets the pod
> to image state with no re-seed.

### `wxops darlane status <service>`

Show per-environment Darlane status pulled from the live promostatus API — overlay
presence, darlane flag, file-sync mount path, and current image tag with date.

```
wxops darlane status <service>
```

**Example:**

```
$ wxops darlane status python-demo

Darlane status  python-demo

  dev
    overlay       ✓
    darlane       enabled
    mount path    /app/
    image tag     dev-2026-07-09_14-32-01-a1b2c3d

  staging
    overlay       ✓
    darlane       —
    image tag     v0.2.1-rc1  (2026-07-08)

  production
    overlay       —
```

### `wxops darlane exec <service>`

Open an interactive bash shell inside the Darlane pod.

```
wxops darlane exec <service> [--env dev|staging|production]
```

Equivalent to `kubectl exec -it -n <namespace> deployment/<app>-darlane -- bash`.
Namespace and deployment name are derived from the entity's owner group — no
cluster API call required.

> **Note:** some Darlane images (distroless, scratch) have no shell. Use
> `kubectl debug -it <pod-name> -n <namespace> --image=busybox --target=<container>`
> for those — or run `wxops darlane sync` which will detect the missing `tar` and
> print the exact command for you.

### `wxops darlane port-forward <service>`

Forward a local port to the Darlane pod.

```
wxops darlane port-forward <service> [--port local:remote] [--env dev|staging|production]
```

| Flag | Default | Description |
|---|---|---|
| `--port`, `-p` | _(container-port:container-port)_ | Port mapping `local:remote`. Defaults to the value of the `wxops.cloud/container-port` annotation (fallback: `8080:8080`). |

### `wxops version`

```
$ wxops version
wxops version v0.4.0
```

### `wxops update`

Download the latest `wxops` binary from the portal and replace the current
executable in place. Requires an active portal session.

```
wxops update [--yes]
```

| Flag | Description |
|---|---|
| `--yes`, `-y` | Skip the confirmation prompt and update immediately |

**Example:**

```
$ wxops update
Checking latest version...
Current: v0.4.2
Latest:  v0.4.3

Download and replace current binary? [y/N] y
Downloading v0.4.3 for linux-amd64...
Updated to v0.4.3 (/usr/local/bin/wxops).
```

**How it works:**

1. Calls `GET /api/v1/cli/version` to fetch the latest version tag from the portal.
2. Compares against the version stamped at build time via `-ldflags`. If already up to date, exits immediately.
3. Calls `GET /api/v1/cli/download/{os}-{arch}` — the same endpoint used by the one-click download buttons in the portal Overview page.
4. Writes the binary to a temp file in the same directory as the current executable so the rename stays on the same filesystem.
5. Sets the executable bit and atomically renames the temp file over the current binary.

> **Permission:** if the binary lives in a system directory (e.g. `/usr/local/bin`), the
> rename step requires write access — run with `sudo` or reinstall to a user-writable path
> (e.g. `~/.local/bin`).

> **Dev builds:** when `wxops version` reports `dev` (built locally without `-ldflags`),
> the version comparison is skipped and the prompt always appears. This prevents silently
> overwriting a local development build.

### `wxops login`

See [Authentication](#authentication) above.

---

## Local Development

```bash
cd cli

make build           # cli/bin/wxops for current platform
make install         # copies to GOPATH/bin
make run ARGS="catalog list --kind Component"
make lint            # go vet ./...
make tidy            # go mod tidy
make build-all       # cross-compile all 5 targets into cli/dist/
make clean           # removes cli/bin/ and cli/dist/
```

---

## Release Pipeline

The CLI is built and released as part of the portal tag pipeline
(`.gitea/workflows/ci.yml`, `cli` job + `release` job):

1. **On every PR and tag push:** `go build ./...` + `go vet ./...`
2. **On tag push only:** cross-compile for all 5 targets with
   `-ldflags="-X main.version={tag}"` into `cli/dist/`
3. **Release job:** attaches all `cli/dist/wxops-*` binaries to the Gitea release

No separate tag or workflow — the CLI ships in lockstep with the portal image.

---

## Limitations

| Gap | Notes |
|---|---|
| No `wxops darlane enable` write command | Enable Darlane via the portal UI (Promotion panel). CLI is read-only for Darlane config. |
| No shell completion auto-install | Run `wxops completion bash/zsh/fish` and source the output manually. |
| Token does not auto-refresh | Re-run `wxops login` when the session expires. |
| `wxops debug` only prints dev commands by default | Use `--env staging` or `--env production` for other environments. |
| `wxops darlane sync` requires `kubectl` in PATH | The sync command shells out to `kubectl`; the current kube context must have access to the target namespace. |
| `wxops update` requires write access to the install directory | If the binary is in a system path (e.g. `/usr/local/bin`), run with `sudo` or use a user-writable directory. |
