# Observability Architecture — Hub Grafana, Spoke Collectors

> **Status: target architecture, not current state.** Today the platform runs a
> single cluster where hub and spoke are the same machine, so every component
> below is co-located. This document describes where it is going and what has
> to change to get there — it is a design commitment, not a description of what
> is deployed.
>
> **Companion:** [observability.md](observability.md) (what the portal reads and
> links to today), [cluster-registry.md](cluster-registry.md) (how spokes are
> registered).

## The shape

One Grafana. One set of storage backends. A collector on every cluster.

```
┌─ HUB CLUSTER ─────────────────────────────────────────────┐
│                                                            │
│   Grafana ── queries ──► Loki      (logs)                  │
│      ▲                   Tempo     (traces)                │
│      │                   Prometheus(metrics)               │
│      │                   Pyroscope (profiles)              │
│      │                        ▲                            │
│   browser                     │ ingest                     │
│   (Dex SSO)                   │                            │
└───────────────────────────────┼────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
┌─ SPOKE A ────────┐   ┌─ SPOKE B ────────┐   ┌─ SPOKE C ────────┐
│  Alloy (agent)   │   │  Alloy (agent)   │   │  Alloy (agent)   │
│    ├ pod logs    │   │                  │   │                  │
│    ├ K8s events  │   │      …           │   │      …           │
│    ├ OTLP traces │   │                  │   │                  │
│    └ metrics     │   │                  │   │                  │
│  tenant workloads│   │ tenant workloads │   │ tenant workloads │
└──────────────────┘   └──────────────────┘   └──────────────────┘
```

**Why this split.** Storage and query belong together and belong once —
running a Grafana per cluster means a developer has to know which cluster their
service is on before they can look at a log line, which defeats the point of a
portal that already knows. Collection belongs next to the workload, because
that is the only place pod metadata exists to enrich a signal with.

## Responsibilities

| Component | Where | Job |
|---|---|---|
| **Alloy** | every spoke (DaemonSet) | Scrape pod logs, tail Kubernetes events, receive OTLP from apps, enrich with pod/namespace/deployment labels, ship to hub |
| **Loki** | hub | Log storage and LogQL query |
| **Tempo** | hub | Trace storage and TraceQL query |
| **Prometheus** | hub | Metric storage and PromQL query |
| **Pyroscope** | hub | Continuous profile storage |
| **Grafana** | hub | The only query surface. SSO via Dex |
| **Alertmanager** | hub | Alert routing; the portal reads active alerts from it |
| **Portal** | hub | Builds pre-scoped Grafana links from catalog context; reads active alerts |

The portal is not in the signal path. It never proxies a log line or a metric —
it constructs the URL that sends the browser to Grafana, and Grafana serves the
data using the viewer's own Grafana session. The one exception is Alertmanager,
which the portal queries server-side; see
[security-assurance.md](../security/security-assurance.md) claim A4.

## What has to change before this is real

Three things in the current deployment block multi-cluster, and all three live
in `wxops-gitops-infrastructure`, not the portal.

### 1. The `cluster` label is hardcoded

`base/observability-plane/alloy/values.yaml` stamps a static label in three
places:

```river
stage.static_labels {
    values = { cluster = "kubeweekend" }
}
```

With one cluster this is cosmetic. With several it is **load-bearing and
wrong**: every spoke would ship logs labelled `kubeweekend`, making them
indistinguishable in a shared Loki. This must become per-cluster — templated
from a Helm value set per spoke — *before* a second cluster ships signals, not
after.

The same gap exists on metrics: Prometheus runs with `externalLabels: {}`, so
nothing identifies the source cluster there either.

### 2. Ingest endpoints must be reachable from spokes

Today Loki, Tempo, Prometheus and Pyroscope are `ClusterIP` services with no
ingress — reachable only from inside their own cluster. A spoke's Alloy cannot
reach them. Making it work requires a deliberate choice, and this is a security
decision rather than a values edit:

