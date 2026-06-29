package handlers

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/wxops/wxops-portal-v2/internal/auth"
	"github.com/wxops/wxops-portal-v2/internal/catalog"
	"github.com/wxops/wxops-portal-v2/internal/config"
	"github.com/wxops/wxops-portal-v2/internal/gitea"
	"gopkg.in/yaml.v3"
)

// isAbsoluteURL returns true when s begins with http:// or https://.
func isAbsoluteURL(s string) bool {
	return strings.HasPrefix(s, "https://") || strings.HasPrefix(s, "http://")
}

// SpecFetcher retrieves a raw OpenAPI/AsyncAPI spec from a remote URL.
// Implemented by *gitea.Client in production; nil disables Gitea-authenticated fetching.
type SpecFetcher interface {
	FetchURL(ctx context.Context, url string) ([]byte, error)
}

// CatalogHandler serves catalog entity endpoints.
type CatalogHandler struct {
	store       *catalog.Store
	specFetcher SpecFetcher    // nil in local-dev mode
	giteaClient *gitea.Client  // nil when Gitea is not configured
	cfg         *config.Config // nil when write path is disabled

	portalLabelID   int64
	portalLabelOnce sync.Once
}

// NewCatalogHandler constructs a CatalogHandler.
// gc and cfg may be nil — the write endpoint (UpdateEntity) will return 503.
func NewCatalogHandler(store *catalog.Store, fetcher SpecFetcher, gc *gitea.Client, cfg *config.Config) *CatalogHandler {
	return &CatalogHandler{store: store, specFetcher: fetcher, giteaClient: gc, cfg: cfg}
}

// isValidWebhookToken checks the Authorization header for a valid Bearer token
// matching the configured WEBHOOK_TOKEN. Returns false if no token is configured.
func (h *CatalogHandler) isValidWebhookToken(c *gin.Context) bool {
	if h.cfg == nil || h.cfg.WebhookToken == "" {
		return false
	}
	header := c.GetHeader("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return false
	}
	return strings.TrimPrefix(header, "Bearer ") == h.cfg.WebhookToken
}

func (h *CatalogHandler) ensurePortalLabel(ctx context.Context) int64 {
	h.portalLabelOnce.Do(func() {
		if h.giteaClient == nil || h.cfg == nil {
			return
		}
		id, err := h.giteaClient.EnsureLabel(ctx, h.cfg.GiteaCatalogOwner, h.cfg.GiteaCatalogRepo, PortalLabelName, portalLabelColor)
		if err != nil {
			log.Printf("[catalog] warning: failed to ensure portal label: %v", err)
			return
		}
		h.portalLabelID = id
	})
	return h.portalLabelID
}

// ListEntities returns all catalog entities, optionally filtered by kind.
//
// @Summary      List catalog entities
// @Description  Returns all catalog entities. Use ?kind= to filter by entity kind (case-insensitive).
// @Tags         catalog
// @Produce      json
// @Param        kind  query   string  false  "Filter by kind (Component, API, System, Group, Resource, User, Doc)"
// @Success      200   {object}  map[string]interface{}  "entities array"
// @Failure      502   {object}  map[string]string
// @Security     CookieAuth
// @Router       /api/v1/catalog/entities [get]
func (h *CatalogHandler) ListEntities(c *gin.Context) {
	kind := c.Query("kind")

	var (
		entities []catalog.Entity
		err      error
	)
	if kind != "" {
		entities, err = h.store.ListByKind(c.Request.Context(), kind)
	} else {
		entities, err = h.store.ListAll(c.Request.Context())
	}
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	// Filter draft docs — only visible to owner team members.
	session := auth.GetSession(c)
	var visible []catalog.Entity
	for _, e := range entities {
		if e.Kind == "Doc" && e.Spec.Draft != nil && *e.Spec.Draft {
			if session == nil {
				continue
			}
			team := auth.OwnerTeam(e.Spec.Owner)
			if team != "" && !auth.MemberOfTeam(session.Groups, team) {
				continue
			}
		}
		visible = append(visible, e)
	}
	if visible == nil {
		visible = []catalog.Entity{}
	}

	// Pagination: limit=0 returns all (backward compat for detail page related-docs lookup).
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "0"))
	if page < 1 {
		page = 1
	}

	total := len(visible)
	if limit > 0 {
		start := (page - 1) * limit
		end := start + limit
		if start > total {
			start = total
		}
		if end > total {
			end = total
		}
		visible = visible[start:end]
	}

	c.JSON(http.StatusOK, gin.H{"entities": visible, "total": total, "page": page, "limit": limit})
}

