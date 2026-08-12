# Runtime Observability

> **What this is:** how the portal shows whether a service is actually running,
> and how it hands you off to the signal that explains why it is not.
> **Companion:** [cluster-registry.md](cluster-registry.md) (how clusters are discovered),
> [../security/security-assurance.md](../security/security-assurance.md) (why this adds no egress).

The portal already knows what *should* be deployed — the overlay exists in
`gitops-infra`, and the image tag is written back by ArgoCD Image Updater. The
Runtime tab answers the other half: **is it live, and is it healthy right now?**

Two sources, one view:

| Source | Answers |
|---|---|
| ArgoCD `Application` | Did CD deliver? — sync state, health, the revision that landed |
| Crossplane `XTenantApp` | Did the platform provision it? — created, ready, URL, image |

Plus one-click links into Grafana for logs, traces, CPU, memory and profiles —
each scoped to the exact service *and environment* you are looking at.

---

## The endpoint

```
GET /api/v1/catalog/entities/:kind/:name/environments
```

Returns one entry per environment per registered cluster:

```json
{
  "grafanaUrl": "https://grafana.example.com",
  "argocdUrl": "https://argocd.example.com",
  "environments": [
    {
      "env": "dev",
      "clusterId": "hub", "clusterName": "Hub Cluster",
      "argo": { "available": true, "sync": "Synced", "health": "Healthy",
                "revision": "a1b2c3d", "phase": "Succeeded" },
      "xr":   { "available": true, "ready": true, "created": true,
                "url": "https://demo.example.com", "image": "…:dev-2026-08-11_09-14-02-a1b2c3d" },
      "links": { "logs": "…", "traces": "…", "cpu": "…", "memory": "…", "profiles": "…", "argocd": "…" }
    }
  ]
}
```

Responses are cached for **30 seconds, keyed by user**. The key includes the
session subject because the payload is assembled from reads made with one user's
RBAC — a shared key would serve one tenant's view to another.

---

## Naming — how an entity maps to cluster objects

All derived from the entity's `gitea/source-location` annotation (`{team}/{app}`),
never from `metadata.name`:

| Object | Name | Where |
|---|---|---|
| ArgoCD `Application` | `{team}-{app}-{env}` | namespace `argocd` |
| `XTenantApp` (dev) | `{team}-{app}` | cluster-scoped |
| `XTenantApp` (staging/production) | `{team}-{app}-{env}` | cluster-scoped |
| Workload namespace | `tenant-{team}` (or `platform`) | — |

`env` is `dev`, `staging`, `production` — **`production`, not `prod`**. The
staging and production overlays patch in an XR rename so each environment gets a
distinct cluster-scoped object; dev uses the base name unchanged.

`XTenantApp` readiness comes from `.status.ready` / `.status.created`, which the
composition writes itself — **not** from Crossplane's `Ready` condition, which
lags behind reality due to watch circuit throttling.

---

## RBAC prerequisite

Reads happen **as the logged-in user**, with their Kubernetes RBAC. Two bindings
per tenant are required, both shipped in `wxops-gitops-infrastructure`:

| Binding | Why |
|---|---|
| `ClusterRoleBinding` → `tenant-platform-reader` | `XTenantApp` is cluster-scoped (Crossplane v2 `scope: Cluster`); a namespaced RoleBinding cannot reach it |
| `RoleBinding` in ns `argocd` → `aggregate-argoproj-view` | `Application` CRs live in ArgoCD's namespace, not the tenant's |

`tenant-platform-reader` grants **`get` only**. The portal reads composites by
exact name, so `list` would add no capability while letting a tenant enumerate
other teams' composites — and cluster-scoped resources cannot be partitioned by
namespace in RBAC.

**Until these are applied the panel degrades, it does not break.** Each cell
shows "Cluster RBAC not applied" and the rest of the page is unaffected. The
portal never falls back to a privileged credential of its own.

---

## Configuration

All runtime env vars on the Go backend — **not** `NEXT_PUBLIC_*` build args, so
changing a dashboard URL is a Deployment edit, not a CI rebuild:

