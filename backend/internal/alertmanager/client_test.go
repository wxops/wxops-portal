package alertmanager

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

// An unset ALERTMANAGER_URL must yield a nil Client, and a nil Client must be
// safe to call — the alerts panel is simply absent rather than erroring.
func TestNewDisabledWhenURLEmpty(t *testing.T) {
	if c := New(""); c != nil {
		t.Fatalf("New(\"\") = %v, want nil", c)
	}

	alerts, err := (*Client)(nil).ListForApp(context.Background(), "ns", "app")
	if err != nil {
		t.Errorf("nil client returned error: %v", err)
	}
	if alerts != nil {
		t.Errorf("nil client returned alerts: %v", alerts)
	}
}

func TestPodBelongsToApp(t *testing.T) {
	cases := []struct {
		name    string
		pod     string
		appName string
		want    bool
	}{
		{"dev pod", "python-demo-7d9f8b5c4-x2k9p", "python-demo", true},
		{"staging pod", "python-demo-staging-6b8c-abcde", "python-demo", true},
		{"production pod", "python-demo-production-5a7d-zzzzz", "python-demo", true},
		{"darlane twin", "python-demo-darlane-84cf9-qq11w", "python-demo", true},
		{"namespace-scoped alert has no pod", "", "python-demo", true},
		{"different app", "other-service-7d9f8b5c4-x2k9p", "python-demo", false},
		// Guards against a prefix collision: "python-demo" must not swallow
		// alerts belonging to "python-demo-worker", which is its own app.
		{"app name is a prefix of another app", "python-demo-worker-1a2b-ccccc", "python-demo-worker", true},
		{"empty app name matches nothing", "python-demo-abc", "", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := podBelongsToApp(tc.pod, tc.appName); got != tc.want {
				t.Errorf("podBelongsToApp(%q, %q) = %v, want %v", tc.pod, tc.appName, got, tc.want)
			}
		})
	}
}

func TestMapAlerts(t *testing.T) {
	start := time.Date(2026, 8, 11, 9, 0, 0, 0, time.UTC)

	raw := []amAlert{
		{
			Labels: map[string]string{
				"alertname": "KubePodCrashLooping",
				"namespace": "tenant-rocket-team",
				"pod":       "python-demo-7d9f8b5c4-x2k9p",
				"severity":  "warning",
			},
			Annotations: map[string]string{
				"summary":     "Pod is crash looping",
				"description": "Pod has restarted 5 times in 10 minutes",
				"runbook_url": "https://runbooks.example.com/KubePodCrashLooping",
			},
			StartsAt:    start,
			Fingerprint: "abc123",
		},
		{
			Labels: map[string]string{
				"alertname": "SomeOtherAppAlert",
				"namespace": "tenant-rocket-team",
				"pod":       "unrelated-service-abc-def",
				"severity":  "critical",
			},
			StartsAt: start,
		},
	}

	got := mapAlerts(raw, "python-demo")

	if len(got) != 1 {
		t.Fatalf("got %d alerts, want 1 (the other app's alert must be filtered out)", len(got))
	}

	a := got[0]
	if a.Name != "KubePodCrashLooping" {
		t.Errorf("Name = %q", a.Name)
	}
	if a.Severity != "warning" {
		t.Errorf("Severity = %q", a.Severity)
	}
	if a.RunbookURL != "https://runbooks.example.com/KubePodCrashLooping" {
		t.Errorf("RunbookURL = %q", a.RunbookURL)
	}
	if !a.StartsAt.Equal(start) {
		t.Errorf("StartsAt = %v, want %v", a.StartsAt, start)
	}
}

// A namespace in an alert storm must not push an unbounded payload to the browser.
func TestMapAlertsCapsResults(t *testing.T) {
	raw := make([]amAlert, maxAlerts+25)
	for i := range raw {
		raw[i] = amAlert{Labels: map[string]string{
			"alertname": "Flood",
			"pod":       "python-demo-abc-def",
		}}
	}

	if got := len(mapAlerts(raw, "python-demo")); got != maxAlerts {
		t.Errorf("got %d alerts, want the %d cap", got, maxAlerts)
	}
}

func TestListForAppQueriesActiveAlertsByNamespace(t *testing.T) {
	var gotQuery url.Values

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query()
		if r.URL.Path != "/api/v2/alerts" {
			t.Errorf("path = %q, want /api/v2/alerts", r.URL.Path)
		}
		if r.Method != http.MethodGet {
			t.Errorf("method = %q, want GET — this client must never mutate", r.Method)
		}
		_ = json.NewEncoder(w).Encode([]amAlert{})
	}))
	defer srv.Close()

	if _, err := New(srv.URL).ListForApp(context.Background(), "tenant-rocket-team", "python-demo"); err != nil {
		t.Fatalf("ListForApp: %v", err)
	}

	if got := gotQuery.Get("active"); got != "true" {
		t.Errorf("active = %q, want true", got)
	}
	if got := gotQuery.Get("silenced"); got != "false" {
		t.Errorf("silenced = %q, want false — silenced alerts are noise", got)
	}
	if got := gotQuery.Get("inhibited"); got != "false" {
		t.Errorf("inhibited = %q, want false", got)
	}
	if got, want := gotQuery.Get("filter"), `namespace="tenant-rocket-team"`; got != want {
		t.Errorf("filter = %q, want %q", got, want)
	}
}

func TestListForAppTrimsTrailingSlash(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_ = json.NewEncoder(w).Encode([]amAlert{})
	}))
	defer srv.Close()

	if _, err := New(srv.URL+"/").ListForApp(context.Background(), "ns", "app"); err != nil {
		t.Fatalf("ListForApp: %v", err)
	}
	if gotPath != "/api/v2/alerts" {
		t.Errorf("path = %q, want /api/v2/alerts (no double slash)", gotPath)
	}
}

func TestListForAppSurfacesUpstreamFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	if _, err := New(srv.URL).ListForApp(context.Background(), "ns", "app"); err == nil {
		t.Error("expected an error for a 503 response")
	}
}
