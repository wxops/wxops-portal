// Package observability builds deep links from catalog context into the
// platform's signal stores.
//
// The portal deliberately does not query Grafana, Loki, Tempo, Pyroscope or
// Alertmanager. It only constructs URLs — every function here is pure string
// building with no network access, which is why the portal's bounded-egress
// assurance (claim A4 in docs/security/security-assurance.md) is unaffected by
// this feature.
//
// Selectors are built against the label conventions the platform actually
// emits (see docs/platform/observability.md):
//
//	logs    Alloy relabels pod logs to  namespace, pod, container, app, job
//	        where `app` comes from the app.kubernetes.io/name label.
//	traces  Alloy's k8sattributes processor sets k8s.namespace.name and
//	        k8s.deployment.name as resource attributes.
//	metrics no ServiceMonitor exists for tenant workloads, so links target
//	        cAdvisor series by namespace + pod prefix rather than app metrics.
package observability

import (
	"encoding/json"
	"net/url"
	"strings"
)

// Config holds the operator-supplied observability endpoints. A zero value is
// valid: every builder returns "" when its base URL is unset, and the frontend
// hides links with an empty href.
type Config struct {
	GrafanaURL           string
	LokiDatasource       string
	TempoDatasource      string
	PrometheusDatasource string
	PyroscopeDatasource  string
	ArgoCDURL            string
	ArgoCDNamespace      string
}

// Links is the set of deep links returned for one environment.
// Fields are omitted from JSON when empty so the frontend can simply check for
// presence rather than for empty strings.
type Links struct {
	Logs     string `json:"logs,omitempty"`
	Traces   string `json:"traces,omitempty"`
	CPU      string `json:"cpu,omitempty"`
	Memory   string `json:"memory,omitempty"`
	Profiles string `json:"profiles,omitempty"`
	ArgoCD   string `json:"argocd,omitempty"`
}

// defaultRange is the Explore time window. One hour is short enough that a
// developer checking a just-completed deploy sees only relevant signal.
var defaultRange = map[string]string{"from": "now-1h", "to": "now"}

// sanitize strips everything outside the DNS-1123 character set.
//
// Namespace and app names originate from catalog entities, which are authored
// in Git. Restricting them to characters that are legal in Kubernetes names
// means a crafted entity cannot inject quotes or braces into a LogQL/PromQL
// expression and turn a deep link into an attacker-chosen query.
func sanitize(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '-', r == '_', r == '.':
			b.WriteRune(r)
		}
	}
	return b.String()
}

// exploreURL renders a Grafana Explore link for a single query.
//
// Grafana 10.2+ reads Explore state from `panes` + `schemaVersion`; the older
// `left` parameter is deprecated. kube-prometheus-stack ships a Grafana well
// past that cutoff, so we emit the current form only.
func exploreURL(grafana, datasource string, query map[string]any) string {
	if grafana == "" || datasource == "" {
		return ""
	}

	panes := map[string]any{
		"wxops": map[string]any{
			"datasource": datasource,
			"queries":    []any{query},
			"range":      defaultRange,
		},
	}

	encoded, err := json.Marshal(panes)
	if err != nil {
		// Unreachable for these value types; returning "" keeps the link hidden
		// rather than rendering a broken href.
		return ""
	}

	q := url.Values{}
	q.Set("schemaVersion", "1")
	q.Set("panes", string(encoded))
	q.Set("orgId", "1")

	return strings.TrimSuffix(grafana, "/") + "/explore?" + q.Encode()
}

// LogsURL builds a Grafana Explore link showing this environment's logs in Loki.
//
// The `app` label is Alloy's rewrite of app.kubernetes.io/name, which the
// composition sets to the application name — identical across dev, staging and
// production. It alone would return all three environments interleaved, so the
// pod matcher from podSelector is what actually scopes the query.
func LogsURL(grafana, datasource, namespace, app, env string) string {
	namespace, app, env = sanitize(namespace), sanitize(app), sanitize(env)
	if namespace == "" || app == "" {
		return ""
	}

	sel := podSelector(namespace, app, env)
	if sel == "" {
		return ""
	}

	// LogQL stream selectors accept the same matcher syntax as PromQL, so the
	// namespace/pod matchers carry over unchanged.
	expr := "{" + sel + ", app=\"" + app + "\"}"

	return exploreURL(grafana, datasource, map[string]any{
		"refId":      "A",
		"datasource": datasource,
		"expr":       expr,
		"queryType":  "range",
	})
}