// GetEntity returns a single entity by kind and name.
//
// @Summary      Get catalog entity
// @Description  Returns a single catalog entity by kind and name.
// @Tags         catalog
// @Produce      json
// @Param        kind  path    string  true  "Entity kind (Component, API, System, Group, Resource, User, Doc)"
// @Param        name  path    string  true  "Entity name"
// @Success      200   {object}  catalog.Entity
// @Failure      404   {object}  map[string]string
// @Security     CookieAuth
// @Router       /api/v1/catalog/entities/{kind}/{name} [get]
func (h *CatalogHandler) GetEntity(c *gin.Context) {
	kind := c.Param("kind")
	name := c.Param("name")

	entity, err := h.store.Get(c.Request.Context(), kind, name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	// Draft docs are only visible to owner team members.
	if entity.Kind == "Doc" && entity.Spec.Draft != nil && *entity.Spec.Draft {
		session := auth.GetSession(c)
		team := auth.OwnerTeam(entity.Spec.Owner)
		if session == nil || (team != "" && !auth.MemberOfTeam(session.Groups, team)) {
			c.JSON(http.StatusNotFound, gin.H{"error": "entity Doc/" + name + " not found"})
			return
		}
	}

	c.JSON(http.StatusOK, entity)
}

// GetEntitySpec returns the raw OpenAPI/AsyncAPI spec for an API entity.
//
// Resolution order:
//  1. spec.definition — inline YAML in the catalog file
//  2. metadata.links entry with type "openapi" via the configured Gitea fetcher
//  3. metadata.links entry with type "openapi" and an absolute URL — plain HTTP GET
//
// @Summary      Get API spec
// @Description  Returns the raw OpenAPI/AsyncAPI spec for an API entity. Resolves from inline definition or an openapi-typed link URL.
// @Tags         catalog
// @Produce      plain
// @Param        kind  path    string  true  "Entity kind (usually API)"
// @Param        name  path    string  true  "Entity name"
// @Success      200   {string}  string  "Raw OpenAPI YAML or JSON"
// @Failure      404   {object}  map[string]string
// @Security     CookieAuth
// @Router       /api/v1/catalog/entities/{kind}/{name}/spec [get]
func (h *CatalogHandler) GetEntitySpec(c *gin.Context) {
	kind := c.Param("kind")
	name := c.Param("name")

	entity, err := h.store.Get(c.Request.Context(), kind, name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	// Priority 1: inline definition in the catalog YAML.
	if entity.Spec.Definition != "" {
		c.Data(http.StatusOK, "text/yaml; charset=utf-8", []byte(entity.Spec.Definition))
		return
	}

	// Priority 2–4: find a link typed "openapi" and try each resolution strategy.
	for _, link := range entity.Metadata.Links {
		if link.Type != "openapi" {
			continue
		}

		if !isAbsoluteURL(link.URL) {
			// Priority 2: relative path — read the committed spec file directly from
			// the catalog repository (local dir in dev, Gitea in production).
			// This is the recommended approach for private projects: run `swag init`,
			// commit the generated JSON alongside your catalog YAML files, and
			// reference it with a relative path. No HTTP endpoint needed.
			data, fetchErr := h.store.GetFileContent(c.Request.Context(), link.URL)
			if fetchErr == nil {
				c.Data(http.StatusOK, specContentType(link.URL), data)
				return
			}
			continue // file not found — try the next link
		}

		// Priority 3: absolute URL + Gitea-authenticated fetch (private Gitea repos).
		if h.specFetcher != nil {
			data, fetchErr := h.specFetcher.FetchURL(c.Request.Context(), link.URL)
			if fetchErr == nil && data != nil {
				c.Data(http.StatusOK, "text/yaml; charset=utf-8", data)
				return
			}
		}

		// Priority 4: absolute URL — plain HTTP GET for public/same-network endpoints
		// (e.g., SWAGGER_ENABLED=true backend swagger, or external service swagger URLs).
		data, ct, fetchErr := httpGet(c.Request.Context(), link.URL)
		if fetchErr == nil {
			if ct == "" {
				ct = "application/json"
			}
			c.Data(http.StatusOK, ct, data)
			return
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "no spec available for " + kind + "/" + name})
}

// specContentType infers the MIME type from a spec file's extension.
func specContentType(filename string) string {
	if strings.HasSuffix(filename, ".yaml") || strings.HasSuffix(filename, ".yml") {
		return "text/yaml; charset=utf-8"
	}
	return "application/json"
}

// httpGet performs a plain unauthenticated GET and returns the body + Content-Type.
func httpGet(ctx context.Context, url string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", err
	}
	return body, resp.Header.Get("Content-Type"), nil
}

// CreateEntity registers a new catalog entity.
// Returns 409 if an entity with the same kind/name already exists.
//
// @Summary      Register a new catalog entity
// @Description  Creates a new catalog entity. Returns 409 Conflict if it already exists.
// @Tags         catalog
// @Accept       json
// @Produce      json
// @Param        body  body    catalog.Entity  true  "Entity to create"
// @Success      201   {object}  map[string]any
// @Failure      400   {object}  map[string]string
// @Failure      409   {object}  map[string]string
// @Failure      503   {object}  map[string]string
// @Security     CookieAuth
// @Router       /api/v1/catalog/entities [post]
func (h *CatalogHandler) CreateEntity(c *gin.Context) {
	var entity catalog.Entity
	if err := c.ShouldBindJSON(&entity); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := entity.Validate(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Permission: user must be a member of the entity's owner team.
	if err := requireOwnership(c, entity.Spec.Owner); err != nil {
		return
	}

	// Conflict check — entity must not already exist.
	existing, _ := h.store.Get(c.Request.Context(), entity.Kind, entity.Metadata.Name)
	if existing != nil {
		c.JSON(http.StatusConflict, gin.H{
			"error": fmt.Sprintf("%s/%s already exists", entity.Kind, entity.Metadata.Name),
		})
		return
	}

	entityYAML, err := yaml.Marshal(&entity)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "marshal entity: " + err.Error()})
		return
	}

	// Local dev mode — write to disk.
	if h.cfg != nil && h.cfg.CatalogLocalDir != "" {
		relPath := entityRelPath(entity.Kind, entity.Spec.Owner, entity.Metadata.Name)
		fullPath := filepath.Join(h.cfg.CatalogLocalDir, relPath)

		if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "mkdir: " + err.Error()})
			return
		}
		if err := os.WriteFile(fullPath, entityYAML, 0o644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "write: " + err.Error()})
			return
		}

		h.store.InvalidateCache()
		log.Printf("[catalog] created entity: %s", fullPath)
		c.JSON(http.StatusCreated, gin.H{"entity": entity})
		return
	}

	// Gitea mode — commit via PR.
	if h.giteaClient == nil || h.cfg == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "catalog write not configured"})
		return
	}

	ctx := c.Request.Context()
	gitopsOwner := h.cfg.GiteaCatalogOwner
	gitopsRepo := h.cfg.GiteaCatalogRepo
	catalogPath := h.cfg.GiteaCatalogPath

	branchName := fmt.Sprintf("register/%s/%s-%d",
		strings.ToLower(entity.Kind), entity.Metadata.Name, time.Now().Unix())
	if err := h.giteaClient.CreateBranch(ctx, gitopsOwner, gitopsRepo, branchName, "main"); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "create branch: " + err.Error()})
		return
	}

	relPath := entityRelPath(entity.Kind, entity.Spec.Owner, entity.Metadata.Name)
	filePath := catalogPath + "/" + relPath
	commitMsg := fmt.Sprintf("feat(catalog): register %s %s", entity.Kind, entity.Metadata.Name)
	if _, err := h.giteaClient.CreateOrUpdateFile(ctx, gitopsOwner, gitopsRepo, filePath, entityYAML, commitMsg, branchName); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "commit: " + err.Error()})
		return
	}

	prTitle := fmt.Sprintf("[Catalog] Register %s/%s", entity.Kind, entity.Metadata.Name)
	prBody := fmt.Sprintf("Registered new `%s` entity `%s` via WxOps Portal.", entity.Kind, entity.Metadata.Name)
	regLabelID := h.ensurePortalLabel(ctx)
	if regLabelID > 0 {
		_, err = h.giteaClient.CreatePullRequest(ctx, gitopsOwner, gitopsRepo, prTitle, prBody, branchName, "main", regLabelID)
	} else {
		_, err = h.giteaClient.CreatePullRequest(ctx, gitopsOwner, gitopsRepo, prTitle, prBody, branchName, "main")
	}
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "create PR: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"entity": entity,
		"status": "Entity registered — PR opened for platform review",
	})
}

