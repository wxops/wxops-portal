package handlers

import (
	"bytes"
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
	"github.com/wxops/wxops-portal-v2/internal/scaffold"
	"gopkg.in/yaml.v3"
)

// isAbsoluteURL returns true when s begins with http:// or https://.
func isAbsoluteURL(s string) bool {
	return strings.HasPrefix(s, "https://") || strings.HasPrefix(s, "http://")
}

// EnvVersion holds the latest image tag and its creation date for one environment.
type EnvVersion struct {
	Tag  string `json:"tag"`
	Date string `json:"date"`
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

// ListEntities returns all catalog entities, optionally filtered by kind, search query, or owner.
//
// @Summary      List catalog entities
// @Description  Returns all catalog entities. Use ?kind= to filter by entity kind (case-insensitive). Use ?search= for full-text search across name, title, description, and tags. Use ?owner= to filter by owning team (strips "group:" prefix).
// @Tags         catalog
// @Produce      json
// @Param        kind    query   string  false  "Filter by kind (Component, API, System, Group, Resource, User, Doc)"
// @Param        search  query   string  false  "Full-text search across name, title, description, and tags"
// @Param        owner   query   string  false  "Filter by owner team (e.g. rocket-team or group:rocket-team)"
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

	// Full-text search: case-insensitive substring across name, title, description, tags.
	if search := c.Query("search"); search != "" {
		lq := strings.ToLower(search)
		var filtered []catalog.Entity
		for _, e := range entities {
			if entityMatchesSearch(e, lq) {
				filtered = append(filtered, e)
			}
		}
		entities = filtered
	}

	// Owner filter: match spec.owner, stripping the "group:" prefix.
	if owner := c.Query("owner"); owner != "" {
		want := strings.ToLower(strings.TrimPrefix(owner, "group:"))
		var filtered []catalog.Entity
		for _, e := range entities {
			o := strings.ToLower(strings.TrimPrefix(e.Spec.Owner, "group:"))
			if o == want {
				filtered = append(filtered, e)
			}
		}
		entities = filtered
	}

	// Lifecycle filter.
	if lifecycle := c.Query("lifecycle"); lifecycle != "" {
		lq := strings.ToLower(lifecycle)
		var filtered []catalog.Entity
		for _, e := range entities {
			if strings.ToLower(e.Spec.Lifecycle) == lq {
				filtered = append(filtered, e)
			}
		}
		entities = filtered
	}

	// Filter draft docs — only visible to the author or platform-team.
	session := auth.GetSession(c)
	var visible []catalog.Entity
	for _, e := range entities {
		if e.Kind == "Doc" && e.Spec.Draft != nil && *e.Spec.Draft {
			if session == nil {
				continue
			}
			if !auth.IsPlatformTeam(session.Groups) {
				authorName := strings.TrimPrefix(e.Spec.Author, "user:")
				if !strings.EqualFold(session.Username, authorName) {
					continue
				}
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

// entityMatchesSearch reports whether entity e contains lq (lowercased query)
// in its name, title, description, or any tag.
func entityMatchesSearch(e catalog.Entity, lq string) bool {
	if strings.Contains(strings.ToLower(e.Metadata.Name), lq) {
		return true
	}
	if strings.Contains(strings.ToLower(e.Metadata.Title), lq) {
		return true
	}
	if strings.Contains(strings.ToLower(e.Metadata.Description), lq) {
		return true
	}
	for _, tag := range e.Metadata.Tags {
		if strings.Contains(strings.ToLower(tag), lq) {
			return true
		}
	}
	return false
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

	// Draft docs are only visible to the author or platform-team.
	if entity.Kind == "Doc" && entity.Spec.Draft != nil && *entity.Spec.Draft {
		session := auth.GetSession(c)
		if session == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "entity Doc/" + name + " not found"})
			return
		}
		if !auth.IsPlatformTeam(session.Groups) {
			authorName := strings.TrimPrefix(entity.Spec.Author, "user:")
			if !strings.EqualFold(session.Username, authorName) {
				c.JSON(http.StatusNotFound, gin.H{"error": "entity Doc/" + name + " not found"})
				return
			}
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
	relPath := entityRelPath(entity.Kind, entity.Spec.Owner, entity.Metadata.Name)
	filePath := catalogPath + "/" + relPath
	commitMsg := fmt.Sprintf("feat(catalog): register %s %s", entity.Kind, entity.Metadata.Name)

	// Doc entities are committed directly to main — no review gate.
	if strings.EqualFold(entity.Kind, "Doc") {
		if _, err := h.giteaClient.CreateOrUpdateFile(ctx, gitopsOwner, gitopsRepo, filePath, entityYAML, commitMsg, "main"); err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "commit: " + err.Error()})
			return
		}
		h.store.InvalidateCache()
		c.JSON(http.StatusCreated, gin.H{
			"entity": entity,
			"status": "Document published to catalog",
		})
		return
	}

	branchName := fmt.Sprintf("register/%s/%s-%d",
		strings.ToLower(entity.Kind), entity.Metadata.Name, time.Now().Unix())
	if err := h.giteaClient.CreateBranch(ctx, gitopsOwner, gitopsRepo, branchName, "main"); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "create branch: " + err.Error()})
		return
	}

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
	relPath := entityRelPath(entity.Kind, entity.Spec.Owner, entity.Metadata.Name)
	filePath := catalogPath + "/" + relPath
	commitMsg := fmt.Sprintf("chore(catalog): update %s %s", kind, name)

	// Doc entities are committed directly to main — no review gate.
	if strings.EqualFold(kind, "Doc") {
		if _, err := h.giteaClient.CreateOrUpdateFile(ctx, gitopsOwner, gitopsRepo, filePath, entityYAML, commitMsg, "main"); err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "commit: " + err.Error()})
			return
		}
		h.store.InvalidateCache()
		c.JSON(http.StatusOK, gin.H{
			"entity": entity,
			"status": "Document updated",
		})
		return
	}

	branchName := fmt.Sprintf("edit/%s/%s-%d", strings.ToLower(kind), name, time.Now().Unix())
	if err := h.giteaClient.CreateBranch(ctx, gitopsOwner, gitopsRepo, branchName, "main"); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "create branch: " + err.Error()})
		return
	}

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

// GetEntityVersions returns the latest deployed version per environment for an entity.
// Versions are derived from git tag naming conventions:
//
//	dev-{date}-{sha}    → dev environment (Image Updater CI builds on develop)
//	vX.Y.Z-rcN          → staging environment (crane re-tag on staging merge)
//	vX.Y.Z              → production environment (crane re-tag on production release)
//
// @Summary      Get per-environment versions
// @Description  Returns the latest tag for each environment (dev/staging/production) from the entity's source repo.
// @Tags         catalog
// @Produce      json
// @Param        kind  path  string  true  "Entity kind"
// @Param        name  path  string  true  "Entity name"
// @Success      200  {object}  map[string]any
// @Security     CookieAuth
// @Router       /api/v1/catalog/entities/{kind}/{name}/versions [get]
func (h *CatalogHandler) GetEntityVersions(c *gin.Context) {
	owner, repo, _, err := h.resolveEntityRepo(c)
	if err != nil {
		return
	}
	if h.giteaClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Gitea not configured"})
		return
	}

	tags, err := h.giteaClient.ListRepoTags(c.Request.Context(), owner, repo, 50)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	var (
		devTag     *EnvVersion
		stagingTag *EnvVersion
		prodTag    *EnvVersion
	)

	for _, t := range tags {
		n := t.Name
		date := t.Commit.Created
		switch {
		case devTag == nil && strings.HasPrefix(n, "dev-"):
			devTag = &EnvVersion{Tag: n, Date: date}
		case stagingTag == nil && strings.HasPrefix(n, "v") && strings.Contains(n, "-rc"):
			stagingTag = &EnvVersion{Tag: n, Date: date}
		case prodTag == nil && strings.HasPrefix(n, "v") && !strings.Contains(n, "-rc"):
			prodTag = &EnvVersion{Tag: n, Date: date}
		}
		if devTag != nil && stagingTag != nil && prodTag != nil {
			break
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"dev":        devTag,
		"staging":    stagingTag,
		"production": prodTag,
	})
}

// parseArgoCDSourceTag extracts the image tag from an ArgoCD Image Updater writeback file.
//
// File format:
//
//	kustomize:
//	  images:
//	  - registry/org/repo=registry/org/repo:tag
//
// Returns the tag string, or "" if the file cannot be parsed.
func parseArgoCDSourceTag(data []byte) string {
	var src struct {
		Kustomize struct {
			Images []string `yaml:"images"`
		} `yaml:"kustomize"`
	}
	if err := yaml.Unmarshal(data, &src); err != nil || len(src.Kustomize.Images) == 0 {
		return ""
	}
	// Each entry: "{image}={image}:{tag}" — take everything after "=" then after last ":"
	entry := src.Kustomize.Images[0]
	eqIdx := strings.Index(entry, "=")
	if eqIdx < 0 {
		return ""
	}
	ref := entry[eqIdx+1:] // "registry/org/repo:tag"
	if colonIdx := strings.LastIndex(ref, ":"); colonIdx >= 0 {
		return ref[colonIdx+1:]
	}
	return ""
}

