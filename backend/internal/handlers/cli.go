package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/wxops/wxops-portal-v2/internal/config"
)

// CLIHandler serves authenticated CLI binary downloads by proxying Gitea
// release assets through the portal's service-account token.  Tenant
// developers never need direct Gitea access — the session cookie is enough.
type CLIHandler struct {
	cfg *config.Config
	hc  *http.Client
}

func NewCLIHandler(cfg *config.Config) *CLIHandler {
	return &CLIHandler{
		cfg: cfg,
		hc:  &http.Client{Timeout: 10 * time.Minute},
	}
}

// platformFilenames maps the :platform path parameter to the release asset
// filename produced by the CI workflow.
var platformFilenames = map[string]string{
	"linux-amd64":  "wxops-linux-amd64",
	"linux-arm64":  "wxops-linux-arm64",
	"darwin-amd64": "wxops-darwin-amd64",
	"darwin-arm64": "wxops-darwin-arm64",
}

// Version returns the tag name of the latest portal release, which equals the
// latest CLI version since CLI binaries are attached to the same release.
//
// @Summary      Get latest CLI version
// @Description  Returns the tag name of the latest portal release. CLI binaries are attached to the same release, so this reflects the current CLI version.
// @Tags         cli
// @Produce      json
// @Success      200  {object}  map[string]string  "version tag, e.g. {\"version\":\"v0.4.1\"}"
// @Security     CookieAuth
// @Router       /api/v1/cli/version [get]
func (h *CLIHandler) Version(c *gin.Context) {
	owner := h.cfg.GiteaPortalOwner
	if owner == "" {
		owner = h.cfg.GiteaCatalogOwner
	}
	repo := h.cfg.GiteaPortalRepo

	if h.cfg.GiteaURL == "" || owner == "" {
		c.JSON(http.StatusOK, gin.H{"version": "unknown"})
		return
	}

	relURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/releases?limit=1", h.cfg.GiteaURL, owner, repo)
	relReq, _ := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, relURL, nil)
	relReq.Header.Set("Authorization", "token "+h.cfg.GiteaToken)

	relResp, err := h.hc.Do(relReq)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"version": "unknown"})
		return
	}
	defer relResp.Body.Close()

	var releases []struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(relResp.Body).Decode(&releases); err != nil || len(releases) == 0 {
		c.JSON(http.StatusOK, gin.H{"version": "unknown"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"version": releases[0].TagName})
}

// Download streams the latest wxops CLI binary for the requested platform.
//
// @Summary      Download wxops CLI binary
// @Description  Proxies the latest release asset from the portal Gitea repo using the service-account token.  Requires a valid session cookie.
// @Tags         cli
// @Param        platform path string true "Target platform (linux-amd64, linux-arm64, darwin-amd64, darwin-arm64)"
// @Produce      application/octet-stream
// @Success      200  {file}    binary  "CLI binary"
// @Failure      400  {object}  map[string]string
// @Failure      502  {object}  map[string]string
// @Security     CookieAuth
// @Router       /api/v1/cli/download/{platform} [get]
func (h *CLIHandler) Download(c *gin.Context) {
	platform := c.Param("platform")
	filename, ok := platformFilenames[platform]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("unknown platform %q; valid: linux-amd64, linux-arm64, darwin-amd64, darwin-arm64", platform)})
		return
	}

	owner := h.cfg.GiteaPortalOwner
	if owner == "" {
		owner = h.cfg.GiteaCatalogOwner
	}
	repo := h.cfg.GiteaPortalRepo

	if h.cfg.GiteaURL == "" || owner == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "CLI downloads are not configured on this portal instance"})
		return
	}

	// Fetch the latest release from Gitea to find the asset URL.
	relURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/releases?limit=1", h.cfg.GiteaURL, owner, repo)
	relReq, _ := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, relURL, nil)
	relReq.Header.Set("Authorization", "token "+h.cfg.GiteaToken)

	relResp, err := h.hc.Do(relReq)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not reach Gitea"})
		return
	}
	defer relResp.Body.Close()

	var releases []struct {
		TagName string `json:"tag_name"`
		Assets  []struct {
			Name        string `json:"name"`
			DownloadURL string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(relResp.Body).Decode(&releases); err != nil || len(releases) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "no releases found in portal repo"})
		return
	}

	latest := releases[0]
	var assetURL string
	for _, a := range latest.Assets {
		if a.Name == filename {
			assetURL = a.DownloadURL
			break
		}
	}
	if assetURL == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("asset %q not found in release %s", filename, latest.TagName)})
		return
	}

	// Stream the binary from Gitea → client.
	binReq, _ := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, assetURL, nil)
	binReq.Header.Set("Authorization", "token "+h.cfg.GiteaToken)

	binResp, err := h.hc.Do(binReq)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to download asset from Gitea"})
		return
	}
	defer binResp.Body.Close()

	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	c.Header("Content-Type", "application/octet-stream")
	if cl := binResp.Header.Get("Content-Length"); cl != "" {
		c.Header("Content-Length", cl)
	}
	c.Status(http.StatusOK)
	io.Copy(c.Writer, binResp.Body) //nolint:errcheck
}
