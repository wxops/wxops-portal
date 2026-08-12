package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/wxops/wxops-portal-v2/internal/alertmanager"
	"github.com/wxops/wxops-portal-v2/internal/auth"
	"github.com/wxops/wxops-portal-v2/internal/catalog"
	"github.com/wxops/wxops-portal-v2/internal/cluster"
	"github.com/wxops/wxops-portal-v2/internal/config"
	"github.com/wxops/wxops-portal-v2/internal/observability"
	"github.com/wxops/wxops-portal-v2/internal/scaffold"
)

// envOrder is the promotion pipeline, and also the display order.
// These strings are the ArgoCD Application name suffixes produced by the
// tenants-apps ApplicationSet — note "production", not "prod".
var envOrder = []string{"dev", "staging", "production"}

// obsCacheTTL bounds how stale runtime status may be.
//
// Short, because a developer watching a deploy land refreshes expecting truth;
// non-zero, because the frontend polls every 30s per open tab and each entry
// costs one token exchange plus two API reads per cluster.
const obsCacheTTL = 30 * time.Second

// ObservabilityHandler serves live environment status for a catalog entity.
//
// It reads ArgoCD Applications and Crossplane XRs using the logged-in user's
// Pinniped credentials — the portal never uses a standing credential of its own
// for tenant resources — and builds Grafana deep links from catalog context.
//
// Grafana, Loki, Tempo and Pyroscope are only ever linked to, never called.
// Alertmanager is the one exception: when ALERTMANAGER_URL is set, the portal
// reads active alerts server-side so a developer can see "is this broken right
// now?" without leaving the page. That call is opt-in and read-only — see
// docs/security/security-assurance.md claim A4.
type ObservabilityHandler struct {
	store    *catalog.Store
	registry cluster.Registry
	broker   *CredentialBroker
	links    observability.Config
	argoNS   string

	// alerts is nil when ALERTMANAGER_URL is unset, which disables the feature.
	alerts *alertmanager.Client

	// cache is keyed by "<sub>:<kind>/<name>". Including the session subject is
	// mandatory, not defensive: the payload is assembled from reads performed
	// with one user's RBAC, so a key without the user would serve one tenant's
	// view to another.
	cache sync.Map
}

// obsCacheEntry is a cached response plus the time it was built.
type obsCacheEntry struct {
	payload  envResponse
	cachedAt time.Time
}

// argoStatus is the slice of an ArgoCD Application the portal surfaces.
type argoStatus struct {
	Available  bool   `json:"available"`
	Sync       string `json:"sync,omitempty"`     // Synced | OutOfSync | Unknown
	Health     string `json:"health,omitempty"`   // Healthy | Progressing | Degraded | Suspended | Missing
	Revision   string `json:"revision,omitempty"` // short commit SHA
	Phase      string `json:"phase,omitempty"`    // last operation: Succeeded | Failed | Running
	FinishedAt string `json:"finishedAt,omitempty"`
}

// xrStatus is the slice of an XTenantApp the portal surfaces.
//
// Ready/Created come from the composition's own status write-back rather than
// Crossplane's Ready condition, which lags behind reality because of watch
// circuit throttling.
type xrStatus struct {
	Available bool   `json:"available"`
	Ready     bool   `json:"ready"`
	Created   bool   `json:"created"`
	URL       string `json:"url,omitempty"`
	Image     string `json:"image,omitempty"`
	Namespace string `json:"namespace,omitempty"`
}

// envStatus is one environment on one cluster.
type envStatus struct {
	Env         string              `json:"env"`
	ClusterID   string              `json:"clusterId"`
	ClusterName string              `json:"clusterName"`
	Argo        argoStatus          `json:"argo"`
	XR          xrStatus            `json:"xr"`
	Links       observability.Links `json:"links"`

	// Unavailable explains why a cell has no data:
	//
	//	forbidden   RBAC prerequisite not applied (operator action needed)
	//	not-found   application not deployed to this environment (normal)
	//	unreachable cluster or API server did not answer
	//
	// Empty when data was read successfully. The distinction matters: an
	// un-promoted environment must not render as an outage.
	Unavailable string `json:"unavailable,omitempty"`
}