// TracesURL builds a Grafana Explore link showing this environment's traces.
//
// k8s.deployment.name is set by Alloy's k8sattributes processor and is already
// environment-specific ({app}, {app}-staging, {app}-production), so this is an
// exact match rather than a prefix — no risk of bleeding across environments.
//
// service.name is deliberately not used: it comes from each application's own
// OTEL SDK config, which the platform does not set.
func TracesURL(grafana, datasource, namespace, app, env string) string {
	namespace, app, env = sanitize(namespace), sanitize(app), sanitize(env)
	if namespace == "" || app == "" {
		return ""
	}

	deployment := deploymentName(app, env)
	if deployment == "" {
		return ""
	}

	traceql := "{resource.k8s.namespace.name=\"" + namespace + "\"" +
		" && resource.k8s.deployment.name=\"" + deployment + "\"}"

	return exploreURL(grafana, datasource, map[string]any{
		"refId":      "A",
		"datasource": datasource,
		"queryType":  "traceql",
		"query":      traceql,
	})
}

// deploymentName maps an application and environment to the Deployment the
// composition creates. dev keeps the base name; staging and production are
// suffixed. Returns "" for an unknown environment.
func deploymentName(app, env string) string {
	switch env {
	case "dev":
		return app
	case "staging", "production":
		return app + "-" + env
	default:
		return ""
	}
}

// podSelector builds the PromQL label matchers that isolate one environment's
// pods for an application.
//
// All three environments share a namespace, so the pod name is the only
// discriminator available on cAdvisor series (which carry namespace/pod/
// container and nothing else — no workload labels). Deployments are named:
//
//	dev          {app}
//	staging      {app}-staging
//	production   {app}-production
//	Darlane twin {app}-darlane
//
// and their pods are "{deployment}-{replicaset}-{suffix}". A naive
// `pod=~"{app}-.*"` therefore matches *every* environment plus the twin, which
// is why the dev case needs an explicit exclusion rather than a prefix alone.
//
// PromQL regex matchers are fully anchored, so `.+` cannot leak past the
// intended segment.
//
// Returns "" for an unknown environment rather than guessing.
func podSelector(namespace, app, env string) string {
	ns := "namespace=\"" + namespace + "\", "

	switch env {
	case "staging", "production":
		return ns + "pod=~\"" + app + "-" + env + "-.+\""
	case "dev":
		// Everything under the app prefix except the other environments and the
		// debug twin, whose resource use would otherwise distort dev's numbers.
		return ns + "pod=~\"" + app + "-.+\", " +
			"pod!~\"" + app + "-(staging|production|darlane)-.+\""
	default:
		return ""
	}
}

// containerFilter drops the pause container and the pod-level rollup so the
// series returned are the real application containers only.
const containerFilter = ", container!=\"\", container!=\"POD\""

// CPUUsageURL builds a Grafana Explore link showing CPU usage for one
// environment of an application, broken down by pod.
//
// This targets cAdvisor rather than an application metric, because no
// ServiceMonitor exists for tenant workloads today and Prometheus only selects
// monitors carrying the kube-prometheus-stack release label. It is therefore
// available for every workload with no instrumentation — but it is container
// CPU, not request-level performance.
func CPUUsageURL(grafana, datasource, namespace, app, env string) string {
	namespace, app, env = sanitize(namespace), sanitize(app), sanitize(env)
	if namespace == "" || app == "" {
		return ""
	}

	sel := podSelector(namespace, app, env)
	if sel == "" {
		return ""
	}

	expr := "sum(rate(container_cpu_usage_seconds_total{" + sel + containerFilter +
		"}[5m])) by (pod)"

	return exploreURL(grafana, datasource, map[string]any{
		"refId":      "A",
		"datasource": datasource,
		"expr":       expr,
		"range":      true,
	})
}

