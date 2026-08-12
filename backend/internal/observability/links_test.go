package observability

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"
)

const grafana = "https://grafana.example.com"

// paneQuery pulls the single query object back out of a generated Explore URL.
// Asserting on the decoded query rather than on the encoded URL keeps the tests
// independent of parameter ordering and percent-encoding.
func paneQuery(t *testing.T, raw string) map[string]any {
	t.Helper()

	if raw == "" {
		t.Fatal("expected a URL, got empty string")
	}

	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("generated URL does not parse: %v", err)
	}

	if got := u.Query().Get("schemaVersion"); got != "1" {
		t.Errorf("schemaVersion = %q, want \"1\"", got)
	}

	panes := u.Query().Get("panes")
	if panes == "" {
		t.Fatal("URL has no panes parameter")
	}

	var decoded map[string]struct {
		Datasource string           `json:"datasource"`
		Queries    []map[string]any `json:"queries"`
		Range      map[string]any   `json:"range"`
	}
	if err := json.Unmarshal([]byte(panes), &decoded); err != nil {
		t.Fatalf("panes is not valid JSON: %v", err)
	}

	pane, ok := decoded["wxops"]
	if !ok {
		t.Fatal("panes has no \"wxops\" entry")
	}
	if len(pane.Queries) != 1 {
		t.Fatalf("got %d queries, want 1", len(pane.Queries))
	}

	return pane.Queries[0]
}

func TestLogsURLScopesToEnvironment(t *testing.T) {
	// staging is an exact prefix; dev must additionally exclude the other
	// environments, which share the namespace and the `app` label.
	cases := []struct{ env, want string }{
		{"staging", `{namespace="tenant-rocket-team", pod=~"python-demo-staging-.+", app="python-demo"}`},
		{"production", `{namespace="tenant-rocket-team", pod=~"python-demo-production-.+", app="python-demo"}`},
		{"dev", `{namespace="tenant-rocket-team", pod=~"python-demo-.+", pod!~"python-demo-(staging|production|darlane)-.+", app="python-demo"}`},
	}

	for _, tc := range cases {
		t.Run(tc.env, func(t *testing.T) {
			q := paneQuery(t, LogsURL(grafana, "Loki", "tenant-rocket-team", "python-demo", tc.env))
			if got := q["expr"]; got != tc.want {
				t.Errorf("expr = %q, want %q", got, tc.want)
			}
			if got := q["queryType"]; got != "range" {
				t.Errorf("queryType = %q, want \"range\"", got)
			}
		})
	}
}

func TestTracesURLUsesEnvironmentDeploymentName(t *testing.T) {
	// k8s.deployment.name is already environment-specific, so these are exact
	// matches — no prefix bleeding between environments.
	cases := []struct{ env, wantDeployment string }{
		{"dev", "python-demo"},
		{"staging", "python-demo-staging"},
		{"production", "python-demo-production"},
	}

	for _, tc := range cases {
		t.Run(tc.env, func(t *testing.T) {
			q := paneQuery(t, TracesURL(grafana, "Tempo", "tenant-rocket-team", "python-demo", tc.env))
			want := `{resource.k8s.namespace.name="tenant-rocket-team" && resource.k8s.deployment.name="` + tc.wantDeployment + `"}`
			if got := q["query"]; got != want {
				t.Errorf("query = %q, want %q", got, want)
			}
			if got := q["queryType"]; got != "traceql" {
				t.Errorf("queryType = %q, want \"traceql\"", got)
			}
		})
	}
}

func TestCPUUsageURL(t *testing.T) {
	q := paneQuery(t, CPUUsageURL(grafana, "prometheus", "tenant-rocket-team", "python-demo", "staging"))
	expr, _ := q["expr"].(string)

	for _, want := range []string{
		"container_cpu_usage_seconds_total",
		`namespace="tenant-rocket-team"`,
		`pod=~"python-demo-staging-.+"`,
		// The pause container and the pod-level rollup would both distort the total.
		`container!=""`,
		`container!="POD"`,
		"by (pod)",
	} {
		if !strings.Contains(expr, want) {
			t.Errorf("expr %q does not contain %q", expr, want)
		}
	}
	if q["range"] != true {
		t.Errorf("range = %v, want true", q["range"])
	}
}