// envResponse is the endpoint payload.
//
// GrafanaURL/ArgoCDURL ship here rather than as NEXT_PUBLIC_* build args so an
// operator can repoint a dashboard without rebuilding the image — the same
// reason GetPromoStatus returns vaultAddr.
type envResponse struct {
	GrafanaURL   string      `json:"grafanaUrl,omitempty"`
	ArgoCDURL    string      `json:"argocdUrl,omitempty"`
	Environments []envStatus `json:"environments"`
}

// NewObservabilityHandler constructs an ObservabilityHandler.
// broker is shared with ClusterHandler so both reuse one credential cache.
func NewObservabilityHandler(store *catalog.Store, registry cluster.Registry, broker *CredentialBroker, cfg *config.Config) *ObservabilityHandler {
	return &ObservabilityHandler{
		store:    store,
		registry: registry,
		broker:   broker,
		argoNS:   cfg.ArgoCDNamespace,
		alerts:   alertmanager.New(cfg.AlertmanagerURL),
		links: observability.Config{
			GrafanaURL:           cfg.LGTMGrafanaURL,
			LokiDatasource:       cfg.LGTMLokiDatasource,
			TempoDatasource:      cfg.LGTMTempoDatasource,
			PrometheusDatasource: cfg.LGTMPrometheusDatasource,
			PyroscopeDatasource:  cfg.LGTMPyroscopeDatasource,
			ArgoCDURL:            cfg.ArgoCDURL,
			ArgoCDNamespace:      cfg.ArgoCDNamespace,
		},
	}
}

// GetEnvironments returns live per-environment status for a Component.
//
//	GET /api/v1/catalog/entities/:kind/:name/environments
//
// @Summary		Runtime environment status
// @Description	Live ArgoCD sync/health and Crossplane XR status per environment, plus Grafana deep links. Read with the caller's own Kubernetes RBAC.
// @Tags		catalog
// @Produce		json
// @Param		kind	path	string	true	"Entity kind"
// @Param		name	path	string	true	"Entity name"
// @Success		200	{object}	map[string]interface{}
// @Failure		404	{object}	map[string]string
// @Failure		422	{object}	map[string]string
// @Router		/api/v1/catalog/entities/{kind}/{name}/environments [get]
func (h *ObservabilityHandler) GetEnvironments(c *gin.Context) {
	kind, name := c.Param("kind"), c.Param("name")

	session := auth.GetSession(c)
	if session == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}

	team, appName, ok := h.resolveTeamApp(c, kind, name)
	if !ok {
		return
	}

	cacheKey := session.Sub + ":" + kind + "/" + name
	if v, hit := h.cache.Load(cacheKey); hit {
		entry := v.(obsCacheEntry)
		if time.Since(entry.cachedAt) < obsCacheTTL {
			c.JSON(http.StatusOK, entry.payload)
			return
		}
	}

	clusters, err := h.registry.ListClusters(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	namespace := scaffold.DefaultNamespace(team)
	payload := envResponse{
		GrafanaURL:   h.links.GrafanaURL,
		ArgoCDURL:    h.links.ArgoCDURL,
		Environments: make([]envStatus, 0, len(envOrder)*len(clusters)),
	}

	for _, cl := range clusters {
		// One unreachable cluster degrades only its own cells.
		spoke, credStatus, clientErr := h.broker.SpokeClientFor(c, &cl)

		// A 401 means the session itself can no longer be exchanged — that is a
		// re-login, not a cluster outage. Surface it so the frontend can react
		// instead of painting every environment as unreachable. Nothing is
		// cached, so the next request retries cleanly.
		if clientErr != nil && credStatus == http.StatusUnauthorized {
			c.JSON(http.StatusUnauthorized, gin.H{"error": clientErr.Error()})
			return
		}

		for _, env := range envOrder {
			st := envStatus{
				Env:         env,
				ClusterID:   cl.ID,
				ClusterName: cl.Name,
				Links:       h.links.BuildLinks(namespace, appName, env, argoAppName(team, appName, env)),
			}

			if clientErr != nil {
				st.Unavailable = "unreachable"
				payload.Environments = append(payload.Environments, st)
				continue
			}

			h.readArgo(c, spoke, &st, team, appName, env)
			h.readXR(c, spoke, &st, team, appName, env)

			payload.Environments = append(payload.Environments, st)
		}
	}

	h.cache.Store(cacheKey, obsCacheEntry{payload: payload, cachedAt: time.Now()})
	c.JSON(http.StatusOK, payload)
}

