# `wxops` CLI

> **Status:** Shipped (v0.4.0).
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

The CLI never writes to Kubernetes directly — it only reads from the portal API.
Any write operations (create overlay, enable Darlane) remain UI-only in v0.4.0.

---

## Installation

### From a release binary

Download the binary for your platform from the Gitea release page and place it
on your `PATH`:

```bash
# Linux amd64
curl -L https://{gitea}/wxops/wxops-portal-v2/releases/download/v0.4.0/wxops-linux-amd64 \
  -o /usr/local/bin/wxops && chmod +x /usr/local/bin/wxops

# macOS arm64 (Apple Silicon)
curl -L https://{gitea}/wxops/wxops-portal-v2/releases/download/v0.4.0/wxops-darwin-arm64 \
  -o /usr/local/bin/wxops && chmod +x /usr/local/bin/wxops
```

Available targets: `linux-amd64`, `linux-arm64`, `darwin-amd64`, `darwin-arm64`.

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

  # Scale up
  kubectl -n tenant-wxops scale deployment/payment-api-dev --replicas=1

  # Exec (bash)
  kubectl -n tenant-wxops exec -it deployment/payment-api-dev -- bash

  # Port-forward
  kubectl -n tenant-wxops port-forward deployment/payment-api-dev 8080:8080

  # Traffic mirror (mirrord)
  mirrord exec \
    --target deployment/payment-api-dev \
    --target-namespace tenant-wxops \
    -- <your-start-command>

  # Scale down
  kubectl -n tenant-wxops scale deployment/payment-api-dev --replicas=0
```

Namespace is derived from the entity owner without a cluster API call:
`org:teamName` → `tenant-{org}`. The port defaults to `8080` unless
`wxops.cloud/container-port` is set on the entity.

### `wxops version`

```
$ wxops version
wxops version v0.4.0
```

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

## Limitations (v0.4.0)

| Gap | Notes |
|---|---|
| No `wxops darlane enable` write command | Enable Darlane via the portal UI (Promotion panel). CLI is read-only in v0.4.0. |
| No shell completion auto-install | Run `wxops completion bash/zsh/fish` and source the output manually. |
| Token does not auto-refresh | Re-run `wxops login` when the session expires. |
| `wxops debug` only prints dev commands by default | Use `--env staging` or `--env production` for other environments. |
