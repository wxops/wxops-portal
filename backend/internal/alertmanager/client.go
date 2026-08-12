// Package alertmanager reads active alerts from Prometheus Alertmanager.
//
// This is the one place the portal talks to an observability backend rather
// than merely linking to it, so it is deliberately narrow:
//
//   - read-only: a single GET against /api/v2/alerts, no silences, no POST
//   - opt-in: disabled entirely when ALERTMANAGER_URL is unset
//   - bounded: short timeout, capped result count, no redirects followed
//
// It is also the portal's first egress destination outside Gitea, Vault, the
// OIDC issuer and the Kubernetes APIs — see docs/security/security-assurance.md
// (claim A4), which documents the change and the NetworkPolicy entry operators
// must add to keep egress enforced rather than merely true.
package alertmanager

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// requestTimeout bounds a single Alertmanager call. Alerts are a
// nice-to-have panel; they must never hold a page render open.
const requestTimeout = 5 * time.Second

// maxAlerts caps what one response can return, so a namespace in a storm
// cannot push an unbounded payload through the portal to the browser.
const maxAlerts = 50

// Client is a read-only Alertmanager v2 API client.
type Client struct {
	baseURL string
	http    *http.Client
}

// New returns a Client, or nil when baseURL is empty.
//
// A nil Client is the "not configured" state and every caller must handle it —
// the alerts feature is off unless an operator sets ALERTMANAGER_URL.
func New(baseURL string) *Client {
	if baseURL == "" {
		return nil
	}
	return &Client{
		baseURL: strings.TrimSuffix(baseURL, "/"),
		http: &http.Client{
			Timeout: requestTimeout,
			// Never follow a redirect: it could send the request (and any
			// future credential) to a host outside the egress allowlist.
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

// Alert is the portal-facing view of one firing alert.
type Alert struct {
	Name        string    `json:"name"`
	Severity    string    `json:"severity,omitempty"`
	Summary     string    `json:"summary,omitempty"`
	Description string    `json:"description,omitempty"`
	RunbookURL  string    `json:"runbookUrl,omitempty"`
	Pod         string    `json:"pod,omitempty"`
	Namespace   string    `json:"namespace,omitempty"`
	StartsAt    time.Time `json:"startsAt"`
	Fingerprint string    `json:"fingerprint,omitempty"`
}

// amAlert mirrors the subset of the Alertmanager v2 payload we consume.
type amAlert struct {
	Labels      map[string]string `json:"labels"`
	Annotations map[string]string `json:"annotations"`
	StartsAt    time.Time         `json:"startsAt"`
	Fingerprint string            `json:"fingerprint"`
}

// ListForApp returns active alerts affecting one application.
//
// Alertmanager is queried by namespace only, because no alert rule in the
// platform carries an `app` label today — the upstream kube-prometheus-stack
// rules label on namespace/pod/container, and no tenant PrometheusRule adds
// more. Narrowing to the application therefore happens here, by matching the
// `pod` label against the workload's name prefix.
//
// Alerts with no `pod` label (namespace-scoped rules such as quota exhaustion)
// are returned as well: they affect every workload in the namespace, including
// this one.
func (c *Client) ListForApp(ctx context.Context, namespace, appName string) ([]Alert, error) {
	if c == nil {
		return nil, nil
	}

	q := url.Values{}
	q.Set("active", "true")
	q.Set("silenced", "false")
	q.Set("inhibited", "false")
	q.Set("filter", fmt.Sprintf("namespace=%q", namespace))

	endpoint := c.baseURL + "/api/v2/alerts?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("build alertmanager request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("alertmanager unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("alertmanager returned %d", resp.StatusCode)
	}

	var raw []amAlert
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("parse alertmanager response: %w", err)
	}

	return mapAlerts(raw, appName), nil
}

// mapAlerts filters raw alerts to one app and converts them to the portal view.
// Split out from the HTTP call so the matching rules are directly testable.
func mapAlerts(raw []amAlert, appName string) []Alert {
	out := make([]Alert, 0, len(raw))

	for _, a := range raw {
		pod := a.Labels["pod"]
		if !podBelongsToApp(pod, appName) {
			continue
		}

		out = append(out, Alert{
			Name:        a.Labels["alertname"],
			Severity:    a.Labels["severity"],
			Summary:     a.Annotations["summary"],
			Description: a.Annotations["description"],
			RunbookURL:  a.Annotations["runbook_url"],
			Pod:         pod,
			Namespace:   a.Labels["namespace"],
			StartsAt:    a.StartsAt,
			Fingerprint: a.Fingerprint,
		})

		if len(out) == maxAlerts {
			break
		}
	}

	return out
}

// podBelongsToApp reports whether a pod name belongs to the given application.
//
// Deployment-managed pods are named "{deployment}-{replicaset}-{suffix}", and
// the deployment is either "{app}" (dev) or "{app}-{env}" (staging,
// production) — so a "{app}-" prefix covers every environment as well as the
// Darlane twin ("{app}-darlane-…").
//
// An empty pod label means a namespace-scoped alert, which affects this app
// along with everything else in the namespace, so it is kept.
func podBelongsToApp(pod, appName string) bool {
	if pod == "" {
		return true
	}
	if appName == "" {
		return false
	}
	return strings.HasPrefix(pod, appName+"-")
}