// UpdateEntity updates a catalog entity by writing the new YAML.
// In local-dev mode (CATALOG_LOCAL_DIR set) writes directly to disk and
// invalidates the cache. In Gitea mode, creates a branch, commits the
// updated file, and opens a PR.
//
// @Summary      Update catalog entity
// @Description  Updates a catalog entity. Commits via PR in production or writes to disk in dev mode.
// @Tags         catalog
// @Accept       json
// @Produce      json
// @Param        kind  path    string          true  "Entity kind"
// @Param        name  path    string          true  "Entity name"
// @Param        body  body    catalog.Entity  true  "Updated entity"
// @Success      200   {object}  map[string]any
// @Failure      400   {object}  map[string]string
// @Failure      503   {object}  map[string]string
// @Security     CookieAuth
// @Router       /api/v1/catalog/entities/{kind}/{name} [put]
func (h *CatalogHandler) UpdateEntity(c *gin.Context) {
	kind := c.Param("kind")
	name := c.Param("name")

	var entity catalog.Entity
	if err := c.ShouldBindJSON(&entity); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Ensure URL params match the body.
	if !strings.EqualFold(entity.Kind, kind) || !strings.EqualFold(entity.Metadata.Name, name) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kind/name in URL must match the body"})
		return
	}

	if err := entity.Validate(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Permission: check against the EXISTING entity's owner (not the submitted one,
	// to prevent ownership hijack by changing spec.owner in the request body).
	existing, _ := h.store.Get(c.Request.Context(), kind, name)
	if existing != nil {
		if err := requireOwnership(c, existing.Spec.Owner); err != nil {
			return
		}
	}

	entityYAML, err := yaml.Marshal(&entity)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "marshal entity: " + err.Error()})
		return
	}

	// Local dev mode — write to disk.
	if h.cfg != nil && h.cfg.CatalogLocalDir != "" {
		relPath := entityRelPath(entity.Kind, entity.Spec.Owner, entity.Metadata.Name)
		fullPath := filepath.Join(h.cfg.CatalogLocalDir, relPath)

		if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "mkdir: " + err.Error()})
			return
		}
		if err := os.WriteFile(fullPath, entityYAML, 0o644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "write: " + err.Error()})
			return
		}

		h.store.InvalidateCache()
		log.Printf("[catalog] updated entity: %s", fullPath)
		c.JSON(http.StatusOK, gin.H{"entity": entity})
		return
	}

	// Gitea mode — commit via PR.
	if h.giteaClient == nil || h.cfg == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "catalog write not configured"})
		return
	}

	ctx := c.Request.Context()
	gitopsOwner := h.cfg.GiteaCatalogOwner
	gitopsRepo := h.cfg.GiteaCatalogRepo
	catalogPath := h.cfg.GiteaCatalogPath

	branchName := fmt.Sprintf("edit/%s/%s-%d", strings.ToLower(kind), name, time.Now().Unix())
	if err := h.giteaClient.CreateBranch(ctx, gitopsOwner, gitopsRepo, branchName, "main"); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "create branch: " + err.Error()})
		return
	}

	relPath := entityRelPath(entity.Kind, entity.Spec.Owner, entity.Metadata.Name)
	filePath := catalogPath + "/" + relPath
	commitMsg := fmt.Sprintf("chore(catalog): update %s %s", kind, name)
	if _, err := h.giteaClient.CreateOrUpdateFile(ctx, gitopsOwner, gitopsRepo, filePath, entityYAML, commitMsg, branchName); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "commit: " + err.Error()})
		return
	}

	prTitle := fmt.Sprintf("[Catalog] Edit %s/%s", kind, name)
	prBody := fmt.Sprintf("Updated `%s` entity `%s` via WxOps Portal.", kind, name)
	editLabelID := h.ensurePortalLabel(ctx)
	if editLabelID > 0 {
		_, err = h.giteaClient.CreatePullRequest(ctx, gitopsOwner, gitopsRepo, prTitle, prBody, branchName, "main", editLabelID)
	} else {
		_, err = h.giteaClient.CreatePullRequest(ctx, gitopsOwner, gitopsRepo, prTitle, prBody, branchName, "main")
	}
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "create PR: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"entity": entity,
		"status": "Entity updated — PR opened for platform review",
	})
}

