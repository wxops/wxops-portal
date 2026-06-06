package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// HealthHandler serves Kubernetes liveness and readiness probe endpoints.
type HealthHandler struct{}

// NewHealthHandler constructs a HealthHandler.
func NewHealthHandler() *HealthHandler {
	return &HealthHandler{}
}

// Liveness handles GET /healthz.
//
// @Summary      Liveness probe
// @Description  Returns 200 as long as the process is alive. Used by the Kubernetes liveness and startup probes.
// @Tags         health
// @Produce      json
// @Success      200  {object}  map[string]string  "status: ok"
// @Router       /healthz [get]
func (h *HealthHandler) Liveness(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// Readiness handles GET /readyz.
//
// @Summary      Readiness probe
// @Description  Returns 200 when the server is ready to accept traffic. Kept separate from /healthz so probes can be tuned independently.
// @Tags         health
// @Produce      json
// @Success      200  {object}  map[string]string  "status: ok"
// @Router       /readyz [get]
func (h *HealthHandler) Readiness(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