| Option | Trade-off |
|---|---|
| Expose ingest endpoints via ingress + auth | Simple, but puts ingest on the public internet; needs mTLS or token auth, since Loki currently has `auth_enabled: false` |
| Private network path (VPN, peering, service mesh) | No public exposure; more infrastructure to run |
| Push through a gateway on the hub | One endpoint to secure and audit; an extra hop |

**Whichever is chosen must be decided before exposure, not discovered after.**
Loki with `auth_enabled: false` on a public endpoint accepts writes from anyone
who can reach it.

### 3. Tenant isolation does not exist at the storage layer

`auth_enabled: false` means Loki has no tenant concept — every log line from
every namespace lives in one unpartitioned store. Adding clusters multiplies
what a single Grafana query can reach. This is documented as a known limitation
in [security-assurance.md](../security/security-assurance.md); it becomes more
consequential, not less, under hub-spoke.

## Sequencing

The order matters — doing these out of order produces a system that silently
mislabels data:

1. **Parameterise the `cluster` label** (Alloy) and add `externalLabels` to
   Prometheus. Do this while there is still only one cluster, so nothing is
   ambiguous during the transition.
2. **Decide and build the ingest path**, with authentication, before pointing a
   second Alloy at it.
3. **Add per-cluster observability endpoints to the cluster registry** — the
   Secret schema in [cluster-registry.md](cluster-registry.md) has no field for
   them today, and the portal's `LGTM_GRAFANA_URL` is a single global value.
   Only needed if different clusters ever get different Grafanas; with one hub
   Grafana the global setting stays correct.
4. **Revisit Loki multi-tenancy** (`auth_enabled: true` + per-tenant IDs) if
   the isolation gap becomes unacceptable.

Steps 1 and 2 are prerequisites for a second cluster. Steps 3 and 4 are
follow-ups that can happen after.

## Application metrics — the missing layer

Logs, traces and profiles have a collection path. **Application metrics do
not.** No tenant workload is scraped today, which is why the portal's Metrics
deep link falls back to cAdvisor container CPU rather than anything the
application knows about itself.

### The mechanism: ServiceMonitor, not annotations

`prometheus.io/scrape` annotations **do nothing in this cluster.** They are a
convention from Prometheus' older file-based scrape config; the Prometheus
Operator ignores them unless an `additionalScrapeConfig` translates them, and
none exists here. The `XTenantApp` example file shows those annotations
commented out under `podAnnotations`, which makes them look supported — they
are not, and setting them fails silently.

The working mechanism is a `ServiceMonitor` CRD. Two requirements, both of
which fail *silently* when missed:

1. **It must carry `release: kube-prometheus-stack`.** Prometheus runs with
   `serviceMonitorSelectorNilUsesHelmValues: true`, so it only selects monitors
   with the Helm release label. Without it the monitor exists, looks correct,
   and is never scraped.
2. **It selects a Service port by *name*.** The tenant-app composition
   currently emits `ports = [{port = servicePort, targetPort = containerPort}]`
   with no `name`, so the port has to be named (e.g. `http`) before a
   ServiceMonitor can reference it.

### Quantiles are computed at query time, not emitted

This determines who is responsible for what, and it is the most commonly
confused part of the model. An application never "implements P95." It emits a
**histogram**; the percentile is computed by PromQL at query time:

```promql
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))
```

The dependency runs one way and cannot be repaired downstream: **if the
application emits a gauge or a summary instead of a histogram, no query can
recover P95.** You cannot derive a percentile from an average. So the template's
job is not to teach PromQL — it is to guarantee the right metric *shape* exists.

### The contract: fixed names, free extension

The platform guarantees a small set of names and shapes on every golden-path
service, and leaves everything else open:

| Metric | Type | Purpose |
|---|---|---|
| `http_requests_total{method,path,status}` | counter | Rate, error rate |
| `http_request_duration_seconds_bucket{...}` | **histogram** | P95/P99 latency |
| `http_requests_in_flight` | gauge | Saturation |