// DeleteEntity removes a catalog entity. Only platform-team can delete.
// In local-dev mode, deletes the file from disk. In Gitea mode, opens a PR.
//
// @Summary      Delete catalog entity
// @Description  Deletes a catalog entity. Only platform-team admins can delete.
// @Tags         catalog
// @Produce      json
// @Param        kind  path    string  true  "Entity kind"
// @Param        name  path    string  true  "Entity name"
// @Success      200   {object}  map[string]any
// @Failure      403   {object}  map[string]string
// @Failure      404   {object}  map[string]string
// @Security     CookieAuth
// @Router       /api/v1/catalog/entities/{kind}/{name} [delete]
func (h *CatalogHandler) DeleteEntity(c *gin.Context) {
	kind := c.Param("kind")
	name := c.Param("name")

	session := auth.GetSession(c)
	if session == nil || !auth.IsPlatformTeam(session.Groups) {
		c.JSON(http.StatusForbidden, gin.H{"error": "only platform-team can delete entities"})
		return
	}

	entity, err := h.store.Get(c.Request.Context(), kind, name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	relPath := entityRelPath(entity.Kind, entity.Spec.Owner, entity.Metadata.Name)

	// When deleting a System, ungroup all member entities instead of cascade-deleting.
	if entity.Kind == "System" {
		if ungroupErr := h.ungroupSystemMembers(c, entity.Metadata.Name); ungroupErr != nil {
			log.Printf("[catalog] warning: failed to ungroup members of %s: %v", entity.Metadata.Name, ungroupErr)
		}
	}

	// Local dev mode — delete file from disk.
	if h.cfg != nil && h.cfg.CatalogLocalDir != "" {
		fullPath := filepath.Join(h.cfg.CatalogLocalDir, relPath)
		if err := os.Remove(fullPath); err != nil && !os.IsNotExist(err) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "delete: " + err.Error()})
			return
		}

		h.store.InvalidateCache()
		log.Printf("[catalog] deleted entity: %s", fullPath)
		c.JSON(http.StatusOK, gin.H{"deleted": entity.Kind + "/" + entity.Metadata.Name})
		return
	}

	// Gitea mode — delete via PR.
	if h.giteaClient == nil || h.cfg == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "catalog write not configured"})
		return
	}

	ctx := c.Request.Context()
	gitopsOwner := h.cfg.GiteaCatalogOwner
	gitopsRepo := h.cfg.GiteaCatalogRepo
	catalogPath := h.cfg.GiteaCatalogPath

	branchName := fmt.Sprintf("delete/%s/%s-%d", strings.ToLower(kind), name, time.Now().Unix())
	if err := h.giteaClient.CreateBranch(ctx, gitopsOwner, gitopsRepo, branchName, "main"); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "create branch: " + err.Error()})
		return
	}

	filePath := catalogPath + "/" + relPath
	commitMsg := fmt.Sprintf("chore(catalog): delete %s %s", kind, name)
	if err := h.giteaClient.DeleteFile(ctx, gitopsOwner, gitopsRepo, filePath, commitMsg, branchName); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "delete file: " + err.Error()})
		return
	}

	prTitle := fmt.Sprintf("[Catalog] Delete %s/%s", kind, name)
	prBody := fmt.Sprintf("Deleted `%s` entity `%s` via WxOps Portal.", kind, name)
	delLabelID := h.ensurePortalLabel(ctx)
	if delLabelID > 0 {
		_, err = h.giteaClient.CreatePullRequest(ctx, gitopsOwner, gitopsRepo, prTitle, prBody, branchName, "main", delLabelID)
	} else {
		_, err = h.giteaClient.CreatePullRequest(ctx, gitopsOwner, gitopsRepo, prTitle, prBody, branchName, "main")
	}
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "create PR: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"deleted": entity.Kind + "/" + entity.Metadata.Name,
		"status":  "Delete PR opened for platform review",
	})
}

