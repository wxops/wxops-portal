package handlers

import (
	"context"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/wxops/wxops-portal-v2/internal/catalog"
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
	specFetcher SpecFetcher // nil in local-dev mode
}

// NewCatalogHandler constructs a CatalogHandler.
func NewCatalogHandler(store *catalog.Store, fetcher SpecFetcher) *CatalogHandler {
	return &CatalogHandler{store: store, specFetcher: fetcher}
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

	if entities == nil {
		entities = []catalog.Entity{}
	}
	c.JSON(http.StatusOK, gin.H{"entities": entities})
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
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", err
	}
	return body, resp.Header.Get("Content-Type"), nil
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
		if h.specFetcher == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": "absolute contentUrl requires Gitea configuration (GITEA_URL); use a relative path for local dev",
			})
			return
		}
		data, fetchErr = h.specFetcher.FetchURL(c.Request.Context(), entity.Spec.ContentURL)
	} else {
		data, fetchErr = h.store.GetFileContent(c.Request.Context(), entity.Spec.ContentURL)
	}

	if fetchErr != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fetchErr.Error()})
		return
	}
	c.Data(http.StatusOK, "text/markdown; charset=utf-8", data)
}