// extractDateFromDevTag parses the timestamp embedded in a dev tag of the form
// dev-2026-07-02_06-29-42-sha7 and returns an RFC3339 string.
// Returns "" for release tags (vX.Y.Z, vX.Y.Z-rcN) which carry no timestamp.
func extractDateFromDevTag(tag string) string {
	if !strings.HasPrefix(tag, "dev-") {
		return ""
	}
	rest := tag[4:] // "2026-07-02_06-29-42-sha7"
	if len(rest) < 19 {
		return ""
	}
	t, err := time.Parse("2006-01-02_15-04-05", rest[:19])
	if err != nil {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
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

// GetPromoStatus returns promotion readiness for a Component entity:
// which environment overlays exist in gitops-infra, which image tags are
// present in the source repo, and any open overlay PRs.
//
// @Summary      Get promotion status
// @Tags         catalog
// @Produce      json
// @Param        kind  path  string  true  "Entity kind"
// @Param        name  path  string  true  "Entity name"
// @Success      200  {object}  map[string]any
// @Security     CookieAuth
// @Router       /api/v1/catalog/entities/{kind}/{name}/promostatus [get]
func (h *CatalogHandler) GetPromoStatus(c *gin.Context) {
	kind := c.Param("kind")
	name := c.Param("name")

	entity, err := h.store.Get(c.Request.Context(), kind, name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	loc := entity.Metadata.Annotations["gitea/source-location"]
	if loc == "" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "entity has no gitea/source-location annotation"})
		return
	}
	parts := strings.SplitN(loc, "/", 2)
	if len(parts) != 2 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "invalid gitea/source-location"})
		return
	}
	srcTeam, srcApp := parts[0], parts[1]

	locked := entity.Metadata.Annotations["wxops.cloud/deprecated"] == "true"

	type overlayStatus struct {
		Exists          bool `json:"exists"`
		OpenPR          *int `json:"openPR,omitempty"`
		DarlaneEnabled bool `json:"darlaneEnabled,omitempty"`
	}
	type promoStatus struct {
		Lifecycle string `json:"lifecycle"`
		Locked    bool   `json:"locked"`
		BaseReady bool   `json:"baseReady"` // false = scaffold PR not yet merged
		// Feature flags parsed from the base xtenant-app.yaml — authoritative even after
		// edit-config, which updates the manifest but not the catalog entity annotations.
		IngressEnabled  bool `json:"ingressEnabled"`
		CertEnabled     bool `json:"certEnabled"`
		VaultEnabled    bool `json:"vaultEnabled"`
		DatabaseEnabled bool `json:"databaseEnabled"`
		// Vault UI config — lets the frontend build direct links without duplicating env vars.
		VaultAddr    string `json:"vaultAddr,omitempty"`
		VaultKVMount string `json:"vaultKvMount,omitempty"`
		Tags         struct {
			Dev        *EnvVersion `json:"dev"`
			Staging    *EnvVersion `json:"staging"`
			Production *EnvVersion `json:"production"`
		} `json:"tags"`
		Overlays struct {
			Dev        overlayStatus `json:"dev"`
			Staging    overlayStatus `json:"staging"`
			Production overlayStatus `json:"production"`
		} `json:"overlays"`
	}

	status := promoStatus{
		Lifecycle: entity.Spec.Lifecycle,
		Locked:    locked,
	}
	if h.cfg != nil && h.cfg.VaultAddr != "" {
		status.VaultAddr = h.cfg.VaultAddr
		status.VaultKVMount = h.cfg.VaultKVMount
		if status.VaultKVMount == "" {
			status.VaultKVMount = "secret"
		}
	}

	// Overlay existence + tags — both read from gitops-infra.
	if h.giteaClient != nil && h.cfg != nil {
		gitopsOwner := h.cfg.GiteaCatalogOwner
		gitopsRepo := h.cfg.GiteaCatalogRepo

		// Tags — read the image tag ArgoCD Image Updater writes back to each overlay's
		// .argocd-source-{argoAppName}.yaml after every successful image update.
		for _, env := range []string{"dev", "staging", "production"} {
			argoAppName := fmt.Sprintf("%s-%s-%s", srcTeam, srcApp, env)
			filePath := fmt.Sprintf("tenants-apps/%s/%s/overlays/%s/.argocd-source-%s.yaml",
				srcTeam, srcApp, env, argoAppName)
			content, ferr := h.giteaClient.GetRepoFile(c.Request.Context(), gitopsOwner, gitopsRepo, filePath)
			if ferr != nil {
				continue
			}
			tag := parseArgoCDSourceTag(content)
			if tag == "" {
				continue
			}
			ev := &EnvVersion{Tag: tag, Date: extractDateFromDevTag(tag)}
			switch env {
			case "dev":
				status.Tags.Dev = ev
			case "staging":
				status.Tags.Staging = ev
			case "production":
				status.Tags.Production = ev
			}
		}

		basePath := fmt.Sprintf("tenants-apps/%s/%s/base/kustomization.yaml", srcTeam, srcApp)
		status.BaseReady, _ = h.giteaClient.FileExistsOnMain(c.Request.Context(), gitopsOwner, gitopsRepo, basePath)

		// Parse base xtenant-app.yaml for feature flags — these are authoritative because
		// edit-config updates the manifest directly without touching catalog entity annotations.
		if status.BaseReady {
			baseAppPath := fmt.Sprintf("tenants-apps/%s/%s/base/xtenant-app.yaml", srcTeam, srcApp)
			if appYAML, ferr := h.giteaClient.GetRepoFile(c.Request.Context(), gitopsOwner, gitopsRepo, baseAppPath); ferr == nil {
				var baseApp scaffold.XTenantApp
				if yaml.Unmarshal(appYAML, &baseApp) == nil {
					if baseApp.Spec.Parameters.Ingress != nil {
						status.IngressEnabled = baseApp.Spec.Parameters.Ingress.Enabled
						if baseApp.Spec.Parameters.Ingress.TLS != nil {
							status.CertEnabled = baseApp.Spec.Parameters.Ingress.TLS.Enabled
						}
					}
					if sf := baseApp.Spec.Parameters.SecretsFrom; sf != nil {
						if sf.App != nil {
							status.VaultEnabled = sf.App.Enabled
						}
					}
				}
			}
			// DatabaseEnabled: xtenant-database.yaml existence is the authoritative indicator.
			dbBasePath := fmt.Sprintf("tenants-apps/%s/%s/base/xtenant-database.yaml", srcTeam, srcApp)
			status.DatabaseEnabled, _ = h.giteaClient.FileExistsOnMain(c.Request.Context(), gitopsOwner, gitopsRepo, dbBasePath)
		}

		for _, env := range []string{"dev", "staging", "production"} {
			path := fmt.Sprintf("tenants-apps/%s/%s/overlays/%s/kustomization.yaml", srcTeam, srcApp, env)
			kustYAML, ferr := h.giteaClient.GetRepoFile(c.Request.Context(), gitopsOwner, gitopsRepo, path)
			exists := ferr == nil && len(kustYAML) > 0
			var darlaneEnabled bool
			if exists {
				if cfg, perr := scaffold.ParseOverlayConfig(kustYAML, nil); perr == nil {
					darlaneEnabled = cfg.DarlaneEnabled
				}
			}
			switch env {
			case "dev":
				status.Overlays.Dev.Exists = exists
				status.Overlays.Dev.DarlaneEnabled = darlaneEnabled
			case "staging":
				status.Overlays.Staging.Exists = exists
				status.Overlays.Staging.DarlaneEnabled = darlaneEnabled
			case "production":
				status.Overlays.Production.Exists = exists
				status.Overlays.Production.DarlaneEnabled = darlaneEnabled
			}
		}

		// Open overlay PRs — search by title prefix.
		prs, _, _ := h.giteaClient.ListPullRequests(c.Request.Context(), gitopsOwner, gitopsRepo, "open", 1, 50, h.ensurePortalLabel(c.Request.Context()))
		prefix := fmt.Sprintf("[Promote] %s/%s", srcTeam, srcApp)
		for i := range prs {
			pr := &prs[i]
			if !strings.HasPrefix(pr.Title, prefix) {
				continue
			}
			num := pr.Number
			if strings.Contains(pr.Title, "→ development") {
				status.Overlays.Dev.OpenPR = &num
			} else if strings.Contains(pr.Title, "→ staging") {
				status.Overlays.Staging.OpenPR = &num
			} else if strings.Contains(pr.Title, "→ production") {
				status.Overlays.Production.OpenPR = &num
			}
		}
	}

	c.JSON(http.StatusOK, status)
}