| Variable | Default | Purpose |
|---|---|---|
| `ARGOCD_URL` | _(empty)_ | ArgoCD base URL. Empty hides the ArgoCD button. |
| `ARGOCD_NAMESPACE` | `argocd` | Namespace holding `Application` CRs |
| `LGTM_GRAFANA_URL` | _(empty)_ | Grafana base URL. Empty hides all signal links. |
| `LGTM_LOKI_DATASOURCE` | `Loki` | Loki datasource name/uid |
| `LGTM_TEMPO_DATASOURCE` | `Tempo` | Tempo datasource name/uid |
| `LGTM_PROMETHEUS_DATASOURCE` | `prometheus` | Prometheus datasource uid (lowercase in kube-prometheus-stack) |
| `LGTM_PYROSCOPE_DATASOURCE` | `Pyroscope` | Pyroscope datasource name/uid |
| `ALERTMANAGER_URL` | _(empty)_ | Enables the active-alerts panel. **The portal's only outbound call to an observability backend** — empty disables it. In-cluster: `http://kube-prometheus-stack-alertmanager.monitoring.svc.cluster.local:9093` |

Every link builder returns an empty string when its base URL is unset, and the
UI hides empty links — the same convention as the existing ArgoCD button.

---

## Selectors — what the deep links actually query

Grafana Explore links are built from the labels the platform really emits. If
you change the collector config, change these too.

All queries are **scoped to a single environment**. Dev, staging and production
share one namespace and one `app` label, so without that scoping every panel
would blend all three together.

The discriminator is the workload name, which the composition makes
environment-specific:

| Environment | Deployment | Pods |
|---|---|---|
| dev | `{app}` | `{app}-…` |
| staging | `{app}-staging` | `{app}-staging-…` |
| production | `{app}-production` | `{app}-production-…` |
| Darlane twin | `{app}-darlane` | `{app}-darlane-…` |

Note that `{app}-` as a prefix matches *everything* in that table — so dev needs
an explicit exclusion, not just a prefix.

**Logs (Loki).** Alloy relabels pod logs to `namespace`, `pod`, `container`,
`app`, `job`, `container_runtime`, `cluster`. The `app` label is identical
across environments, so the `pod` matcher does the scoping:

```logql
# staging
{namespace="tenant-rocket-team", pod=~"python-demo-staging-.+", app="python-demo"}

# dev — must exclude the other environments and the debug twin
{namespace="tenant-rocket-team", pod=~"python-demo-.+", pod!~"python-demo-(staging|production|darlane)-.+", app="python-demo"}
```

**Traces (Tempo).** `k8s.deployment.name` is set by Alloy's `k8sattributes`
processor and is already environment-specific, so this is an exact match:

```traceql
{resource.k8s.namespace.name="tenant-rocket-team" && resource.k8s.deployment.name="python-demo-staging"}
```

`service.name` is deliberately unused — it comes from each application's own
OTEL SDK config, which the platform does not set.

**CPU (Prometheus).** cAdvisor series, per pod:

```promql
sum(rate(container_cpu_usage_seconds_total{namespace="tenant-rocket-team", pod=~"python-demo-staging-.+", container!="", container!="POD"}[5m])) by (pod)
```

**Memory (Prometheus).** Working set, not `container_memory_usage_bytes`:

```promql
sum(container_memory_working_set_bytes{namespace="tenant-rocket-team", pod=~"python-demo-staging-.+", container!="", container!="POD"}) by (pod)
```

`container_memory_working_set_bytes` is the figure the kernel OOM killer
evaluates against the limit. `container_memory_usage_bytes` includes reclaimable
page cache and routinely looks alarming for a workload nowhere near being
killed — the wrong number to show someone debugging an OOMKill. Both queries
drop the pause container (`container!="POD"`) and the pod-level rollup
(`container!=""`), which would otherwise double-count.

An environment the platform does not create (`prod`, `qa`, an empty string)
produces **no link at all** rather than a query that silently matches nothing —
or worse, everything.

Names taken from catalog entities are stripped to DNS-1123 characters before
being interpolated, so a crafted entity name cannot escape the quoted selector
and rewrite the query.

---

## Known limitations

Stated plainly, because a link that silently returns nothing is worse than one
you knew was approximate.

