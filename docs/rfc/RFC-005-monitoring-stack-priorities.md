# RFC-005: Monitoring Stack — Prioritizing the Documented Gaps

> **Status:** proposed — brainstorm draft. **Owner:** platform-team. **Spans:**
> `wxops-gitops-infrastructure` (Alloy, Prometheus, Alertmanager config) and `wxops-templates`
> (client-library instrumentation) — **not Portal code**, same as `RFC-004`.
>
> **Grounding:** [`../platform/observability.md`](../platform/observability.md)'s "Known limitations"
> table (7 items, already candidly documented) and
> [`../platform/observability-architecture.md`](../platform/observability-architecture.md)'s
> cardinality-risk and VictoriaMetrics-swap sections. **Shared dependency with RFC-004:** the Alloy
> hardcoded `cluster` label appears in both this RFC and `RFC-004-multi-cluster-sequencing.md` — noted
> there too as a fact, not a thematic link.

---

## Summary

`observability.md` already lists seven known limitations plainly, and `observability-architecture.md`
separately names cardinality as the real operational risk with all three Prometheus guard-rails
(`sampleLimit`/`targetLimit`/`labelLimit`) currently off cluster-wide. Nothing has prioritized these
against each other, or decided the timing of the one structural option on the table — swapping
Prometheus Operator for VictoriaMetrics Operator, which the ecosystem doc itself calls "close to free."
This RFC proposes an order and flags which items are risk (fix regardless of demand) versus feature
(fix when someone asks).

## Motivation

Two different documents independently flag the same fact from two angles: `ROADMAP.md`'s Pending table
calls cardinality guards the "Highest-value/lowest-effort item in this table," and
`observability-architecture.md` states plainly *"a single bad label on one tenant service is a
platform-wide incident."* That's not a hypothetical future risk — with `retention: 120h` and all limits
at `0`, it's live today, with exactly one tenant. Everything else in the known-limitations table is a
missing capability; this one is closer to an open incident waiting for a trigger, and it's the only item
worth treating with real urgency independent of adoption pressure.

## Detailed Design

### Grouped by what they actually are, not by document order

**Live risk, not a missing feature — fix regardless of demand:**
- `sampleLimit`/`targetLimit`/`labelLimit` all at `0`. The composition already sets a per-`ServiceMonitor`
  `sampleLimit` (v0.5.1), but `targetLimit`/`labelLimit` are still cluster-wide `0` — a tenant can't cause
  the first kind of damage anymore, but a cluster-wide unbounded target/label count is still one
  misconfigured `ServiceMonitor` away from degrading Prometheus for everyone.

**Missing capability that undercuts a feature already shipped and demoed:**
- **Alertmanager's receiver is `null`.** Alerts are visible in the Runtime tab and Grafana but page
  nobody. If the OSS "10-minute demo" (`open-source-readiness.md` §E) ever shows the alerts panel as a
  selling point, a `null` receiver is a real credibility gap the moment someone asks "so does this
  actually page on-call?" — the honest answer today is no.
- **Alerts carry no `app` label**, so the portal's narrowing-by-`pod`-prefix is a correctness workaround,
  not the real mechanism; a proper fix is a new per-tenant `PrometheusRule`, already scoped in
  `ROADMAP.md` as "~15-20 lines... once [the product decision]'s decided" — the blocker is a decision,
  not effort.
- **OTLP logs/metrics exporters are commented out** in Alloy — anyone sending OTLP logs/metrics today
  gets silent data loss, not an error. Silent data loss is worse than an unimplemented feature, because
  it looks like it's working.

**Structural option, not a bug — a real "when," not "whether":**
- **VictoriaMetrics Operator swap.** Same `ServiceMonitor`/`PodMonitor` CRD contract, zero Composition
  rework, materially smaller footprint. `ecosystem-tool-strategy.md` already recommends it and flags it
  as one of only two decisions (with storage) worth locking in "before the next release." The honest
  question is timing: cheaper to do now with one cluster and few tenants than after multi-cluster
  (`RFC-004`) multiplies the surface being migrated.
- **Alloy gateway tier** for correct trace sampling — a second Alloy *role* (Deployment, hub-only), not
  a new tool. Currently traces pass through with no real tail-sampling decision being made correctly
  (`ecosystem-tool-strategy.md`'s finding: no per-node agent can see a whole trace).

**Pure feature gaps, fix when demand exists:**
- Profiling requires app-side Pyroscope push (expected, not a platform gap).
- DCGM/GPU exporter — zero current usage signal; `ROADMAP.md` already treats this as fully independent
  platform deployment work.
- Misleading `prometheus.io/scrape` example in the `XTenantApp` sample file — cheap doc fix, does not
  belong in the same priority conversation as the rest, listed here only so it isn't lost.

## Drawbacks

| Item | Cost of fixing now |
|---|---|
| `targetLimit`/`labelLimit` | Trivial (a values change on the Prometheus CR) — no real drawback to doing this immediately |
| Alertmanager receiver | Requires deciding what actually pages (Slack? PagerDuty? email?) before it can be configured — a product decision, not just config |
| Per-tenant `PrometheusRule` | Blocked on the same product decision `ROADMAP.md` already names: which alerts get per-tenant treatment |
| VictoriaMetrics swap | Real migration effort now vs. larger migration effort later — the tradeoff is entirely about timing, not whether |
| Alloy gateway tier | New operational component (a Deployment) to run and monitor, even though it's "just" a second Alloy role |

## Alternatives

- **Do nothing until real usage surfaces which limitation actually bites.** Consistent with the
  project's adoption-driven philosophy elsewhere. Doesn't hold up for the cardinality item specifically,
  given the "platform-wide incident" framing is about blast radius *today*, not about a feature nobody
  asked for yet — that's the one item this RFC argues shouldn't wait for a trigger.

## Rollout Plan

1. **`targetLimit`/`labelLimit` on the Prometheus CR — do this first, independent of everything else.**
   Cheapest possible fix for the only live-risk item.
2. **Decide the Alertmanager receiver and the per-tenant alert-labeling product question together** —
   they're really one decision (what does "alerting actually works" mean for this platform) split
   across two tickets.
3. **VictoriaMetrics timing decision should be made *before* `RFC-004`'s Track 2 (spoke provisioning)
   produces a second cluster** — migrating once, before the surface multiplies, is the cheaper order if
   the swap is happening at all.
4. **Alloy gateway tier can proceed independently, whenever trace volume or a real debugging need
   justifies it** — no hard dependency on anything else in this RFC or in `RFC-004`.
5. GPU/DCGM and the doc-example fix stay fully decoupled, demand-driven.

## Open Questions

1. Is the VictoriaMetrics swap actually happening, or is `ecosystem-tool-strategy.md`'s "close to free"
   framing enough to decide it now — and if now, before or independent of `RFC-004`'s timeline?
2. What does "alerting actually works" mean as a product decision — is a `null` receiver acceptable for
   the OSS launch demo with a documented caveat, or does this need to be real before publishing v0.6.x?
3. Does the per-tenant `PrometheusRule` decision (which alerts get per-tenant treatment) have an owner
   yet, or is it still fully open as `ROADMAP.md` leaves it?
4. Is there any actual OTLP logs/metrics traffic today that's being silently dropped, or is this a
   theoretical gap because nothing sends OTLP logs/metrics yet — changes the urgency considerably either
   way.