func TestMemoryUsageURL(t *testing.T) {
	q := paneQuery(t, MemoryUsageURL(grafana, "prometheus", "tenant-rocket-team", "python-demo", "production"))
	expr, _ := q["expr"].(string)

	// working_set is what the OOM killer evaluates; usage_bytes includes
	// reclaimable page cache and would mislead someone debugging an OOMKill.
	if !strings.Contains(expr, "container_memory_working_set_bytes") {
		t.Errorf("expr %q must use container_memory_working_set_bytes", expr)
	}
	if strings.Contains(expr, "container_memory_usage_bytes") {
		t.Errorf("expr %q must not use container_memory_usage_bytes", expr)
	}
	if !strings.Contains(expr, `pod=~"python-demo-production-.+"`) {
		t.Errorf("expr %q is not scoped to the production environment", expr)
	}
}

// dev shares its namespace and app label with staging and production, and the
// bare prefix "python-demo-" matches all of them plus the Darlane twin — so the
// exclusion matcher is what makes dev's numbers correct.
func TestDevMetricsExcludeOtherEnvironmentsAndTwin(t *testing.T) {
	q := paneQuery(t, CPUUsageURL(grafana, "prometheus", "tenant-rocket-team", "python-demo", "dev"))
	expr, _ := q["expr"].(string)

	if !strings.Contains(expr, `pod!~"python-demo-(staging|production|darlane)-.+"`) {
		t.Errorf("dev expr %q lacks the exclusion matcher — it would include other environments", expr)
	}
}

// An environment the platform does not create must not silently produce a query
// that matches nothing (or worse, everything).
func TestUnknownEnvironmentYieldsNoLink(t *testing.T) {
	for _, env := range []string{"", "prod", "qa", "Production"} {
		t.Run(env, func(t *testing.T) {
			if got := CPUUsageURL(grafana, "prometheus", "ns", "app", env); got != "" {
				t.Errorf("CPUUsageURL(env=%q) = %q, want empty", env, got)
			}
			if got := LogsURL(grafana, "Loki", "ns", "app", env); got != "" {
				t.Errorf("LogsURL(env=%q) = %q, want empty", env, got)
			}
			if got := TracesURL(grafana, "Tempo", "ns", "app", env); got != "" {
				t.Errorf("TracesURL(env=%q) = %q, want empty", env, got)
			}
		})
	}
}

func TestProfilesURL(t *testing.T) {
	q := paneQuery(t, ProfilesURL(grafana, "Pyroscope", "tenant-rocket-team", "python-demo", "dev"))

	want := `{namespace="tenant-rocket-team", service_name="python-demo"}`
	if got := q["labelSelector"]; got != want {
		t.Errorf("labelSelector = %q, want %q", got, want)
	}
}

// Every builder must stay silent rather than emit a broken href when the
// operator has not configured the backing endpoint.
func TestBuildersReturnEmptyWhenUnconfigured(t *testing.T) {
	cases := []struct {
		name string
		got  string
	}{
		{"logs without grafana", LogsURL("", "Loki", "ns", "app", "dev")},
		{"logs without datasource", LogsURL(grafana, "", "ns", "app", "dev")},
		{"logs without namespace", LogsURL(grafana, "Loki", "", "app", "dev")},
		{"logs without app", LogsURL(grafana, "Loki", "ns", "", "dev")},
		{"traces without grafana", TracesURL("", "Tempo", "ns", "app", "dev")},
		{"cpu without grafana", CPUUsageURL("", "prometheus", "ns", "app", "dev")},
		{"memory without grafana", MemoryUsageURL("", "prometheus", "ns", "app", "dev")},
		{"profiles without grafana", ProfilesURL("", "Pyroscope", "ns", "app", "dev")},
		{"argocd without url", ArgoAppURL("", "argocd", "team-app-dev")},
		{"argocd without app", ArgoAppURL("https://argocd.example.com", "argocd", "")},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.got != "" {
				t.Errorf("got %q, want empty string", tc.got)
			}
		})
	}
}