// ListActivity returns recent portal-generated PRs from the gitops-infra repository.
// Uses the "portal-managed" Gitea label to fetch only portal PRs — never exposes
// other gitops-infra changes. Falls back to title-prefix filtering if the label
// doesn't exist yet (pre-label PRs).
//
// @Summary      List catalog activity
// @Description  Returns recent portal-created PRs (scaffold, register, edit) from gitops-infra.
// @Tags         catalog
// @Produce      json
// @Param        state  query   string  false  "PR state: open, closed, all (default: all)"
// @Param        page   query   int     false  "Page number (default: 1)"
// @Param        limit  query   int     false  "Items per page (default: 20)"
// @Success      200   {object}  map[string]any
// @Security     CookieAuth
// @Router       /api/v1/catalog/activity [get]
func (h *CatalogHandler) ListActivity(c *gin.Context) {
	if h.giteaClient == nil {
		c.JSON(http.StatusOK, gin.H{"activity": []any{}, "total": 0, "page": 1, "limit": 20})
		return
	}

	state := c.DefaultQuery("state", "all")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 50 {
		limit = 20
	}

	// Try label-based filtering first (fast, only portal PRs).
	// If the label exists but returns 0 results on page 1, fall back to
	// title-prefix filtering to pick up old PRs that predate the label.
	labelID := h.ensurePortalLabel(c.Request.Context())
	usedLabel := false
	var prs []gitea.PullRequestInfo
	var totalPRs int
	var err error

	if labelID > 0 {
		prs, totalPRs, err = h.giteaClient.ListPullRequests(
			c.Request.Context(),
			h.cfg.GiteaCatalogOwner,
			h.cfg.GiteaCatalogRepo,
			state, page, limit,
			labelID,
		)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		usedLabel = true

		// Label returned nothing on page 1 — old PRs don't have the label yet.
		// Fall back to fetching all PRs and filtering by title prefix.
		if len(prs) == 0 && page == 1 {
			usedLabel = false
			prs, totalPRs, err = h.giteaClient.ListPullRequests(
				c.Request.Context(),
				h.cfg.GiteaCatalogOwner,
				h.cfg.GiteaCatalogRepo,
				state, page, limit,
			)
			if err != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
				return
			}
		}
	} else {
		prs, totalPRs, err = h.giteaClient.ListPullRequests(
			c.Request.Context(),
			h.cfg.GiteaCatalogOwner,
			h.cfg.GiteaCatalogRepo,
			state, page, limit,
		)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
	}

	session := auth.GetSession(c)
	isPlatform := session != nil && auth.IsPlatformTeam(session.Groups)
	userTeams := map[string]bool{}
	if session != nil {
		for _, g := range session.Groups {
			userTeams[g] = true
		}
	}

	var activity []gin.H
	for _, pr := range prs {
		// Without label filtering, only show portal PRs by title prefix.
		if !usedLabel && !isPortalPR(pr.Title) {
			continue
		}

		// Tenant-level filtering: non-platform users only see their own team's PRs.
		if !isPlatform {
			team := activityPRTeam(pr.Title, h.store, c.Request.Context())
			if !userTeams[team] {
				continue
			}
		}

		author := ""
		if pr.User != nil {
			author = pr.User.Login
		}
		entry := gin.H{
			"number":    pr.Number,
			"title":     pr.Title,
			"state":     pr.State,
			"merged":    pr.Merged,
			"mergedAt":  pr.MergedAt,
			"author":    author,
			"createdAt": pr.CreatedAt,
			"updatedAt": pr.UpdatedAt,
		}

		if pr.State == "closed" && !pr.Merged {
			if comment, err := h.giteaClient.GetLastPRComment(
				c.Request.Context(),
				h.cfg.GiteaCatalogOwner,
				h.cfg.GiteaCatalogRepo,
				pr.Number,
			); err == nil && comment != nil {
				commentAuthor := ""
				if comment.User != nil {
					commentAuthor = comment.User.Login
				}
				entry["closeComment"] = comment.Body
				entry["closeCommentBy"] = commentAuthor
			}
		}

		activity = append(activity, entry)
	}
	if activity == nil {
		activity = []gin.H{}
	}

	// With label filter, Gitea's total is accurate. Without, we filtered
	// client-side so use the filtered count.
	total := totalPRs
	if !usedLabel {
		total = len(activity)
	}

	c.JSON(http.StatusOK, gin.H{
		"activity": activity,
		"total":    total,
		"page":     page,
		"limit":    limit,
	})
}