// argoAppName builds the ArgoCD Application name the tenants-apps
// ApplicationSet generates: {team}-{app}-{env}.
func argoAppName(team, appName, env string) string {
	return fmt.Sprintf("%s-%s-%s", team, appName, env)
}

// xrName builds the XTenantApp name for an environment.
//
// The dev overlay uses the base XR unchanged; staging and production patch in a
// rename so each environment gets a distinct cluster-scoped object. This must
// stay in step with buildOverlayKustomization in internal/scaffold/overlay.go.
func xrName(team, appName, env string) string {
	base := team + "-" + appName
	if env == "staging" || env == "production" {
		return base + "-" + env
	}
	return base
}

// readArgo fills the ArgoCD half of a cell.
func (h *ObservabilityHandler) readArgo(c *gin.Context, spoke *cluster.SpokeClient, st *envStatus, team, appName, env string) {
	raw, err := spoke.GetArgoApplication(c.Request.Context(), h.argoNS, argoAppName(team, appName, env))
	if err != nil {
		st.Unavailable = unavailableReason(err)
		return
	}

	var app struct {
		Status struct {
			Sync struct {
				Status   string `json:"status"`
				Revision string `json:"revision"`
			} `json:"sync"`
			Health struct {
				Status string `json:"status"`
			} `json:"health"`
			OperationState struct {
				Phase      string `json:"phase"`
				FinishedAt string `json:"finishedAt"`
			} `json:"operationState"`
		} `json:"status"`
	}
	if err := json.Unmarshal(raw, &app); err != nil {
		log.Printf("[observability] warning: parse Application %s: %v", argoAppName(team, appName, env), err)
		st.Unavailable = "unreachable"
		return
	}

	st.Argo = argoStatus{
		Available:  true,
		Sync:       app.Status.Sync.Status,
		Health:     app.Status.Health.Status,
		Revision:   shortRevision(app.Status.Sync.Revision),
		Phase:      app.Status.OperationState.Phase,
		FinishedAt: app.Status.OperationState.FinishedAt,
	}
}

// readXR fills the Crossplane half of a cell.
//
// A missing XR is not reported as unavailable when ArgoCD already answered:
// during a first sync the Application exists before the composite is created,
// and surfacing that as an error would make a healthy deploy look broken.
func (h *ObservabilityHandler) readXR(c *gin.Context, spoke *cluster.SpokeClient, st *envStatus, team, appName, env string) {
	raw, err := spoke.GetXTenantApp(c.Request.Context(), xrName(team, appName, env))
	if err != nil {
		if !st.Argo.Available && st.Unavailable == "" {
			st.Unavailable = unavailableReason(err)
		}
		return
	}

	var xr struct {
		Status struct {
			Created   bool   `json:"created"`
			Ready     bool   `json:"ready"`
			URL       string `json:"url"`
			Image     string `json:"image"`
			Namespace string `json:"namespace"`
		} `json:"status"`
	}
	if err := json.Unmarshal(raw, &xr); err != nil {
		log.Printf("[observability] warning: parse XTenantApp %s: %v", xrName(team, appName, env), err)
		return
	}

	st.XR = xrStatus{
		Available: true,
		Ready:     xr.Status.Ready,
		Created:   xr.Status.Created,
		URL:       xr.Status.URL,
		Image:     xr.Status.Image,
		Namespace: xr.Status.Namespace,
	}
	// Clear a not-found recorded by the ArgoCD read: the workload demonstrably
	// exists even if the Application is absent (e.g. applied outside ArgoCD).
	if st.Unavailable == "not-found" {
		st.Unavailable = ""
	}
}

