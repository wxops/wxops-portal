# wxops-portal

A Helm chart for deploying the [W'xOps Portal](https://github.com/wxops/wxops-portal) — an Internal Developer Portal for Kubernetes-native platform teams.

Built on top of the [`common`](https://kubewekend.xeusnguyen.xyz/) library chart — this chart is a values-only wrapper, not a bundle of hand-rolled templates. [`examples/`](examples/) has extras that aren't installed by the chart itself.

## Install

```bash
helm install wxops-portal oci://ghcr.io/wxops/charts/wxops-portal --version 0.5.0 \
  --namespace wxops-system --create-namespace \
  -f my-values.yaml
```

There's no `helm repo add` step — this is an OCI-based chart, published alongside the container image to the same `ghcr.io/wxops` registry.

## Before you install

The portal needs an OIDC issuer (a Pinniped Supervisor, in the platform's usual setup) to authenticate against — it has no login of its own. At minimum, `my-values.yaml` needs:

```yaml
portal:
  env:
    FRONTEND_URL: "https://portal.yourcompany.com"
    OIDC_ISSUER_URL: "https://your-pinniped-supervisor.example.com"
    OIDC_CLIENT_ID: "client.oauth.pinniped.dev-wxops-portal"
    OIDC_REDIRECT_URI: "https://portal.yourcompany.com/auth/callback"

  secretValues:
    oidcClientSecret: "..."
    sessionSecret: "..." # openssl rand -hex 32
```

See [`values.yaml`](values.yaml) for every chart field, and
[`docs/getting-started/deployment.md`](../docs/getting-started/deployment.md)
for standing up the OIDCClient on the Supervisor side.

### Every environment variable, and where it goes in `values.yaml`

[`docs/getting-started/environment-variables.md`](../docs/getting-started/environment-variables.md)
is the canonical reference — every variable the backend reads, its default,
whether it's required, and why. This chart doesn't reinvent that list: `portal.env`
is a direct passthrough, so any variable name from that doc becomes a container
env var with that exact name the moment you add it under `portal.env` (non-secret)
or wire it through one of the three secret paths above (secret).

You won't need most of the doc for a first install. What you actually need
depends on which features you turn on:

| Doc section | What it unlocks | Needed for a first install? |
|---|---|---|
| [Core](../docs/getting-started/environment-variables.md#core) | `FRONTEND_URL`, `SESSION_SECRET` | **Yes** — always |
| [OIDC / Pinniped Supervisor](../docs/getting-started/environment-variables.md#oidc--pinniped-supervisor) | Login | **Yes** — always |
| [Cluster Registry](../docs/getting-started/environment-variables.md#cluster-registry) | Cluster views, kubeconfig download | **Yes** — `CLUSTERS_CONFIG_FILE` is set by default; see [Cluster registration](#cluster-registration) below |
| [Service Catalog](../docs/getting-started/environment-variables.md#service-catalog) | Browsing catalog entities from Gitea | No — `CATALOG_LOCAL_DIR` (bundled examples) works with nothing set |
| [Scaffolding](../docs/getting-started/environment-variables.md#scaffolding) | Golden-path project creation | No — needs a Gitea instance + template repo |
| [Vault](../docs/getting-started/environment-variables.md#vault-scaffold-secret-write) | Scaffold writing an initial secret mount | No — silently skipped when `VAULT_ADDR` is unset |
| [Runtime Observability](../docs/getting-started/environment-variables.md#runtime-observability) | ArgoCD/XR status, Grafana deep links, alerts | No — every panel hides itself when its URL is unset |
| [CLI Download Proxy](../docs/getting-started/environment-variables.md#cli-download-proxy) | `wxops` binary downloads through the portal | No — reuses `GITEA_TOKEN` from Service Catalog |
| [Catalog Cache Refresh Webhook](../docs/getting-started/environment-variables.md#catalog-cache-refresh-webhook) | Instant catalog refresh on Gitea push | No — the 5-minute TTL just expires normally without it |

Non-secret values from any row go under `portal.env`; the doc's
[Secret management in production](../docs/getting-started/environment-variables.md#secret-management-in-production)
section is the same `envFrom: secretRef` pattern as the three options above.

### Three ways to supply the two secret values

`OIDC_CLIENT_SECRET` and `SESSION_SECRET` are the only values that need to
stay out of `values.yaml` in plain text. Pick whichever fits your stack:

| | When to use it | Setup |
|---|---|---|
| `extraManifests` + `secretValues` | You don't run anything else for secret management yet | Nothing beyond this chart — the `secretValues` snippet above |
| Bring your own Secret | You already `kubectl create secret` or manage one some other way | `kubectl create secret generic wxops-portal-secrets --from-literal=...`, then set `portal.envFrom: [{secretRef: {name: wxops-portal-secrets}}]` |
| [ExternalSecret](examples/external-secret.yaml) | You already run External Secrets Operator (Vault, etc.) | Copy the example, point it at your existing `SecretStore`/`ClusterSecretStore`, then reference the same Secret name via `portal.envFrom` |

All three end up in the same place — a plain Kubernetes Secret referenced via
`portal.envFrom` — so switching between them later is just repointing that
one field, not a structural change.

## What's on by default, and what isn't

| | Default | Why |
|---|---|---|
| Ingress | off | Don't assume you have a controller or DNS ready. Enable + set `portal.ingress.hosts` when you do. |
| RBAC (Secret read, for cluster discovery) | off | `CLUSTERS_CONFIG_FILE` (a static file) is the simpler path for a first install. Only needed once you switch to Kubernetes Secret-based cluster discovery — see [Cluster Registry](../docs/getting-started/environment-variables.md#cluster-registry). |
| Image pull secret | none | The published image is public. |
| Resource requests/limits | set | `50m`/`256Mi` request, `512Mi` limit — matches the platform's own production values. |

## Cluster registration

The portal discovers spoke clusters one of three ways — see [Cluster Registry](../docs/getting-started/environment-variables.md#cluster-registry) for the full comparison. The default in this chart's `values.yaml`, `CLUSTERS_CONFIG_FILE`, expects a mounted file — mount it via a ConfigMap and `portal.volumes`/`portal.volumeMounts` (fields the underlying `common` chart supports directly). Switch to `CLUSTERS_CONFIG` (inline JSON, set via `portal.env`) if you'd rather avoid a mounted file, or to Kubernetes Secret discovery (flip `portal.rbac.create: true`) once you're managing more than a couple of clusters.

## Keeping ArgoCD Image Updater in sync (optional)

If you deploy this chart via ArgoCD and want automatic image bumps instead of
manually bumping `portal.image.tag` on every release, see
[`examples/argocd-image-updater.yaml`](examples/argocd-image-updater.yaml).
It's a reference, not something this chart installs — copy it into your own
GitOps repo and adjust the `applicationRefs` / `writeBackConfig` to match your
setup.

## Values

The full reference lives in [`values.yaml`](values.yaml), commented inline.
Everything nests under a top-level `portal:` key — that's the alias this
chart gives the `common` dependency in [`Chart.yaml`](Chart.yaml).