func isPortalPR(title string) bool {
	return strings.HasPrefix(title, "[Scaffold]") ||
		strings.HasPrefix(title, "[Catalog]") ||
		strings.HasPrefix(title, "[Config]")
}

// activityPRTeam extracts the owning team from a portal-generated PR title.
func activityPRTeam(title string, store *catalog.Store, ctx context.Context) string {
	// [Scaffold] New project: team/app  OR  feat(scaffold): team/app ...
	if strings.HasPrefix(title, "[Scaffold]") || strings.HasPrefix(title, "feat(scaffold)") {
		return extractTeamSlash(title)
	}

	// [Config] Update team/app
	if strings.HasPrefix(title, "[Config]") {
		return extractTeamSlash(title)
	}

	// [Catalog] Register|Edit|Delete Kind/name — look up entity owner
	// Also handles feat(catalog) and chore(catalog) prefixes.
	if strings.HasPrefix(title, "[Catalog]") ||
		strings.HasPrefix(title, "feat(catalog)") ||
		strings.HasPrefix(title, "chore(catalog)") {
		return catalogPRTeam(title, store, ctx)
	}

	return ""
}

// extractTeamSlash finds "team/something" in a title and returns team.
func extractTeamSlash(title string) string {
	parts := strings.Fields(title)
	for i := len(parts) - 1; i >= 0; i-- {
		if slash := strings.Index(parts[i], "/"); slash > 0 {
			return parts[i][:slash]
		}
	}
	return ""
}

// catalogPRTeam looks up the entity referenced in a catalog PR title.
func catalogPRTeam(title string, store *catalog.Store, ctx context.Context) string {
	parts := strings.Fields(title)
	if len(parts) < 2 {
		return ""
	}
	ref := parts[len(parts)-1]
	if slash := strings.Index(ref, "/"); slash > 0 {
		kind := ref[:slash]
		name := ref[slash+1:]
		if entity, err := store.Get(ctx, kind, name); err == nil {
			return auth.OwnerTeam(entity.Spec.Owner)
		}
	}
	return ""
}

// requireOwnership checks that the current session user is a member of the
// entity's owner team (or is platform-team). Returns nil on success.
// On failure it writes a 403 response and returns a non-nil error.
func requireOwnership(c *gin.Context, owner string) error {
	session := auth.GetSession(c)
	if session == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return fmt.Errorf("not authenticated")
	}
	team := auth.OwnerTeam(owner)
	if team == "" {
		// No owner set — only platform-team can manage unowned entities.
		if !auth.IsPlatformTeam(session.Groups) {
			c.JSON(http.StatusForbidden, gin.H{"error": "only platform-team can manage entities without an owner"})
			return fmt.Errorf("forbidden")
		}
		return nil
	}
	if !auth.MemberOfTeam(session.Groups, team) {
		c.JSON(http.StatusForbidden, gin.H{
			"error":  fmt.Sprintf("you must be a member of %q to modify this entity", team),
			"groups": session.Groups,
		})
		return fmt.Errorf("forbidden")
	}
	return nil
}

// entityRelPath derives the file path relative to the catalog root.
// owner "group:rocket-team" → team "rocket-team"; kind "Component" → dir "components".
// ungroupSystemMembers clears spec.system on all entities that belong to the
// given system name, turning them into ungrouped entities. In local-dev mode
// this writes directly to disk; in Gitea mode it's a best-effort operation
// (the member updates are included in the same branch as the delete).
func (h *CatalogHandler) ungroupSystemMembers(c *gin.Context, systemName string) error {
	all, err := h.store.ListAll(c.Request.Context())
	if err != nil {
		return err
	}

	for _, e := range all {
		if e.Spec.System != systemName {
			continue
		}
		e.Spec.System = ""
		entityYAML, err := yaml.Marshal(&e)
		if err != nil {
			continue
		}

		if h.cfg != nil && h.cfg.CatalogLocalDir != "" {
			relPath := entityRelPath(e.Kind, e.Spec.Owner, e.Metadata.Name)
			fullPath := filepath.Join(h.cfg.CatalogLocalDir, relPath)
			_ = os.WriteFile(fullPath, entityYAML, 0o644)
			log.Printf("[catalog] ungrouped %s/%s from system %s", e.Kind, e.Metadata.Name, systemName)
		}
	}

	if h.cfg != nil && h.cfg.CatalogLocalDir != "" {
		h.store.InvalidateCache()
	}
	return nil
}

func entityRelPath(kind, owner, name string) string {
	team := owner
	if _, after, ok := strings.Cut(owner, ":"); ok {
		team = after
	}
	if team == "" {
		team = "default"
	}
	dir := catalog.KindDir(kind)
	return fmt.Sprintf("%s/%s/%s.yaml", team, dir, name)
}