// unavailableReason maps a spoke read error onto the frontend's vocabulary.
func unavailableReason(err error) string {
	switch {
	case errors.Is(err, cluster.ErrForbidden):
		return "forbidden"
	case errors.Is(err, cluster.ErrNotFound):
		return "not-found"
	default:
		return "unreachable"
	}
}

// shortRevision trims a git SHA to the 7 characters used everywhere else in the
// portal (image tags, CI runs), leaving non-SHA revisions such as branch names
// untouched.
func shortRevision(rev string) string {
	if len(rev) > 7 && !strings.ContainsAny(rev, "/.") {
		return rev[:7]
	}
	return rev
}

// resolveTeamApp maps an entity to its (team, appName) pair.
//
// Both come from the gitea/source-location annotation — the same derivation
// the scaffold and promotion paths use. metadata.name is deliberately not used:
// it diverges for Vault and database entities, which are named
// "{appName}-vault" and would resolve to the wrong repo and namespace.
//
// Writes the error response and returns ok=false when the entity is missing or
// unscaffolded, so callers just `if !ok { return }`.
func (h *ObservabilityHandler) resolveTeamApp(c *gin.Context, kind, name string) (team, appName string, ok bool) {
	entity, err := h.store.Get(c.Request.Context(), kind, name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return "", "", false
	}

	loc := entity.Metadata.Annotations["gitea/source-location"]
	parts := strings.SplitN(loc, "/", 2)
	if loc == "" || len(parts) != 2 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "entity has no gitea/source-location annotation"})
		return "", "", false
	}

	return parts[0], parts[1], true
}

// GetEntityAlerts returns the alerts currently firing for a Component.
//
//	GET /api/v1/catalog/entities/:kind/:name/alerts
//
// Answers one question — "is this service broken right now?" — and nothing
// more: no silencing, no acknowledgement, no history. Those belong in
// Alertmanager's own UI, which the response links to.
//
// When ALERTMANAGER_URL is unset the endpoint reports enabled=false rather
// than erroring, so the frontend can hide the panel without special-casing a
// failure.
//
// @Summary		Active alerts for an entity
// @Description	Alerts currently firing for this application, read from Alertmanager. Returns enabled=false when Alertmanager is not configured.
// @Tags		catalog
// @Produce		json
// @Param		kind	path	string	true	"Entity kind"
// @Param		name	path	string	true	"Entity name"
// @Success		200	{object}	map[string]interface{}
// @Failure		404	{object}	map[string]string
// @Failure		422	{object}	map[string]string
// @Router		/api/v1/catalog/entities/{kind}/{name}/alerts [get]
func (h *ObservabilityHandler) GetEntityAlerts(c *gin.Context) {
	kind, name := c.Param("kind"), c.Param("name")

	if h.alerts == nil {
		c.JSON(http.StatusOK, gin.H{"enabled": false, "alerts": []alertmanager.Alert{}})
		return
	}

	team, appName, ok := h.resolveTeamApp(c, kind, name)
	if !ok {
		return
	}

	namespace := scaffold.DefaultNamespace(team)

	found, err := h.alerts.ListForApp(c.Request.Context(), namespace, appName)
	if err != nil {
		// Alertmanager being down must not read as "this service is fine".
		log.Printf("[observability] warning: alertmanager query for %s/%s: %v", namespace, appName, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "alertmanager unreachable"})
		return
	}

	if found == nil {
		found = []alertmanager.Alert{}
	}

	c.JSON(http.StatusOK, gin.H{
		"enabled":   true,
		"namespace": namespace,
		"alerts":    found,
	})
}
