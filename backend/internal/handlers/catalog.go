package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/wxops/wxops-portal-v2/internal/catalog"
)

// CatalogHandler serves catalog entity endpoints.
// Entities are backed by a Gitea repository via catalog.Store — see store.go.
type CatalogHandler struct {
	store *catalog.Store
}

// NewCatalogHandler constructs a CatalogHandler.
func NewCatalogHandler(store *catalog.Store) *CatalogHandler {
	return &CatalogHandler{store: store}
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