// resolveEntityRepo looks up an entity and extracts the Gitea owner+repo
// from the "gitea/source-location" annotation (format: "team/repoName").
func (h *CatalogHandler) resolveEntityRepo(c *gin.Context) (string, string, *catalog.Entity, error) {
	kind := c.Param("kind")
	name := c.Param("name")

	entity, err := h.store.Get(c.Request.Context(), kind, name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return "", "", nil, err
	}

	loc := entity.Metadata.Annotations["gitea/source-location"]
	if loc == "" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "entity has no gitea/source-location annotation"})
		return "", "", nil, fmt.Errorf("no source location")
	}

	parts := strings.SplitN(loc, "/", 2)
	if len(parts) != 2 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "invalid gitea/source-location format"})
		return "", "", nil, fmt.Errorf("invalid source location")
	}
	return parts[0], parts[1], entity, nil
}

// GetEntityCI returns recent CI/CD workflow runs for an entity's source repo.
//
// @Summary      Get CI status
// @Description  Returns recent Gitea Actions workflow runs for the entity's source repo.
// @Tags         catalog
// @Produce      json
// @Param        kind  path  string  true  "Entity kind"
// @Param        name  path  string  true  "Entity name"
// @Success      200  {object}  map[string]any
// @Security     CookieAuth
// @Router       /api/v1/catalog/entities/{kind}/{name}/ci [get]
func (h *CatalogHandler) GetEntityCI(c *gin.Context) {
	owner, repo, _, err := h.resolveEntityRepo(c)
	if err != nil {
		return
	}
	if h.giteaClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Gitea not configured"})
		return
	}

	runs, err := h.giteaClient.ListWorkflowRuns(c.Request.Context(), owner, repo, 5)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if runs == nil {
		runs = []gitea.WorkflowRun{}
	}
	c.JSON(http.StatusOK, gin.H{"runs": runs})
}

// GetEntityReleases returns releases and container images for an entity's source repo.
//
// @Summary      Get releases and container images
// @Description  Returns Gitea Releases and container images from the Package Registry.
// @Tags         catalog
// @Produce      json
// @Param        kind  path  string  true  "Entity kind"
// @Param        name  path  string  true  "Entity name"
// @Success      200  {object}  map[string]any
// @Security     CookieAuth
// @Router       /api/v1/catalog/entities/{kind}/{name}/releases [get]
func (h *CatalogHandler) GetEntityReleases(c *gin.Context) {
	owner, repo, _, err := h.resolveEntityRepo(c)
	if err != nil {
		return
	}
	if h.giteaClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Gitea not configured"})
		return
	}

	ctx := c.Request.Context()
	releases, err := h.giteaClient.ListReleases(ctx, owner, repo, 10)
	if err != nil {
		releases = []gitea.Release{}
	}

	// Fetch container images and filter by repo name.
	allPackages, _ := h.giteaClient.ListContainerPackages(ctx, owner, 20)
	var images []gitea.ContainerPackage
	for _, p := range allPackages {
		if p.Name == repo {
			images = append(images, p)
		}
	}
	if images == nil {
		images = []gitea.ContainerPackage{}
	}

	c.JSON(http.StatusOK, gin.H{"releases": releases, "images": images})
}

// GetEntityPackages returns parsed dependency manifests from the entity's source repo.
//
// @Summary      Get package dependencies
// @Description  Reads go.mod, package.json, requirements.txt, pyproject.toml from the source repo.
// @Tags         catalog
// @Produce      json
// @Param        kind  path  string  true  "Entity kind"
// @Param        name  path  string  true  "Entity name"
// @Success      200  {object}  map[string]any
// @Security     CookieAuth
// @Router       /api/v1/catalog/entities/{kind}/{name}/packages [get]
func (h *CatalogHandler) GetEntityPackages(c *gin.Context) {
	owner, repo, entity, err := h.resolveEntityRepo(c)
	if err != nil {
		return
	}
	if h.giteaClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Gitea not configured"})
		return
	}

	manifests, err := gitea.DiscoverPackages(c.Request.Context(), h.giteaClient, owner, repo)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	templateID := ""
	if entity != nil {
		templateID = entity.Metadata.Annotations["wxops.cloud/template-id"]
	}

	c.JSON(http.StatusOK, gin.H{"manifests": manifests, "templateId": templateID})
}

// GetDocContent returns the raw markdown content for a Doc entity.
//
// @Summary      Get document content
// @Description  Returns the raw Markdown content for a Doc entity. Fetches from spec.contentUrl via the Gitea client or the local reader.
// @Tags         catalog
// @Produce      plain
// @Param        kind  path    string  true  "Must be Doc"
// @Param        name  path    string  true  "Document name"
// @Success      200   {string}  string  "Markdown content"
// @Failure      400   {object}  map[string]string
// @Failure      404   {object}  map[string]string
// @Security     CookieAuth
// @Router       /api/v1/catalog/entities/{kind}/{name}/content [get]
func (h *CatalogHandler) GetDocContent(c *gin.Context) {
	kind := c.Param("kind")
	name := c.Param("name")

	if !strings.EqualFold(kind, "Doc") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "content endpoint is only available for Doc entities"})
		return
	}

	entity, err := h.store.Get(c.Request.Context(), "Doc", name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if entity.Spec.ContentURL == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "doc " + name + " has no contentUrl"})
		return
	}

	var (
		data     []byte
		fetchErr error
	)

	if isAbsoluteURL(entity.Spec.ContentURL) {
		// Try Gitea-authenticated fetch first (private repos), then plain HTTP.
		if h.specFetcher != nil {
			data, fetchErr = h.specFetcher.FetchURL(c.Request.Context(), entity.Spec.ContentURL)
		}
		if data == nil {
			data, _, fetchErr = httpGet(c.Request.Context(), entity.Spec.ContentURL)
		}
	} else {
		data, fetchErr = h.store.GetFileContent(c.Request.Context(), entity.Spec.ContentURL)
	}

	if fetchErr != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fetchErr.Error()})
		return
	}
	c.Data(http.StatusOK, "text/markdown; charset=utf-8", data)
}