// MemoryUsageURL builds a Grafana Explore link showing memory usage for one
// environment of an application, broken down by pod.
//
// Uses container_memory_working_set_bytes — the figure the kernel OOM killer
// actually evaluates against the container's limit. container_memory_usage_bytes
// includes reclaimable page cache and routinely looks alarming for a workload
// that is nowhere near being killed, which makes it the wrong number to put in
// front of someone debugging an OOMKill.
func MemoryUsageURL(grafana, datasource, namespace, app, env string) string {
	namespace, app, env = sanitize(namespace), sanitize(app), sanitize(env)
	if namespace == "" || app == "" {
		return ""
	}

	sel := podSelector(namespace, app, env)
	if sel == "" {
		return ""
	}

	expr := "sum(container_memory_working_set_bytes{" + sel + containerFilter +
		"}) by (pod)"

	return exploreURL(grafana, datasource, map[string]any{
		"refId":      "A",
		"datasource": datasource,
		"expr":       expr,
		"range":      true,
	})
}

// ProfilesURL builds a Grafana Explore link into Pyroscope for one environment.
//
// Continuous profiling requires the application to push profiles itself — the
// platform does not inject a profiler. The link is still emitted so teams that
// have instrumented their service land on the right selector; for everyone else
// it opens an empty view rather than failing.
func ProfilesURL(grafana, datasource, namespace, app, env string) string {
	namespace, app, env = sanitize(namespace), sanitize(app), sanitize(env)
	if namespace == "" || app == "" {
		return ""
	}

	deployment := deploymentName(app, env)
	if deployment == "" {
		return ""
	}

	selector := "{namespace=\"" + namespace + "\", service_name=\"" + deployment + "\"}"

	return exploreURL(grafana, datasource, map[string]any{
		"refId":         "A",
		"datasource":    datasource,
		"queryType":     "profile",
		"labelSelector": selector,
		"profileTypeId": "process_cpu:cpu:nanoseconds:cpu:nanoseconds",
		"groupBy":       []any{},
	})
}

// ArgoAppURL builds a link to an Application in the ArgoCD UI.
//
// ArgoCD routes application detail pages as /applications/{namespace}/{name}
// where namespace is where the Application CR lives (argocd), not where the
// workload is deployed.
func ArgoAppURL(argocdURL, argocdNamespace, appName string) string {
	if argocdURL == "" || appName == "" {
		return ""
	}
	if argocdNamespace == "" {
		argocdNamespace = "argocd"
	}

	return strings.TrimSuffix(argocdURL, "/") +
		"/applications/" + url.PathEscape(argocdNamespace) +
		"/" + url.PathEscape(appName)
}

// BuildLinks assembles every deep link for one environment of one application.
//
// namespace/app identify the workload and env selects which environment's pods
// and Deployment the queries target; argoAppName is the ArgoCD Application
// ({team}-{app}-{env}). Any link whose backing URL is unconfigured — or whose
// environment is unrecognised — comes back empty and is dropped from the JSON.
func (c Config) BuildLinks(namespace, app, env, argoAppName string) Links {
	return Links{
		Logs:     LogsURL(c.GrafanaURL, c.LokiDatasource, namespace, app, env),
		Traces:   TracesURL(c.GrafanaURL, c.TempoDatasource, namespace, app, env),
		CPU:      CPUUsageURL(c.GrafanaURL, c.PrometheusDatasource, namespace, app, env),
		Memory:   MemoryUsageURL(c.GrafanaURL, c.PrometheusDatasource, namespace, app, env),
		Profiles: ProfilesURL(c.GrafanaURL, c.PyroscopeDatasource, namespace, app, env),
		ArgoCD:   ArgoAppURL(c.ArgoCDURL, c.ArgoCDNamespace, argoAppName),
	}
}
