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
// Returns 200 as long as the HTTP server is responding — used by the liveness
// and startup probes. No dependency checks: if the process is dead it cannot
// respond, which is the only signal the liveness probe needs.
func (h *HealthHandler) Liveness(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// Readiness handles GET /readyz.
// Returns 200 when the server is ready to accept traffic. Kept separate from
// /healthz so liveness and readiness thresholds can be tuned independently in
// the Deployment spec as the application grows.
func (h *HealthHandler) Readiness(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