| Limitation | Consequence | Fix |
|---|---|---|
| Alloy hardcodes `cluster = "kubeweekend"` in its log pipeline | Log links cannot be scoped per cluster in a multi-cluster estate | Parameterise the static label in the Alloy config |
| No `ServiceMonitor`/`PodMonitor` exists for tenant workloads, and Prometheus only selects monitors carrying the kube-prometheus-stack release label | Metrics links show container CPU from cAdvisor, not application metrics. P95/P99 latency is impossible — nothing emits a histogram | The metric contract, ServiceMonitor emission, and cardinality policy are designed in [observability-architecture.md](observability-architecture.md#application-metrics--the-missing-layer) |
| `prometheus.io/scrape` annotations do nothing (Prometheus Operator ignores them without an `additionalScrapeConfig`, which does not exist) | Setting them on `podAnnotations` fails silently — the `XTenantApp` example file makes them look supported | Use a `ServiceMonitor` instead; fix the misleading example in `wxops-core` |
| Prometheus `sampleLimit` / `targetLimit` / `labelLimit` are all `0` (unlimited) | One high-cardinality label on one tenant service can degrade monitoring platform-wide | Set `sampleLimit` from the composition when emitting ServiceMonitors |
| No GPU exporter (DCGM) deployed | GPU utilisation metrics do not exist | Deploy the DCGM exporter DaemonSet — platform task, unrelated to app instrumentation |
| Alerts carry no `app` label | The portal narrows to one service by matching the `pod` label against the app's name prefix, not by an app label. A rule that fires without a `pod` label is shown as a namespace-wide alert. | Add `defaultRules.additionalRuleLabels` or tenant `PrometheusRule`s carrying `app` |
| Alertmanager's receiver is `null` | Alerts are visible in the portal and Grafana but are not routed anywhere — no email, Slack, or paging | Configure a real receiver in `alertmanager.config` |
| Only traces are wired through Alloy's OTLP pipeline (logs/metrics exporters are commented out) | OTLP logs and metrics sent to Alloy are dropped | Enable the exporters in the Alloy config |
| Profiling requires the app to push to Pyroscope | Profile links open an empty view for uninstrumented services | Instrument the service |
| Observability endpoints are global, not per-cluster | One Grafana for every registered cluster | Add per-cluster annotations to the cluster registry Secret |

---

## Active alerts

When `ALERTMANAGER_URL` is set, the Runtime tab shows what is currently firing
for the service, above the environment panel — "is this broken right now?"
outranks "what is deployed?".

```
GET /api/v1/catalog/entities/:kind/:name/alerts
→ { "enabled": true, "namespace": "tenant-rocket-team", "alerts": [ … ] }
```

Because no alert rule carries an `app` label, the portal queries Alertmanager
by `namespace` and then narrows to the service by matching the alert's `pod`
label against the `{appName}-` prefix. That prefix covers every environment
(`{app}-`, `{app}-staging-`, `{app}-production-`) and the Darlane twin. Alerts
with **no** `pod` label are namespace-scoped rules — quota exhaustion and
similar — and are shown too, because they affect this service along with
everything else in the namespace.

Read-only and deliberately minimal: one `GET`, no silencing or acknowledgement.
Those belong in Alertmanager's own UI. When `ALERTMANAGER_URL` is unset the
endpoint returns `enabled: false` and the panel is hidden entirely.

---

## Network behaviour — links vs. the one call

For **Grafana, Loki, Tempo and Pyroscope**, the portal builds URLs and never
follows them: every function in `internal/observability/links.go` is pure
string construction. Your browser talks to Grafana using your own Grafana
session.

**Alertmanager is the exception** — it is queried server-side, and it is the
portal's only egress destination outside Gitea, Vault, the OIDC issuer and the
Kubernetes APIs. It is opt-in, read-only, timeout-bounded, and result-capped.

Against the assurance claims:

- **A1 (no cluster writes)** — unchanged; every new call is a `GET`.
- **A4 (bounded egress)** — **changed** when the alerts feature is enabled.
  Operators must add the Alertmanager rule to the egress NetworkPolicy. Leaving
  `ALERTMANAGER_URL` unset keeps the original, narrower claim.
- **A8 (user-scoped RBAC)** — unchanged for ArgoCD/XR reads, which use the
  caller's Pinniped credential. Alertmanager has no Kubernetes RBAC, so that
  read is *not* user-scoped; tenant narrowing is done by the portal and is a
  correctness measure, not a security boundary.

The full disclosure, including the residual exposure and how to opt out, is in
[../security/security-assurance.md](../security/security-assurance.md) §4b.

---

## Reference

- [cluster-registry.md](cluster-registry.md) — how spoke clusters are discovered
- [../security/security-assurance.md](../security/security-assurance.md) — the full claim set
- [../getting-started/environment-variables.md](../getting-started/environment-variables.md) — all configuration
- [../scaffolding/cross-environment-promotion.md](../scaffolding/cross-environment-promotion.md) — the overlay model these environments come from
