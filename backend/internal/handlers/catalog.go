package handlers

import (
	"context"
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
// Implemented by *gitea.Client in production; nil disables URL-based fetching.
type SpecFetcher interface {
	FetchURL(ctx context.Context, url string) ([]byte, error)
}

// CatalogHandler serves catalog entity endpoints.
// Entities are backed by a Gitea repository via catalog.Store — see store.go.
type CatalogHandler struct {
	store       *catalog.Store
	specFetcher SpecFetcher // nil in local-dev mode
}

// NewCatalogHandler constructs a CatalogHandler.
// fetcher may be nil when no remote spec fetching is required (local dev).
func NewCatalogHandler(store *catalog.Store, fetcher SpecFetcher) *CatalogHandler {
	return &CatalogHandler{store: store, specFetcher: fetcher}
}

// ListEntities returns all catalog entities.
// An optional ?kind= query parameter filters by entity kind (case-insensitive).
//
//	GET /api/v1/catalog/entities
//	GET /api/v1/catalog/entities?kind=Component
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

	// Never return null — an empty catalog is still a valid response.
	if entities == nil {
		entities = []catalog.Entity{}
	}
	c.JSON(http.StatusOK, gin.H{"entities": entities})
}

// GetEntity returns a single entity by kind and name.
//
//	GET /api/v1/catalog/entities/:kind/:name
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
// Priority:
//  1. spec.definition — inline YAML in the catalog file (returned as-is)
//  2. metadata.links entry with type "openapi" — fetched from Gitea via the
//     configured token and returned as raw YAML
//
// Returns 404 when neither source is available.
//
//	GET /api/v1/catalog/entities/:kind/:name/spec
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

	// Priority 2: fetch from a link typed "openapi".
	if h.specFetcher != nil {
		for _, link := range entity.Metadata.Links {
			if link.Type != "openapi" {
				continue
			}
			data, fetchErr := h.specFetcher.FetchURL(c.Request.Context(), link.URL)
			if fetchErr != nil || data == nil {
				continue
			}
			c.Data(http.StatusOK, "text/yaml; charset=utf-8", data)
			return
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "no spec available for " + kind + "/" + name})
}

// GetDocContent returns the raw markdown content for a Doc entity.
// The content URL is taken from spec.contentUrl and fetched through the
// configured Gitea client so that private repositories are accessible.
//
//	GET /api/v1/catalog/entities/:kind/:name/content
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
		// Full https:// URL — fetch through the Gitea client (carries auth token).
		if h.specFetcher == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": "absolute contentUrl requires Gitea configuration (GITEA_URL); use a relative path for local dev",
			})
			return
		}
		data, fetchErr = h.specFetcher.FetchURL(c.Request.Context(), entity.Spec.ContentURL)
	} else {
		// Relative path — read directly from the catalog repo via the store's reader.
		// Works in local dev (LocalReader) and production (Gitea client) alike.
		data, fetchErr = h.store.GetFileContent(c.Request.Context(), entity.Spec.ContentURL)
	}

	if fetchErr != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fetchErr.Error()})
		return
	}
	c.Data(http.StatusOK, "text/markdown; charset=utf-8", data)
}