// overlayValidationContext carries entity-level capability flags derived from
// catalog annotations so validateOverlayRequest can enforce XR field constraints.
type overlayValidationContext struct {
	ingressEnabled bool
	certEnabled    bool
	databaseEnabled bool
}

// validateOverlayRequest enforces the field constraints described in the XTenantApp XR.
// Returns a slice of human-readable errors; empty means the request is valid.
func validateOverlayRequest(req struct {
	IngressHost     string
	CertIssuer      string
	Replicas        *int32
	ResourcesCPUReq string
	ResourcesCPULim string
	ResourcesMemReq string
	ResourcesMemLim string
	DatabaseEnabled bool
	DbTier          string
	DbName          string
	DbInstances     int32
	DbStorageSize   string
	DbPostgresVersion int
}, ctx overlayValidationContext) []string {
	var errs []string

	// ── Ingress ───────────────────────────────────────────────────────────
	// host is required when the base XTenantApp has ingress.enabled: true.
	if ctx.ingressEnabled && req.IngressHost == "" {
		errs = append(errs, "ingress host is required — the base manifest enables ingress but no host was provided")
	}
	if req.IngressHost != "" && !isValidOverlayHostname(req.IngressHost) {
		errs = append(errs, fmt.Sprintf("ingress host %q is not a valid hostname", req.IngressHost))
	}
	// A cert issuer is only meaningful alongside a host.
	if req.CertIssuer != "" && req.IngressHost == "" {
		errs = append(errs, "certIssuer requires an ingress host — set the ingress host first")
	}

	// ── Replicas ──────────────────────────────────────────────────────────
	if req.Replicas != nil && *req.Replicas < 1 {
		errs = append(errs, "replicas must be ≥ 1")
	}

	// ── Resource quantities ───────────────────────────────────────────────
	for field, val := range map[string]string{
		"resourcesCpuReq": req.ResourcesCPUReq,
		"resourcesCpuLim": req.ResourcesCPULim,
		"resourcesMemReq": req.ResourcesMemReq,
		"resourcesMemLim": req.ResourcesMemLim,
	} {
		if val != "" && !isValidK8sQuantity(val) {
			errs = append(errs, fmt.Sprintf("%s %q is not a valid Kubernetes resource quantity (e.g. 100m, 512Mi)", field, val))
		}
	}

	// ── Database ──────────────────────────────────────────────────────────
	if req.DatabaseEnabled {
		if req.DbTier != "" && req.DbTier != "shared" && req.DbTier != "dedicated" {
			errs = append(errs, "dbTier must be 'shared' or 'dedicated'")
		}
		if req.DbName != "" && !isValidK8sName(req.DbName) {
			errs = append(errs, fmt.Sprintf("dbName %q must be lowercase alphanumeric and hyphens only", req.DbName))
		}
		if req.DbTier == "dedicated" {
			if req.DbInstances < 1 {
				errs = append(errs, "dbInstances must be ≥ 1 for a dedicated-tier database")
			}
			if req.DbStorageSize != "" && !isValidK8sQuantity(req.DbStorageSize) {
				errs = append(errs, fmt.Sprintf("dbStorageSize %q is not a valid Kubernetes resource quantity (e.g. 10Gi)", req.DbStorageSize))
			}
			if req.DbPostgresVersion != 0 && (req.DbPostgresVersion < 14 || req.DbPostgresVersion > 17) {
				errs = append(errs, fmt.Sprintf("dbPostgresVersion %d is out of range — supported: 14–17", req.DbPostgresVersion))
			}
		}
	}

	return errs
}

// isValidOverlayHostname returns true for well-formed RFC 1123 hostnames.
func isValidOverlayHostname(h string) bool {
	if len(h) == 0 || len(h) > 253 {
		return false
	}
	for _, label := range strings.Split(h, ".") {
		if len(label) == 0 || len(label) > 63 {
			return false
		}
		for i, c := range label {
			switch {
			case c >= 'a' && c <= 'z':
			case c >= 'A' && c <= 'Z':
			case c >= '0' && c <= '9':
			case c == '-' && i > 0 && i < len(label)-1:
			default:
				return false
			}
		}
	}
	return true
}

// isValidK8sQuantity checks the common Kubernetes resource quantity formats:
//   - plain integer: "100"
//   - decimal: "0.5"
//   - SI suffix (CPU millicore): "100m"
//   - binary suffix (memory): "128Mi", "1Gi"
//   - decimal SI suffix: "100M", "10G"
func isValidK8sQuantity(s string) bool {
	suffixes := []string{"Ki", "Mi", "Gi", "Ti", "Pi", "Ei", "m", "k", "K", "M", "G", "T", "P", "E"}
	for _, sfx := range suffixes {
		if strings.HasSuffix(s, sfx) {
			s = s[:len(s)-len(sfx)]
			break
		}
	}
	if s == "" {
		return false
	}
	for _, c := range s {
		if (c < '0' || c > '9') && c != '.' {
			return false
		}
	}
	return true
}

// isValidK8sName checks that a name is a valid Kubernetes DNS label (RFC 1123):
// lowercase alphanumeric and hyphens, no leading/trailing hyphens.
func isValidK8sName(name string) bool {
	if len(name) == 0 || len(name) > 63 {
		return false
	}
	if name[0] == '-' || name[len(name)-1] == '-' {
		return false
	}
	for _, c := range name {
		if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '-' {
			return false
		}
	}
	return true
}