Because the names and shapes are fixed, **one dashboard and one scorecard work
for every service with no per-team configuration** — that is what makes the
system manageable. Teams add whatever custom business metrics they want on top;
those are scraped normally, they simply do not appear in the standard views.
Opinionated defaults, unopinionated extension — the same trade the golden path
makes everywhere else.

### Responsibility split

| Layer | Owns | Why it belongs there |
|---|---|---|
| **Template** (`wxops-templates`) | Client library + middleware emitting the three contract metrics | This is application code. Only the app can instrument itself; the portal cannot generate meaningful metrics. |
| **Composition** (`wxops-core`) | Emitting the `ServiceMonitor` (with release label, `sampleLimit`, and a named Service port) | It is a Kubernetes manifest, and the composition already emits Deployment/Service/IngressRoute. |
| **Portal** | The `monitoring.enabled` toggle in the scaffold wizard and Edit Config | Same role it plays for `darlane.enabled` — it writes the XR field, never the manifest. |

Today the templates *do* expose `/metrics`, but it is a hand-written
`fmt.Fprintf` of two or three runtime gauges with no Prometheus client library
in any of the three languages. Scraping it would succeed and return almost
nothing useful — which is why instrumentation comes before the ServiceMonitor,
not after.

### Cardinality is the real operational risk

The danger is not developers defining too many metrics; it is one developer
adding a high-cardinality label (`user_id`, `request_id`, a raw URL path) and
creating millions of series that degrade Prometheus for every tenant.

Current guards:

```yaml
sampleLimit: 0     # unlimited
targetLimit: 0     # unlimited
labelLimit: 0      # unlimited
```

**All of them are off.** With `retention: 120h` and no limits, a single bad
label on one tenant service is a platform-wide incident. The mitigation is a
`sampleLimit` set by the *composition* when it emits the ServiceMonitor, so
tenants cannot opt out of it. That one setting buys more safety than any
restriction on what metrics teams are permitted to define.

### GPU metrics are a separate concern

GPU utilisation is **not** application-emitted and does not belong in this
model at all. It comes from NVIDIA's DCGM exporter running as a DaemonSet,
producing `DCGM_FI_DEV_GPU_UTIL` and friends per node and pod, with zero
application instrumentation.

No DCGM or GPU exporter exists anywhere in `wxops-gitops-infrastructure` today,
so GPU metrics are simply unavailable. Adding them is a platform deployment
task, independent of the template and scaffold work above.

### Sequencing

Each step is useful on its own, and the order matters — reversed, you get a
toggle that enables an empty scrape:

1. **Instrument the templates** (Go first) with a real client library and the
   three contract metrics via middleware.
2. **Name the Service port** and add the `monitoring` block plus ServiceMonitor
   emission (with release label and `sampleLimit`) to the composition.
3. **Add the portal toggle** to the scaffold wizard and Edit Config.
4. **Ship the standard dashboard** keyed on the contract metric names.
5. Independently: **DCGM exporter** if GPU visibility is wanted.

---

## What the portal does not do, deliberately

- **No native log/metric/trace viewers.** Grafana's correlation (Explore,
  exemplars, trace-to-logs, trace-to-profiles) cannot be replicated cheaply and
  any reimplementation would be worse. The portal's contribution is knowing
  *which* query to open.
- **No signal proxying.** Log and metric data never transits the portal, which
  keeps it out of the data path entirely — no buffering, no retention, no
  new place for tenant data to leak.
- **No collector management.** Alloy is deployed and configured by GitOps like
  every other platform component; the portal does not configure it.

## Reference

- [observability.md](observability.md) — what the portal reads and links today, and its known limitations
- [cluster-registry.md](cluster-registry.md) — spoke registration and the missing observability-endpoint fields
- [../security/security-assurance.md](../security/security-assurance.md) — egress claims, Grafana authentication, Loki tenancy caveat
- [../concepts/architecture.md](../concepts/architecture.md) — the hub-spoke model this mirrors for auth