// PromoteLifecycle transitions an entity's lifecycle field and commits the
// updated YAML directly to main. Intended to be called by ArgoCD notifications
// (post-sync webhook) or manually by platform-team.
//
// Body: { "lifecycle": "development" }
//
// Authentication: two paths.
//
//  1. Webhook token — Authorization: Bearer <WEBHOOK_TOKEN>
//     Used by ArgoCD notifications for automatic experimental → development.
//  2. User session — normal portal cookie auth.
//     Used by platform-team for manual promotions to staging/production.
//
// Rules:
//   - experimental → development: webhook token OR platform-team session
//   - development → staging: platform-team session only
//   - staging → production: platform-team session only
//   - any demotion: platform-team session only
//
// @Summary      Promote entity lifecycle
// @Tags         catalog
// @Accept       json
// @Produce      json
// @Param        kind  path  string  true  "Entity kind"
// @Param        name  path  string  true  "Entity name"
// @Security     CookieAuth
// @Router       /api/v1/catalog/entities/{kind}/{name}/promote [post]
func (h *CatalogHandler) PromoteLifecycle(c *gin.Context) {
	kind := c.Param("kind")
	name := c.Param("name")

	var req struct {
		Lifecycle string `json:"lifecycle" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	entity, err := h.store.Get(c.Request.Context(), kind, name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("%s/%s not found", kind, name)})
		return
	}

	oldLC := entity.Spec.Lifecycle
	newLC := req.Lifecycle

	if oldLC == newLC {
		c.JSON(http.StatusOK, gin.H{"lifecycle": newLC, "changed": false})
		return
	}

	// Check authentication: webhook token or user session.
	isWebhook := h.isValidWebhookToken(c)
	session := auth.GetSession(c)
	isPlatform := session != nil && auth.IsPlatformTeam(session.Groups)
	isManager := session != nil && auth.IsTeamManager(session.Groups, entity.Spec.Owner)
	canPromote := isPlatform || isManager

	autoPromotion := oldLC == "experimental" && newLC == "development"

	if autoPromotion {
		// CI pipeline (on staging push) or ArgoCD notification calls this after the
		// infra PR is merged. The merge itself is the approval — no overlay check needed.
		if !isWebhook && !canPromote {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "valid webhook token, platform-team, or team Managers session required"})
			return
		}
	} else {
		if !canPromote {
			c.JSON(http.StatusForbidden, gin.H{"error": "only platform-team or team Managers can promote to " + newLC})
			return
		}
	}

	// Update the entity YAML and commit directly to main.
	entity.Spec.Lifecycle = newLC
	entityYAML, err := yaml.Marshal(entity)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "marshal entity: " + err.Error()})
		return
	}

	if h.cfg != nil && h.cfg.CatalogLocalDir != "" {
		// Local dev mode — write to disk.
		relPath := h.store.EntityRelPath(kind, name)
		if relPath == "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "entity file path not found"})
			return
		}
		fullPath := filepath.Join(h.cfg.CatalogLocalDir, relPath)
		if err := os.WriteFile(fullPath, entityYAML, 0o644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "write: " + err.Error()})
			return
		}
		h.store.InvalidateCache()
	} else if h.giteaClient != nil && h.cfg != nil {
		// Gitea mode — commit directly to main (lifecycle is metadata, not infra).
		relPath := h.store.EntityRelPath(kind, name)
		if relPath == "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "entity file path not found"})
			return
		}
		filePath := h.cfg.GiteaCatalogPath + "/" + relPath
		commitMsg := fmt.Sprintf("chore(catalog): promote %s/%s lifecycle %s → %s", kind, name, oldLC, newLC)
		if _, err := h.giteaClient.CreateOrUpdateFile(
			c.Request.Context(),
			h.cfg.GiteaCatalogOwner,
			h.cfg.GiteaCatalogRepo,
			filePath,
			entityYAML,
			commitMsg,
			"main",
		); err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "commit: " + err.Error()})
			return
		}
	} else {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no write path configured"})
		return
	}

	log.Printf("[catalog] lifecycle promoted: %s/%s %s → %s", kind, name, oldLC, newLC)
	c.JSON(http.StatusOK, gin.H{
		"lifecycle": newLC,
		"previous":  oldLC,
		"changed":   true,
	})
}