// PromoteLifecycle handles two promotion actions for a Component entity:
//
//   - "create-overlay": generates the Kustomize overlay for the target environment
//     and opens a PR in gitops-infra. A developer triggers this; platform-team
//     approves/merges.
//   - "confirm": updates the entity lifecycle in the catalog once the developer
//     has verified the PR is merged and the image tag exists. Acts as ground truth
//     confirmation, not a command.
//
// Permission matrix:
//   - → development: any team member, platform-team, or Managers
//   - → staging / production: platform-team or Managers only
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
		Action          string  `json:"action" binding:"required"`
		TargetLifecycle string  `json:"targetLifecycle" binding:"required"`
		Replicas        *int32  `json:"replicas,omitempty"`
		IngressHost     string  `json:"ingressHost,omitempty"`
		ResourcesCPUReq string  `json:"resourcesCpuReq,omitempty"`
		ResourcesCPULim string  `json:"resourcesCpuLim,omitempty"`
		ResourcesMemReq string  `json:"resourcesMemReq,omitempty"`
		ResourcesMemLim string  `json:"resourcesMemLim,omitempty"`
		// Database env-specific config
		DatabaseEnabled    bool   `json:"databaseEnabled,omitempty"`
		DbName             string `json:"dbName,omitempty"`
		DbTier             string `json:"dbTier,omitempty"`
		DbEnvironment      string `json:"dbEnvironment,omitempty"`
		DbClusterRef       string `json:"dbClusterRef,omitempty"`
		DbClusterNamespace string `json:"dbClusterNamespace,omitempty"`
		// Dedicated-tier cluster parameters
		DbInstances       int32  `json:"dbInstances,omitempty"`
		DbStorageSize     string `json:"dbStorageSize,omitempty"`
		DbPostgresVersion int    `json:"dbPostgresVersion,omitempty"`
		DbEnablePooler    bool   `json:"dbEnablePooler,omitempty"`
		DbNamespace       string `json:"dbNamespace,omitempty"`
		// Cert-TLS per-env issuer override
		CertIssuer string `json:"certIssuer,omitempty"`
		// VaultWritten must be true when the entity has a vault dependency and
		// action == "create-overlay". The frontend sets this after a successful
		// PUT /api/scaffold/secrets call so we know the ExternalSecret will sync.
		VaultWritten bool `json:"vaultWritten,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Action != "create-overlay" && req.Action != "update-overlay" && req.Action != "confirm" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "action must be create-overlay, update-overlay, or confirm"})
		return
	}

	entity, err := h.store.Get(c.Request.Context(), kind, name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("%s/%s not found", kind, name)})
		return
	}

	if entity.Metadata.Annotations["wxops.cloud/deprecated"] == "true" {
		c.JSON(http.StatusConflict, gin.H{"error": "entity is deprecated and cannot be promoted"})
		return
	}

	// Permission check.
	session := auth.GetSession(c)
	if session == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	isPlatform := auth.IsPlatformTeam(session.Groups)
	isManager := auth.IsTeamManager(session.Groups, entity.Spec.Owner)
	isMember := auth.MemberOfTeam(session.Groups, entity.Spec.Owner)
	canElevate := isPlatform || isManager

	switch req.TargetLifecycle {
	case "development":
		if !isMember && !canElevate {
			c.JSON(http.StatusForbidden, gin.H{"error": "must be a team member to promote to development"})
			return
		}
	case "staging", "production":
		if !canElevate {
			c.JSON(http.StatusForbidden, gin.H{"error": "only platform-team or team Managers can promote to " + req.TargetLifecycle})
			return
		}
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "targetLifecycle must be development, staging, or production"})
		return
	}

	loc := entity.Metadata.Annotations["gitea/source-location"]
	parts := strings.SplitN(loc, "/", 2)
	if len(parts) != 2 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "entity has no valid gitea/source-location annotation"})
		return
	}
	srcTeam, srcApp := parts[0], parts[1]

	// Overlay dirs use "dev", not "development". Lifecycle label stays as-is.
	envName := req.TargetLifecycle
	if envName == "development" {
		envName = "dev"
	}

	if req.Action == "create-overlay" || req.Action == "update-overlay" {
		if h.giteaClient == nil || h.cfg == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Gitea not configured"})
			return
		}

		gitopsOwner := h.cfg.GiteaCatalogOwner
		gitopsRepo := h.cfg.GiteaCatalogRepo

		// Guard: base manifests must be on main before an overlay can reference ../../base.
		basePath := fmt.Sprintf("tenants-apps/%s/%s/base/kustomization.yaml", srcTeam, srcApp)
		if exists, _ := h.giteaClient.FileExistsOnMain(c.Request.Context(), gitopsOwner, gitopsRepo, basePath); !exists {
			c.JSON(http.StatusConflict, gin.H{"error": "scaffold PR has not been merged yet — merge the base manifests before creating an overlay"})
			return
		}

		overlayPath := fmt.Sprintf("tenants-apps/%s/%s/overlays/%s/kustomization.yaml", srcTeam, srcApp, envName)
		overlayExists, _ := h.giteaClient.FileExistsOnMain(c.Request.Context(), gitopsOwner, gitopsRepo, overlayPath)

		if req.Action == "create-overlay" && overlayExists {
			c.JSON(http.StatusConflict, gin.H{"error": "overlay already exists on main — use confirm to update lifecycle"})
			return
		}
		if req.Action == "update-overlay" && !overlayExists {
			c.JSON(http.StatusConflict, gin.H{"error": "overlay does not exist yet — use create-overlay first"})
			return
		}

		// Vault verification — only enforced on create-overlay.
		// On update-overlay the secrets already exist in Vault from the initial creation;
		// the user may update them optionally but is not required to re-enter them.
		hasVault := false
		for _, dep := range entity.Spec.DependsOn {
			depName := dep[strings.LastIndex(dep, "/")+1:]
			if strings.HasSuffix(depName, "-vault") {
				hasVault = true
				break
			}
		}
		if hasVault && !req.VaultWritten && req.Action == "create-overlay" {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "vault secrets must be written before committing the overlay — add at least one secret in the Vault secrets section"})
			return
		}

		// Field-level validation against the XTenantApp XR constraints.
		// Read feature flags from the base manifest — more reliable than catalog annotations
		// because edit-config updates xtenant-app.yaml without touching the catalog entity.
		ingressEnabled := entity.Metadata.Annotations["wxops.cloud/ingress"] == "true"
		certEnabled := entity.Metadata.Annotations["wxops.cloud/cert-manager"] == "true"
		{
			baseAppPath := fmt.Sprintf("tenants-apps/%s/%s/base/xtenant-app.yaml", srcTeam, srcApp)
			if appYAML, ferr := h.giteaClient.GetRepoFile(c.Request.Context(), gitopsOwner, gitopsRepo, baseAppPath); ferr == nil {
				var baseApp scaffold.XTenantApp
				if yaml.Unmarshal(appYAML, &baseApp) == nil && baseApp.Spec.Parameters.Ingress != nil {
					ingressEnabled = ingressEnabled || baseApp.Spec.Parameters.Ingress.Enabled
					if baseApp.Spec.Parameters.Ingress.TLS != nil {
						certEnabled = certEnabled || baseApp.Spec.Parameters.Ingress.TLS.Enabled
					}
				}
			}
		}
		vctx := overlayValidationContext{
			ingressEnabled:  ingressEnabled || certEnabled, // cert-manager always requires ingress
			certEnabled:     certEnabled,
			databaseEnabled: req.DatabaseEnabled,
		}
		if errs := validateOverlayRequest(struct {
			IngressHost       string
			CertIssuer        string
			Replicas          *int32
			ResourcesCPUReq   string
			ResourcesCPULim   string
			ResourcesMemReq   string
			ResourcesMemLim   string
			DatabaseEnabled   bool
			DbTier            string
			DbName            string
			DbInstances       int32
			DbStorageSize     string
			DbPostgresVersion int
		}{
			IngressHost:       req.IngressHost,
			CertIssuer:        req.CertIssuer,
			Replicas:          req.Replicas,
			ResourcesCPUReq:   req.ResourcesCPUReq,
			ResourcesCPULim:   req.ResourcesCPULim,
			ResourcesMemReq:   req.ResourcesMemReq,
			ResourcesMemLim:   req.ResourcesMemLim,
			DatabaseEnabled:   req.DatabaseEnabled,
			DbTier:            req.DbTier,
			DbName:            req.DbName,
			DbInstances:       req.DbInstances,
			DbStorageSize:     req.DbStorageSize,
			DbPostgresVersion: req.DbPostgresVersion,
		}, vctx); len(errs) > 0 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": strings.Join(errs, "; ")})
			return
		}

		var resources *scaffold.ResourceSpec
		if req.ResourcesCPUReq != "" || req.ResourcesCPULim != "" || req.ResourcesMemReq != "" || req.ResourcesMemLim != "" {
			resources = &scaffold.ResourceSpec{
				Requests: &scaffold.ResourceValues{CPU: req.ResourcesCPUReq, Memory: req.ResourcesMemReq},
				Limits:   &scaffold.ResourceValues{CPU: req.ResourcesCPULim, Memory: req.ResourcesMemLim},
			}
		}

		overlayReq := &scaffold.OverlayRequest{
			Team:               srcTeam,
			AppName:            srcApp,
			EnvName:            envName,
			Replicas:           req.Replicas,
			IngressHost:        req.IngressHost,
			Resources:          resources,
			DatabaseEnabled:    req.DatabaseEnabled,
			DbName:             req.DbName,
			DbTier:             req.DbTier,
			DbEnvironment:      req.DbEnvironment,
			DbClusterRef:       req.DbClusterRef,
			DbClusterNamespace: req.DbClusterNamespace,
			DbInstances:        req.DbInstances,
			DbStorageSize:      req.DbStorageSize,
			DbPostgresVersion:  req.DbPostgresVersion,
			DbEnablePooler:     req.DbEnablePooler,
			DbNamespace:        req.DbNamespace,
			CertIssuer:         req.CertIssuer,
		}
		overlayFiles, err := scaffold.GenerateOverlayFiles(overlayReq)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "generate overlay: " + err.Error()})
			return
		}

		isEdit := req.Action == "update-overlay"

		overlayDir := fmt.Sprintf("tenants-apps/%s/%s/overlays/%s", srcTeam, srcApp, envName)
		commitFiles := make(map[string][]byte, len(overlayFiles))
		for fname, data := range overlayFiles {
			commitFiles[overlayDir+"/"+fname] = data
		}

		var commitMsg string
		if isEdit {
			commitMsg = fmt.Sprintf("feat(overlay): update %s overlay for %s/%s", envName, srcTeam, srcApp)
		} else {
			commitMsg = fmt.Sprintf("feat(promote): add %s overlay for %s/%s", envName, srcTeam, srcApp)
		}

		// Dev: commit directly to main (no PR review, no confirm step).
		if envName == "dev" {
			// update-overlay: skip the commit entirely if no overlay file changed.
			// Prevents no-op commits when only vault keys were edited (vault content
			// lives in Vault, not in the overlay YAML, so the generated files are identical).
			if isEdit {
				anyChanged := false
				for fname, newData := range commitFiles {
					existing, ferr := h.giteaClient.GetRepoFile(c.Request.Context(), gitopsOwner, gitopsRepo, fname)
					if ferr != nil || !bytes.Equal(existing, newData) {
						anyChanged = true
						break
					}
				}
				if !anyChanged {
					log.Printf("[catalog] dev overlay unchanged — skipping commit: %s/%s by %s", srcTeam, srcApp, session.Username)
					c.JSON(http.StatusOK, gin.H{
						"action":    req.Action,
						"committed": false,
						"message":   "overlay unchanged — no commit needed",
					})
					return
				}
			}

			newLC := req.TargetLifecycle // "development"
			oldLC := entity.Spec.Lifecycle
			// Only promote lifecycle on create-overlay, not update-overlay.
			lifecycleChanged := !isEdit && oldLC != newLC

			// Batch all writes into one commit: overlay files + catalog entity lifecycle
			// update (if changed) + all cascaded Resource/API entities.
			batchFiles := make(map[string][]byte, len(commitFiles)+4)
			for k, v := range commitFiles {
				batchFiles[k] = v
			}

			if lifecycleChanged {
				entity.Spec.Lifecycle = newLC
				entityYAML, merr := yaml.Marshal(entity)
				if merr != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": "marshal entity: " + merr.Error()})
					return
				}
				relPath := h.store.EntityRelPath(kind, name)
				if relPath != "" {
					batchFiles[h.cfg.GiteaCatalogPath+"/"+relPath] = entityYAML
				}

				owner := entity.Spec.Owner
				for _, dep := range entity.Spec.DependsOn {
					if !strings.HasPrefix(dep, "resource:") {
						continue
					}
					relName := dep[strings.LastIndex(dep, "/")+1:]
					rel, rerr := h.store.Get(c.Request.Context(), "Resource", relName)
					if rerr != nil || rel.Spec.Owner != owner || rel.Spec.Lifecycle == newLC {
						continue
					}
					rel.Spec.Lifecycle = newLC
					ry, merr2 := yaml.Marshal(rel)
					if merr2 != nil {
						continue
					}
					rp := h.store.EntityRelPath("Resource", relName)
					if rp != "" {
						batchFiles[h.cfg.GiteaCatalogPath+"/"+rp] = ry
					}
				}
				for _, apiRef := range entity.Spec.ProvidesApis {
					if !strings.HasPrefix(apiRef, "api:") {
						continue
					}
					relName := apiRef[strings.LastIndex(apiRef, "/")+1:]
					rel, rerr := h.store.Get(c.Request.Context(), "API", relName)
					if rerr != nil || rel.Spec.Owner != owner || rel.Spec.Lifecycle == newLC {
						continue
					}
					rel.Spec.Lifecycle = newLC
					ry, merr2 := yaml.Marshal(rel)
					if merr2 != nil {
						continue
					}
					rp := h.store.EntityRelPath("API", relName)
					if rp != "" {
						batchFiles[h.cfg.GiteaCatalogPath+"/"+rp] = ry
					}
				}

				commitMsg = fmt.Sprintf("feat(promote): add dev overlay + promote %s/%s %s → %s", srcTeam, srcApp, oldLC, newLC)
			}

			if err := h.giteaClient.CommitFiles(c.Request.Context(), gitopsOwner, gitopsRepo, "main", commitMsg, batchFiles); err != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": "commit overlay: " + err.Error()})
				return
			}
			if lifecycleChanged {
				h.store.InvalidateCache()
			}

			log.Printf("[catalog] dev overlay committed to main: %s/%s by %s (action=%s, lifecycleChanged=%v)", srcTeam, srcApp, session.Username, req.Action, lifecycleChanged)
			c.JSON(http.StatusOK, gin.H{
				"action":           req.Action,
				"committed":        true,
				"lifecycle":        newLC,
				"lifecycleChanged": lifecycleChanged,
			})
			return
		}

		// Staging / Production: open a PR for platform-team review.
		// update-overlay: skip PR creation if no overlay file actually changed.
		if isEdit {
			anyChanged := false
			for fname, newData := range commitFiles {
				existing, ferr := h.giteaClient.GetRepoFile(c.Request.Context(), gitopsOwner, gitopsRepo, fname)
				if ferr != nil || !bytes.Equal(existing, newData) {
					anyChanged = true
					break
				}
			}
			if !anyChanged {
				log.Printf("[catalog] %s overlay unchanged — skipping PR: %s/%s by %s", envName, srcTeam, srcApp, session.Username)
				c.JSON(http.StatusOK, gin.H{
					"action":    req.Action,
					"committed": false,
					"message":   "overlay unchanged — no PR needed",
				})
				return
			}
		}

		branchPrefix := "promote"
		if isEdit {
			branchPrefix = "overlay-update"
		}
		branch := fmt.Sprintf("%s/%s/%s-%s-%d", branchPrefix, srcTeam, srcApp, envName, time.Now().Unix())
		if err := h.giteaClient.CreateBranch(c.Request.Context(), gitopsOwner, gitopsRepo, branch, "main"); err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "create branch: " + err.Error()})
			return
		}

		var prTitle, prBody string
		if isEdit {
			prTitle = fmt.Sprintf("[Overlay Update] %s/%s %s", srcTeam, srcApp, req.TargetLifecycle)
			prBody = fmt.Sprintf("## Overlay Update: %s/%s %s\n\nUpdates the `overlays/%s/` configuration (replicas, resources, ingress, DB, TLS).\n\n"+
				"---\n*Created via WxOps Portal by %s*", srcTeam, srcApp, req.TargetLifecycle, envName, session.Username)
		} else {
			prTitle = fmt.Sprintf("[Promote] %s/%s → %s", srcTeam, srcApp, req.TargetLifecycle)
			prBody = fmt.Sprintf("## Promotion: %s/%s → %s\n\nAdds the `overlays/%s/` directory so ArgoCD can deploy to the %s environment.\n\n"+
				"Once merged, return to the portal and click **Confirm** to update the lifecycle.\n\n"+
				"---\n*Created via WxOps Portal by %s*", srcTeam, srcApp, req.TargetLifecycle, envName, envName, session.Username)
		}

		if err := h.giteaClient.CommitFiles(c.Request.Context(), gitopsOwner, gitopsRepo, branch, commitMsg, commitFiles); err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "commit overlay: " + err.Error()})
			return
		}

		labelID := h.ensurePortalLabel(c.Request.Context())
		var pr *gitea.PullRequestInfo
		if labelID > 0 {
			pr, err = h.giteaClient.CreatePullRequest(c.Request.Context(), gitopsOwner, gitopsRepo, prTitle, prBody, branch, "main", labelID)
		} else {
			pr, err = h.giteaClient.CreatePullRequest(c.Request.Context(), gitopsOwner, gitopsRepo, prTitle, prBody, branch, "main")
		}
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "create PR: " + err.Error()})
			return
		}

		log.Printf("[catalog] overlay PR opened: %s/%s %s by %s (PR #%d, action=%s)", srcTeam, srcApp, req.TargetLifecycle, session.Username, pr.Number, req.Action)
		c.JSON(http.StatusOK, gin.H{
			"action":   req.Action,
			"prTitle":  pr.Title,
			"prState":  pr.State,
			"prNumber": pr.Number,
		})
		return
	}

	// action == "confirm": verify overlay exists then update lifecycle.
	if h.giteaClient != nil && h.cfg != nil {
		overlayPath := fmt.Sprintf("tenants-apps/%s/%s/overlays/%s/kustomization.yaml", srcTeam, srcApp, envName)
		exists, err := h.giteaClient.FileExistsOnMain(c.Request.Context(), h.cfg.GiteaCatalogOwner, h.cfg.GiteaCatalogRepo, overlayPath)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "check overlay: " + err.Error()})
			return
		}
		if !exists {
			c.JSON(http.StatusConflict, gin.H{"error": "overlay not found on main — merge the PR first"})
			return
		}
	}

	oldLC := entity.Spec.Lifecycle
	newLC := req.TargetLifecycle

	if oldLC == newLC {
		c.JSON(http.StatusOK, gin.H{"lifecycle": newLC, "changed": false})
		return
	}

	entity.Spec.Lifecycle = newLC
	entityYAML, err := yaml.Marshal(entity)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "marshal entity: " + err.Error()})
		return
	}

	if h.giteaClient != nil && h.cfg != nil {
		// Gitea mode: batch main entity + all cascaded Resources/APIs into one commit.
		relPath := h.store.EntityRelPath(kind, name)
		if relPath == "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "entity file path not found"})
			return
		}
		batchFiles := map[string][]byte{
			h.cfg.GiteaCatalogPath + "/" + relPath: entityYAML,
		}

		owner := entity.Spec.Owner
		cascadeCount := 0
		for _, dep := range entity.Spec.DependsOn {
			if !strings.HasPrefix(dep, "resource:") {
				continue
			}
			relName := dep[strings.LastIndex(dep, "/")+1:]
			rel, rerr := h.store.Get(c.Request.Context(), "Resource", relName)
			if rerr != nil || rel.Spec.Owner != owner || rel.Spec.Lifecycle == newLC {
				continue
			}
			rel.Spec.Lifecycle = newLC
			ry, merr := yaml.Marshal(rel)
			if merr != nil {
				continue
			}
			rp := h.store.EntityRelPath("Resource", relName)
			if rp != "" {
				batchFiles[h.cfg.GiteaCatalogPath+"/"+rp] = ry
				cascadeCount++
			}
		}
		for _, apiRef := range entity.Spec.ProvidesApis {
			if !strings.HasPrefix(apiRef, "api:") {
				continue
			}
			relName := apiRef[strings.LastIndex(apiRef, "/")+1:]
			rel, rerr := h.store.Get(c.Request.Context(), "API", relName)
			if rerr != nil || rel.Spec.Owner != owner || rel.Spec.Lifecycle == newLC {
				continue
			}
			rel.Spec.Lifecycle = newLC
			ry, merr := yaml.Marshal(rel)
			if merr != nil {
				continue
			}
			rp := h.store.EntityRelPath("API", relName)
			if rp != "" {
				batchFiles[h.cfg.GiteaCatalogPath+"/"+rp] = ry
				cascadeCount++
			}
		}

		batchMsg := fmt.Sprintf("chore(catalog): confirm %s/%s lifecycle %s → %s", kind, name, oldLC, newLC)
		if cascadeCount > 0 {
			batchMsg = fmt.Sprintf("chore(catalog): confirm %s/%s lifecycle %s → %s (+ %d related)", kind, name, oldLC, newLC, cascadeCount)
		}
		if err := h.giteaClient.CommitFiles(c.Request.Context(), h.cfg.GiteaCatalogOwner, h.cfg.GiteaCatalogRepo, "main", batchMsg, batchFiles); err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "commit: " + err.Error()})
			return
		}
		h.store.InvalidateCache()
	} else {
		// Local-dev mode: sequential writes (no batch concept in local FS).
		if err := h.commitEntityUpdate(c, kind, name, entityYAML, fmt.Sprintf("chore(catalog): confirm %s/%s lifecycle %s → %s", kind, name, oldLC, newLC)); err != nil {
			return
		}
		owner := entity.Spec.Owner
		for _, dep := range entity.Spec.DependsOn {
			if !strings.HasPrefix(dep, "resource:") {
				continue
			}
			relName := dep[strings.LastIndex(dep, "/")+1:]
			if err := h.cascadeLifecycle(c.Request.Context(), "Resource", relName, owner, newLC, session.Username); err != nil {
				log.Printf("[catalog] cascade lifecycle warn: Resource/%s: %v", relName, err)
			}
		}
		for _, apiRef := range entity.Spec.ProvidesApis {
			if !strings.HasPrefix(apiRef, "api:") {
				continue
			}
			relName := apiRef[strings.LastIndex(apiRef, "/")+1:]
			if err := h.cascadeLifecycle(c.Request.Context(), "API", relName, owner, newLC, session.Username); err != nil {
				log.Printf("[catalog] cascade lifecycle warn: API/%s: %v", relName, err)
			}
		}
	}

	log.Printf("[catalog] lifecycle confirmed: %s/%s %s → %s by %s", kind, name, oldLC, newLC, session.Username)
	c.JSON(http.StatusOK, gin.H{
		"lifecycle": newLC,
		"previous":  oldLC,
		"changed":   true,
	})
}

// cascadeLifecycle updates the lifecycle of a related entity (Resource or API)
// to match the owning Component. Only updates entities with the same owner to
// avoid touching cross-team entities. Best-effort — caller logs and continues on error.
func (h *CatalogHandler) cascadeLifecycle(ctx context.Context, kind, name, owner, lifecycle, username string) error {
	related, err := h.store.Get(ctx, kind, name)
	if err != nil {
		return nil // not found — skip silently
	}
	if related.Spec.Owner != owner {
		return nil // different owner — don't touch it
	}
	if related.Spec.Lifecycle == lifecycle {
		return nil // already correct
	}
	related.Spec.Lifecycle = lifecycle
	entityYAML, err := yaml.Marshal(related)
	if err != nil {
		return err
	}
	commitMsg := fmt.Sprintf("chore(catalog): cascade lifecycle %s/%s → %s (from %s)", kind, name, lifecycle, username)
	if h.giteaClient != nil && h.cfg != nil {
		relPath := h.store.EntityRelPath(kind, name)
		if relPath == "" {
			return nil
		}
		filePath := h.cfg.GiteaCatalogPath + "/" + relPath
		_, err = h.giteaClient.CreateOrUpdateFile(ctx, h.cfg.GiteaCatalogOwner, h.cfg.GiteaCatalogRepo, filePath, entityYAML, commitMsg, "main")
		if err == nil {
			h.store.InvalidateCache()
		}
		return err
	}
	if h.cfg != nil && h.cfg.CatalogLocalDir != "" {
		relPath := h.store.EntityRelPath(kind, name)
		if relPath == "" {
			return nil
		}
		if err := os.WriteFile(filepath.Join(h.cfg.CatalogLocalDir, relPath), entityYAML, 0o644); err != nil {
			return err
		}
		h.store.InvalidateCache()
	}
	return nil
}

// DeprecateEntity marks a Component entity as deprecated, writes the reason and
// metadata as annotations, updates lifecycle to "deprecated", and opens a gitops-infra
// PR to trigger overlay removal review.
//
// @Summary      Deprecate an entity
// @Tags         catalog
// @Accept       json
// @Produce      json
// @Param        kind  path  string  true  "Entity kind"
// @Param        name  path  string  true  "Entity name"
// @Security     CookieAuth
// @Router       /api/v1/catalog/entities/{kind}/{name}/deprecate [post]
func (h *CatalogHandler) DeprecateEntity(c *gin.Context) {
	kind := c.Param("kind")
	name := c.Param("name")

	var req struct {
		Reason string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	entity, err := h.store.Get(c.Request.Context(), kind, name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	if entity.Metadata.Annotations["wxops.cloud/deprecated"] == "true" {
		c.JSON(http.StatusConflict, gin.H{"error": "entity is already deprecated"})
		return
	}

	session := auth.GetSession(c)
	if session == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	isPlatform := auth.IsPlatformTeam(session.Groups)
	isManager := auth.IsTeamManager(session.Groups, entity.Spec.Owner)
	if !isPlatform && !isManager {
		c.JSON(http.StatusForbidden, gin.H{"error": "only platform-team or team Managers can deprecate an entity"})
		return
	}

	if entity.Metadata.Annotations == nil {
		entity.Metadata.Annotations = map[string]string{}
	}
	entity.Metadata.Annotations["wxops.cloud/deprecated"] = "true"
	entity.Metadata.Annotations["wxops.cloud/deprecated-reason"] = req.Reason
	entity.Metadata.Annotations["wxops.cloud/deprecated-by"] = session.Username
	entity.Metadata.Annotations["wxops.cloud/deprecated-at"] = time.Now().UTC().Format(time.RFC3339)
	entity.Spec.Lifecycle = "deprecated"

	entityYAML, err := yaml.Marshal(entity)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "marshal entity: " + err.Error()})
		return
	}

	if err := h.commitEntityUpdate(c, kind, name, entityYAML, fmt.Sprintf("chore(catalog): deprecate %s/%s", kind, name)); err != nil {
		return
	}

	// Open a removal PR in gitops-infra if Gitea is configured.
	var prNumber int
	if h.giteaClient != nil && h.cfg != nil {
		loc := entity.Metadata.Annotations["gitea/source-location"]
		parts := strings.SplitN(loc, "/", 2)
		if len(parts) == 2 {
			srcTeam, srcApp := parts[0], parts[1]
			gitopsOwner := h.cfg.GiteaCatalogOwner
			gitopsRepo := h.cfg.GiteaCatalogRepo

			branch := fmt.Sprintf("deprecate/%s/%s-%d", srcTeam, srcApp, time.Now().Unix())
			if err := h.giteaClient.CreateBranch(c.Request.Context(), gitopsOwner, gitopsRepo, branch, "main"); err == nil {
				deprecatedMD := fmt.Sprintf("# DEPRECATED\n\n**Reason:** %s\n**By:** %s\n**At:** %s\n\nThis directory is pending removal. Merge this PR to confirm decommission.\n",
					req.Reason, session.Username, time.Now().UTC().Format("2006-01-02"))
				markerPath := fmt.Sprintf("tenants-apps/%s/%s/DEPRECATED.md", srcTeam, srcApp)
				_ = h.giteaClient.CommitFiles(c.Request.Context(), gitopsOwner, gitopsRepo, branch, fmt.Sprintf("chore(deprecate): mark %s/%s for removal", srcTeam, srcApp), map[string][]byte{
					markerPath: []byte(deprecatedMD),
				})

				labelID := h.ensurePortalLabel(c.Request.Context())
				prTitle := fmt.Sprintf("[Deprecate] %s/%s: %s", srcTeam, srcApp, req.Reason)
				prBody := fmt.Sprintf("## Deprecation: %s/%s\n\n**Reason:** %s\n**Requested by:** %s\n\n"+
					"Merging this PR confirms decommission. Remove the `overlays/` directory contents once all traffic has been drained.\n\n"+
					"---\n*Created via WxOps Portal*", srcTeam, srcApp, req.Reason, session.Username)

				var pr *gitea.PullRequestInfo
				if labelID > 0 {
					pr, _ = h.giteaClient.CreatePullRequest(c.Request.Context(), gitopsOwner, gitopsRepo, prTitle, prBody, branch, "main", labelID)
				} else {
					pr, _ = h.giteaClient.CreatePullRequest(c.Request.Context(), gitopsOwner, gitopsRepo, prTitle, prBody, branch, "main")
				}
				if pr != nil {
					prNumber = pr.Number
				}
			}
		}
	}

	log.Printf("[catalog] entity deprecated: %s/%s by %s reason=%q", kind, name, session.Username, req.Reason)
	resp := gin.H{"deprecated": true, "lifecycle": "deprecated"}
	if prNumber > 0 {
		resp["removalPRNumber"] = prNumber
	}
	c.JSON(http.StatusOK, resp)
}

// commitEntityUpdate writes entity YAML to the catalog (local-dev or Gitea).
func (h *CatalogHandler) commitEntityUpdate(c *gin.Context, kind, name string, entityYAML []byte, commitMsg string) error {
	if h.cfg != nil && h.cfg.CatalogLocalDir != "" {
		relPath := h.store.EntityRelPath(kind, name)
		if relPath == "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "entity file path not found"})
			return fmt.Errorf("not found")
		}
		fullPath := filepath.Join(h.cfg.CatalogLocalDir, relPath)
		if err := os.WriteFile(fullPath, entityYAML, 0o644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "write: " + err.Error()})
			return err
		}
		h.store.InvalidateCache()
		return nil
	}
	if h.giteaClient != nil && h.cfg != nil {
		relPath := h.store.EntityRelPath(kind, name)
		if relPath == "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "entity file path not found"})
			return fmt.Errorf("not found")
		}
		filePath := h.cfg.GiteaCatalogPath + "/" + relPath
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
			return err
		}
		h.store.InvalidateCache()
		return nil
	}
	c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no write path configured"})
	return fmt.Errorf("no write path")
}

// RefreshCatalog invalidates the in-memory catalog cache immediately.
// Auth: Bearer <WEBHOOK_TOKEN> (same token as PromoteLifecycle).
// Wire a Gitea push webhook on gitops-infra to this endpoint so the cache is
// flushed on every catalog commit instead of waiting for the 5-minute TTL.
func (h *CatalogHandler) RefreshCatalog(c *gin.Context) {
	if !h.isValidWebhookToken(c) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "valid webhook token required"})
		return
	}
	h.store.InvalidateCache()
	log.Printf("[catalog] cache invalidated via webhook")
	c.JSON(http.StatusOK, gin.H{"status": "cache invalidated"})
}

// GetOverlayConfig reads the existing overlay files for an environment and returns
// the parsed config so the frontend can pre-fill the edit wizard.
// GET /api/v1/catalog/entities/:kind/:name/overlay/:env
func (h *CatalogHandler) GetOverlayConfig(c *gin.Context) {
	kind := c.Param("kind")
	name := c.Param("name")
	envParam := c.Param("env") // "development" | "staging" | "production"

	envName := envParam
	if envParam == "development" {
		envName = "dev"
	}

	entity, err := h.store.Get(c.Request.Context(), kind, name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("%s/%s not found", kind, name)})
		return
	}

	if h.giteaClient == nil || h.cfg == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Gitea not configured"})
		return
	}

	loc := entity.Metadata.Annotations["gitea/source-location"]
	parts := strings.SplitN(loc, "/", 2)
	if len(parts) != 2 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "entity has no valid gitea/source-location annotation"})
		return
	}
	srcTeam, srcApp := parts[0], parts[1]

	gitopsOwner := h.cfg.GiteaCatalogOwner
	gitopsRepo := h.cfg.GiteaCatalogRepo
	overlayDir := fmt.Sprintf("tenants-apps/%s/%s/overlays/%s", srcTeam, srcApp, envName)

	kustData, err := h.giteaClient.GetRepoFile(c.Request.Context(), gitopsOwner, gitopsRepo, overlayDir+"/kustomization.yaml")
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "overlay not found"})
		return
	}

	// patch-xtenant-app.yaml may be minimal if no replicas/resources were set.
	patchData, _ := h.giteaClient.GetRepoFile(c.Request.Context(), gitopsOwner, gitopsRepo, overlayDir+"/patch-xtenant-app.yaml")

	cfg, err := scaffold.ParseOverlayConfig(kustData, patchData)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "parse overlay: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, cfg)
}

// SetupDarlane adds or replaces the darlane JSON 6902 patch in an existing
// overlay kustomization.yaml. For dev overlays it commits directly to main;
// for staging/production it opens a PR for platform-team review.
//
// @Summary      Set up Darlane for an environment overlay
// @Tags         catalog
// @Accept       json
// @Produce      json
// @Param        kind  path  string  true  "Entity kind (must be Component)"
// @Param        name  path  string  true  "Entity name"
// @Security     CookieAuth
// @Router       /api/v1/catalog/entities/{kind}/{name}/darlane [post]
func (h *CatalogHandler) SetupDarlane(c *gin.Context) {
	kind := c.Param("kind")
	name := c.Param("name")

	var req struct {
		Env               string            `json:"env" binding:"required"` // "dev" | "staging" | "production"
		Replicas          *int32            `json:"replicas,omitempty"`
		Command           []string          `json:"command,omitempty"`
		FileSync          bool              `json:"fileSync,omitempty"`
		MountPath         string            `json:"mountPath,omitempty"`
		InitFromImage     string            `json:"initFromImage,omitempty"`
		TTL               string            `json:"ttl,omitempty"`
		ResourcesCPUReq   string            `json:"resourcesCpuReq,omitempty"`
		ResourcesCPULim   string            `json:"resourcesCpuLim,omitempty"`
		ResourcesMemReq   string            `json:"resourcesMemReq,omitempty"`
		ResourcesMemLim   string            `json:"resourcesMemLim,omitempty"`
		EnvVars           []scaffold.EnvVar `json:"envVars,omitempty"`
		TrafficWeight     *int32            `json:"trafficWeight,omitempty"`
		StickySession          bool              `json:"stickySession,omitempty"`
		CookieName             string            `json:"cookieName,omitempty"`
		SameSite               string            `json:"sameSite,omitempty"`
		Secure                 bool              `json:"secure,omitempty"`
		HeaderRoutingEnabled   bool              `json:"headerRoutingEnabled,omitempty"`
		HeaderRoutingHeader    string            `json:"headerRoutingHeader,omitempty"`
		HeaderRoutingValue     string            `json:"headerRoutingValue,omitempty"`
		ContainerPort     *int32            `json:"containerPort,omitempty"`
		TelemetryPort     *int32            `json:"telemetryPort,omitempty"`
		ProductionOverride bool             `json:"productionOverride,omitempty"`
		Disable           bool              `json:"disable,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if kind != "Component" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "darlane setup only applies to Component entities"})
		return
	}

	envName := req.Env
	if envName == "development" {
		envName = "dev"
	}
	if envName != "dev" && envName != "staging" && envName != "production" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "env must be dev, staging, or production"})
		return
	}

	entity, err := h.store.Get(c.Request.Context(), kind, name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("%s/%s not found", kind, name)})
		return
	}

	session := auth.GetSession(c)
	if session == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	isPlatform := auth.IsPlatformTeam(session.Groups)
	isManager := auth.IsTeamManager(session.Groups, entity.Spec.Owner)
	isMember := auth.MemberOfTeam(session.Groups, entity.Spec.Owner)
	canElevate := isPlatform || isManager

	if envName == "dev" {
		if !isMember && !canElevate {
			c.JSON(http.StatusForbidden, gin.H{"error": "must be a team member to set up Darlane for development"})
			return
		}
	} else if !canElevate {
		c.JSON(http.StatusForbidden, gin.H{"error": "only platform-team or team Managers can set up Darlane for " + envName})
		return
	}

	if envName == "production" && !req.ProductionOverride {
		c.JSON(http.StatusBadRequest, gin.H{"error": "productionOverride must be true to enable Darlane on production"})
		return
	}

	if h.giteaClient == nil || h.cfg == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Gitea not configured"})
		return
	}

	loc := entity.Metadata.Annotations["gitea/source-location"]
	parts := strings.SplitN(loc, "/", 2)
	if len(parts) != 2 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "entity has no valid gitea/source-location"})
		return
	}
	srcTeam, srcApp := parts[0], parts[1]

	gitopsOwner := h.cfg.GiteaCatalogOwner
	gitopsRepo := h.cfg.GiteaCatalogRepo
	overlayPath := fmt.Sprintf("tenants-apps/%s/%s/overlays/%s/kustomization.yaml", srcTeam, srcApp, envName)

	currentKustYAML, ferr := h.giteaClient.GetRepoFile(c.Request.Context(), gitopsOwner, gitopsRepo, overlayPath)
	if ferr != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "overlay does not exist �� create the overlay first via the promotion wizard"})
		return
	}

	// Disable path: strip darlane patch and commit/PR.
	if req.Disable {
		newKustYAML, err := scaffold.RemoveDarlanePatch(currentKustYAML)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "remove darlane patch: " + err.Error()})
			return
		}
		commitMsg := fmt.Sprintf("feat(darlane): disable darlane for %s/%s overlay/%s", srcTeam, srcApp, envName)
		if envName == "dev" {
			if err := h.giteaClient.CommitFiles(c.Request.Context(), gitopsOwner, gitopsRepo, "main", commitMsg,
				map[string][]byte{overlayPath: newKustYAML}); err != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": "commit darlane disable: " + err.Error()})
				return
			}
			h.store.InvalidateCache()
			log.Printf("[catalog] darlane disabled on dev overlay: %s/%s by %s", srcTeam, srcApp, session.Username)
			c.JSON(http.StatusOK, gin.H{"committed": true, "message": "Darlane disabled — committed to main"})
			return
		}
		branch := fmt.Sprintf("darlane/%s/%s-%s-disable-%d", srcTeam, srcApp, envName, time.Now().Unix())
		if err := h.giteaClient.CreateBranch(c.Request.Context(), gitopsOwner, gitopsRepo, branch, "main"); err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "create branch: " + err.Error()})
			return
		}
		if err := h.giteaClient.CommitFiles(c.Request.Context(), gitopsOwner, gitopsRepo, branch, commitMsg,
			map[string][]byte{overlayPath: newKustYAML}); err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "push files: " + err.Error()})
			return
		}
		prTitle := fmt.Sprintf("[Darlane] disable %s/%s → %s", srcTeam, srcApp, envName)
		prBody := fmt.Sprintf("## Disable Darlane: %s/%s %s\n\nRemoves `darlane` patch from `overlays/%s/kustomization.yaml`.\n\n---\n*Created via WxOps Portal by %s*",
			srcTeam, srcApp, envName, envName, session.Username)
		labelID := h.ensurePortalLabel(c.Request.Context())
		var pr *gitea.PullRequestInfo
		if labelID > 0 {
			pr, err = h.giteaClient.CreatePullRequest(c.Request.Context(), gitopsOwner, gitopsRepo, prTitle, prBody, branch, "main", labelID)
		} else {
			pr, err = h.giteaClient.CreatePullRequest(c.Request.Context(), gitopsOwner, gitopsRepo, prTitle, prBody, branch, "main")
		}
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "create PR: " + err.Error()})
			return
		}
		log.Printf("[catalog] darlane disable PR opened: %s/%s %s by %s (PR #%d)", srcTeam, srcApp, envName, session.Username, pr.Number)
		c.JSON(http.StatusOK, gin.H{"committed": false, "prTitle": pr.Title, "prNumber": pr.Number})
		return
	}

	// Build DarlaneSpec from request.
	replicas := int32(0)
	if req.Replicas != nil {
		replicas = *req.Replicas
	}
	ttl := req.TTL
	if ttl == "" {
		ttl = "4h"
	}
	ds := &scaffold.DarlaneSpec{
		Enabled:  true,
		Replicas: &replicas,
		TTL:      ttl,
	}
	if len(req.Command) > 0 {
		ds.Command = req.Command
	}
	if req.FileSync {
		mp := req.MountPath
		if mp == "" {
			mp = "/app"
		}
		ds.FileSync = &scaffold.FileSyncSpec{Enabled: true, MountPath: mp, InitFromImage: req.InitFromImage}
	}
	if req.ResourcesCPUReq != "" || req.ResourcesCPULim != "" || req.ResourcesMemReq != "" || req.ResourcesMemLim != "" {
		ds.Resources = &scaffold.ResourceSpec{
			Requests: &scaffold.ResourceValues{CPU: req.ResourcesCPUReq, Memory: req.ResourcesMemReq},
			Limits:   &scaffold.ResourceValues{CPU: req.ResourcesCPULim, Memory: req.ResourcesMemLim},
		}
	}
	if len(req.EnvVars) > 0 {
		ds.Env = req.EnvVars
	}
	if req.TrafficWeight != nil {
		ds.TrafficWeight = req.TrafficWeight
	}
	if req.StickySession {
		ds.StickySession = &scaffold.StickySessionSpec{
			Enabled:    true,
			CookieName: req.CookieName,
			Secure:     req.Secure,
			SameSite:   req.SameSite,
		}
	}
	if req.HeaderRoutingEnabled {
		ds.HeaderRouting = &scaffold.HeaderRoutingSpec{
			Enabled: true,
			Header:  req.HeaderRoutingHeader,
			Value:   req.HeaderRoutingValue,
		}
	}
	if req.ContainerPort != nil {
		ds.ContainerPort = req.ContainerPort
	}
	if req.TelemetryPort != nil {
		ds.TelemetryPort = req.TelemetryPort
	}
	if req.ProductionOverride {
		ds.ProductionOverride = true
	}

	// XR name: staging/production use env-suffixed name.
	baseXRName := srcTeam + "-" + srcApp
	xrName := baseXRName
	if envName == "staging" || envName == "production" {
		xrName = baseXRName + "-" + envName
	}

	darlanePatch := scaffold.BuildDarlanePatch(ds, xrName)
	newKustYAML, err := scaffold.InjectDarlanePatch(currentKustYAML, darlanePatch, xrName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "inject darlane patch: " + err.Error()})
		return
	}

	commitMsg := fmt.Sprintf("feat(darlane): enable darlane for %s/%s overlay/%s", srcTeam, srcApp, envName)

	if envName == "dev" {
		if err := h.giteaClient.CommitFiles(c.Request.Context(), gitopsOwner, gitopsRepo, "main", commitMsg,
			map[string][]byte{overlayPath: newKustYAML}); err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "commit darlane patch: " + err.Error()})
			return
		}
		log.Printf("[catalog] darlane enabled on dev overlay: %s/%s by %s", srcTeam, srcApp, session.Username)
		c.JSON(http.StatusOK, gin.H{"committed": true, "message": "Darlane enabled — overlay committed to main"})
		return
	}

	// Staging / Production: open a PR.
	branch := fmt.Sprintf("darlane/%s/%s-%s-%d", srcTeam, srcApp, envName, time.Now().Unix())
	if err := h.giteaClient.CreateBranch(c.Request.Context(), gitopsOwner, gitopsRepo, branch, "main"); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "create branch: " + err.Error()})
		return
	}
	if err := h.giteaClient.CommitFiles(c.Request.Context(), gitopsOwner, gitopsRepo, branch, commitMsg,
		map[string][]byte{overlayPath: newKustYAML}); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "push files: " + err.Error()})
		return
	}

	prTitle := fmt.Sprintf("[Darlane] %s/%s → %s", srcTeam, srcApp, envName)
	prBody := fmt.Sprintf("## Darlane: %s/%s %s\n\nAdds `darlane` patch to `overlays/%s/kustomization.yaml`.\n\n"+
		"---\n*Created via WxOps Portal by %s*", srcTeam, srcApp, envName, envName, session.Username)

	labelID := h.ensurePortalLabel(c.Request.Context())
	var pr *gitea.PullRequestInfo
	if labelID > 0 {
		pr, err = h.giteaClient.CreatePullRequest(c.Request.Context(), gitopsOwner, gitopsRepo, prTitle, prBody, branch, "main", labelID)
	} else {
		pr, err = h.giteaClient.CreatePullRequest(c.Request.Context(), gitopsOwner, gitopsRepo, prTitle, prBody, branch, "main")
	}
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "create PR: " + err.Error()})
		return
	}

	log.Printf("[catalog] darlane PR opened: %s/%s %s by %s (PR #%d)", srcTeam, srcApp, envName, session.Username, pr.Number)
	c.JSON(http.StatusOK, gin.H{"committed": false, "prTitle": pr.Title, "prNumber": pr.Number})
}