// Catalog entities are authored in Git, so a crafted name must not be able to
// break out of the quoted selector and rewrite the query.
func TestSanitizeBlocksQueryInjection(t *testing.T) {
	hostile := `foo", app=~".*`

	q := paneQuery(t, LogsURL(grafana, "Loki", "tenant-x", hostile, "dev"))
	expr, _ := q["expr"].(string)

	if strings.Contains(expr, `app=~`) {
		t.Errorf("injected matcher survived sanitization: %q", expr)
	}
	// Quotes, comma, space, `=`, `~` and `*` are all stripped, leaving only
	// DNS-safe characters — so the regex metacharacter cannot survive either.
	if got, want := expr, `{namespace="tenant-x", pod=~"fooapp.-.+", pod!~"fooapp.-(staging|production|darlane)-.+", app="fooapp."}`; got != want {
		t.Errorf("expr = %q, want %q", got, want)
	}
}

func TestSanitize(t *testing.T) {
	cases := []struct{ in, want string }{
		{"python-demo", "python-demo"},
		{"tenant-rocket-team", "tenant-rocket-team"},
		{"app_v1.2", "app_v1.2"},
		{`a"b{c}d e`, "abcde"},
		{"star*and~tilde", "starandtilde"},
		{"", ""},
	}

	for _, tc := range cases {
		if got := sanitize(tc.in); got != tc.want {
			t.Errorf("sanitize(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestArgoAppURL(t *testing.T) {
	cases := []struct {
		name                 string
		base, namespace, app string
		want                 string
	}{
		{
			name: "standard",
			base: "https://argocd.example.com", namespace: "argocd", app: "rocket-team-python-demo-dev",
			want: "https://argocd.example.com/applications/argocd/rocket-team-python-demo-dev",
		},
		{
			name: "trailing slash is trimmed",
			base: "https://argocd.example.com/", namespace: "argocd", app: "a-b-dev",
			want: "https://argocd.example.com/applications/argocd/a-b-dev",
		},
		{
			name: "namespace defaults to argocd",
			base: "https://argocd.example.com", namespace: "", app: "a-b-dev",
			want: "https://argocd.example.com/applications/argocd/a-b-dev",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ArgoAppURL(tc.base, tc.namespace, tc.app); got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestBuildLinks(t *testing.T) {
	cfg := Config{
		GrafanaURL:           grafana,
		LokiDatasource:       "Loki",
		TempoDatasource:      "Tempo",
		PrometheusDatasource: "prometheus",
		PyroscopeDatasource:  "Pyroscope",
		ArgoCDURL:            "https://argocd.example.com",
		ArgoCDNamespace:      "argocd",
	}

	links := cfg.BuildLinks("tenant-rocket-team", "python-demo", "dev", "rocket-team-python-demo-dev")

	if links.Logs == "" || links.Traces == "" || links.CPU == "" ||
		links.Memory == "" || links.Profiles == "" || links.ArgoCD == "" {
		t.Fatalf("fully configured Config produced an empty link: %+v", links)
	}
}

// A partially configured platform (Grafana set up, ArgoCD not yet) must still
// return the links it can build.
func TestBuildLinksPartialConfig(t *testing.T) {
	cfg := Config{GrafanaURL: grafana, LokiDatasource: "Loki"}

	links := cfg.BuildLinks("tenant-rocket-team", "python-demo", "dev", "rocket-team-python-demo-dev")

	if links.Logs == "" {
		t.Error("Logs should be built when Grafana and the Loki datasource are set")
	}
	if links.Traces != "" {
		t.Errorf("Traces should be empty without a Tempo datasource, got %q", links.Traces)
	}
	if links.ArgoCD != "" {
		t.Errorf("ArgoCD should be empty without ARGOCD_URL, got %q", links.ArgoCD)
	}
}

// Links marshal with omitempty so the frontend can test for presence.
func TestLinksOmitEmpty(t *testing.T) {
	b, err := json.Marshal(Links{Logs: "https://x"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	if got, want := string(b), `{"logs":"https://x"}`; got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}
