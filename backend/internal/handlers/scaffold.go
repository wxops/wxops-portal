package handlers

import (
	"context"
	"fmt"
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
	"github.com/wxops/wxops-portal-v2/internal/config"
	"github.com/wxops/wxops-portal-v2/internal/gitea"
	"github.com/wxops/wxops-portal-v2/internal/scaffold"
	"github.com/wxops/wxops-portal-v2/internal/vault"
	"gopkg.in/yaml.v3"
)

// ScaffoldHandler serves project scaffolding endpoints.
type ScaffoldHandler struct {
	giteaClient *gitea.Client // nil in local-dev mode
	vaultClient *vault.Client // nil when VAULT_ADDR is not set
	cfg         *config.Config

	templateCache     []scaffold.TemplateMeta
	templateCacheTime time.Time
	templateCacheMu   sync.RWMutex

	portalLabelID   int64 // cached gitops-infra label ID for portal-managed PRs
	portalLabelOnce sync.Once
}

const templateCacheTTL = 5 * time.Minute

// PortalLabelName is the Gitea label attached to every PR the portal creates.
// The activity endpoint filters by this label so it only returns portal PRs,
// never other gitops-infra changes.
const PortalLabelName = "portal-managed"
const portalLabelColor = "#7c3aed"

// ensurePortalLabel lazily creates the "portal-managed" label in gitops-infra
// and caches the label ID for subsequent PR creations.
func (h *ScaffoldHandler) ensurePortalLabel(ctx context.Context) int64 {
	h.portalLabelOnce.Do(func() {
		if h.giteaClient == nil {
			return
		}
		id, err := h.giteaClient.EnsureLabel(ctx, h.cfg.GiteaCatalogOwner, h.cfg.GiteaCatalogRepo, PortalLabelName, portalLabelColor)
		if err != nil {
			log.Printf("[scaffold] warning: failed to ensure portal label: %v", err)
			return
		}
		h.portalLabelID = id
	})
	return h.portalLabelID
}

// NewScaffoldHandler constructs a ScaffoldHandler.
func NewScaffoldHandler(gc *gitea.Client, vc *vault.Client, cfg *config.Config) *ScaffoldHandler {
	return &ScaffoldHandler{giteaClient: gc, vaultClient: vc, cfg: cfg}
}

// ListTemplates returns available scaffold templates.
//
// @Summary      List scaffold templates
// @Description  Returns scaffold templates — from the local filesystem (dev) or from the Gitea template repository (production).
// @Tags         scaffold
// @Produce      json
// @Success      200  {object}  map[string]any  "templates array"
// @Failure      502  {object}  map[string]string
// @Security     CookieAuth
// @Router       /api/v1/scaffold/templates [get]
func (h *ScaffoldHandler) ListTemplates(c *gin.Context) {
	// Local dev mode — read from filesystem (no cache, changes are instant).
	if h.cfg.ScaffoldLocalDir != "" {
		templates, err := scaffold.ListLocalTemplates(h.cfg.ScaffoldLocalDir)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"templates": templates})
		return
	}

	if h.giteaClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "scaffold not configured: set SCAFFOLD_LOCAL_DIR or GITEA_URL"})
		return
	}

	// Serve from cache if fresh.
	h.templateCacheMu.RLock()
	if h.templateCache != nil && time.Since(h.templateCacheTime) < templateCacheTTL {
		cached := h.templateCache
		h.templateCacheMu.RUnlock()
		c.JSON(http.StatusOK, gin.H{"templates": cached})
		return
	}
	h.templateCacheMu.RUnlock()

	// Cache miss — fetch from Gitea.
	templates, err := h.fetchTemplates(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	h.templateCacheMu.Lock()
	h.templateCache = templates
	h.templateCacheTime = time.Now()
	h.templateCacheMu.Unlock()

	c.JSON(http.StatusOK, gin.H{"templates": templates})
}

func (h *ScaffoldHandler) fetchTemplates(ctx context.Context) ([]scaffold.TemplateMeta, error) {
	templateOwner := h.cfg.GiteaTemplateOwner
	if templateOwner == "" {
		templateOwner = h.cfg.GiteaCatalogOwner
	}
	templateRepo := h.cfg.GiteaTemplateRepo

	dirs, err := h.giteaClient.ListRepoDirs(ctx, templateOwner, templateRepo, "")
	if err != nil {
		return nil, err
	}

	var templates []scaffold.TemplateMeta
	for _, dir := range dirs {
		meta := scaffold.TemplateMeta{Name: dir}
		if data, err := h.giteaClient.GetRepoFile(ctx, templateOwner, templateRepo, dir+"/template.yaml"); err == nil {
			_ = yaml.Unmarshal(data, &meta)
			if meta.Name == "" {
				meta.Name = dir
			}
		}
		templates = append(templates, meta)
	}
	if templates == nil {
		templates = []scaffold.TemplateMeta{}
	}
	return templates, nil
}

// GetTemplateTree returns the file tree of a scaffold template subdirectory.
func (h *ScaffoldHandler) GetTemplateTree(c *gin.Context) {
	templateID := c.Param("id")

	// Local dev mode — read from filesystem.
	if h.cfg.ScaffoldLocalDir != "" {
		var tree []string
		root := filepath.Join(h.cfg.ScaffoldLocalDir, templateID)
		_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			rel, _ := filepath.Rel(root, path)
			if rel == "." || rel == "template.yaml" {
				return nil
			}
			if info.IsDir() {
				tree = append(tree, rel+"/")
			} else {
				tree = append(tree, rel)
			}
			return nil
		})
		if tree == nil {
			tree = []string{}
		}
		c.JSON(http.StatusOK, gin.H{"templateId": templateID, "tree": tree})
		return
	}

	if h.giteaClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "scaffold not configured"})
		return
	}

	templateOwner := h.cfg.GiteaTemplateOwner
	if templateOwner == "" {
		templateOwner = h.cfg.GiteaCatalogOwner
	}

	var tree []string
	var walkEntries func(dirPath string) error
	walkEntries = func(dirPath string) error {
		entries, err := h.giteaClient.ListRepoContents(c.Request.Context(), templateOwner, h.cfg.GiteaTemplateRepo, dirPath)
		if err != nil {
			return err
		}
		for _, e := range entries {
			rel := e.Path[len(templateID)+1:]
			if rel == "template.yaml" {
				continue
			}
			if e.Type == "dir" {
				tree = append(tree, rel+"/")
				_ = walkEntries(e.Path)
			} else {
				tree = append(tree, rel)
			}
		}
		return nil
	}

	if err := walkEntries(templateID); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if tree == nil {
		tree = []string{}
	}
	c.JSON(http.StatusOK, gin.H{"templateId": templateID, "tree": tree})
}

// CreateProject scaffolds a new project: creates a Gitea repo from
// a golden-path template, generates XTenantApp + catalog manifests.
//
// In local-dev mode (SCAFFOLD_LOCAL_DIR set) the manifests are written to
// a local output directory under SCAFFOLD_LOCAL_DIR/_output/<team>/<app>/
// so you can inspect them without a Gitea instance.
//
// In production mode the handler creates a Gitea repo from template,
// commits all manifests to gitops-infra on a feature branch, and opens a PR.
//
// @Summary      Scaffold a new project
// @Description  Creates a Gitea repo from a golden-path template, generates XTenantApp CR and catalog entities. Opens a PR to gitops-infra.
// @Tags         scaffold
// @Accept       json
// @Produce      json
// ListRepos returns non-template repos for an organisation from Gitea.
//
// @Summary      List team repos
// @Description  Returns non-template repos for the given owner org.
// @Tags         scaffold
// @Produce      json
// @Param        owner  query   string  true  "Org/team name"
// @Success      200   {object}  map[string]any
// @Failure      403   {object}  map[string]string
// @Failure      503   {object}  map[string]string
// @Security     CookieAuth
// @Router       /api/v1/scaffold/repos [get]
func (h *ScaffoldHandler) ListRepos(c *gin.Context) {
	if h.giteaClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Gitea not configured — repo listing requires GITEA_URL"})
		return
	}

	owner := c.Query("owner")
	if owner == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "owner query param required"})
		return
	}

	session := auth.GetSession(c)
	if session == nil || !auth.MemberOfTeam(session.Groups, owner) {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a member of " + owner})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))

	repos, total, err := h.giteaClient.ListOrgRepos(c.Request.Context(), owner, page, limit)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"repos": repos, "total": total, "page": page, "limit": limit})
}

// @Param        body  body      scaffold.CreateProjectRequest  true  "Project scaffold request"
// @Success      201   {object}  scaffold.CreateProjectResponse
// @Failure      400   {object}  map[string]string
// @Failure      403   {object}  map[string]string
// @Failure      502   {object}  map[string]string
// @Security     CookieAuth
// @Router       /api/v1/scaffold/projects [post]
func (h *ScaffoldHandler) CreateProject(c *gin.Context) {
	var req scaffold.CreateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Authorisation: the user must belong to the requested team.
	session := auth.GetSession(c)
	if session == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	if !auth.MemberOfTeam(session.Groups, req.Team) {
		c.JSON(http.StatusForbidden, gin.H{"error": fmt.Sprintf("you are not a member of %q", req.Team)})
		return
	}

	// Check if a repo with this name already exists under the team org.
	if h.giteaClient != nil {
		if h.giteaClient.RepoExists(c.Request.Context(), req.Team, req.AppName) {
			scaffoldErr(c, http.StatusConflict, stepValidating, fmt.Sprintf("repository %s/%s already exists — choose a different name", req.Team, req.AppName))
			return
		}

		// Also check if a project config already exists in gitops-infra
		// (covers edge cases like manual repo creation or partially-failed prior scaffold).
		gitopsOwner := h.cfg.GiteaCatalogOwner
		gitopsRepo := h.cfg.GiteaCatalogRepo
		configPath := fmt.Sprintf("tenants-apps/%s/%s/base/xtenant-app.yaml", req.Team, req.AppName)
		if _, err := h.giteaClient.GetRepoFile(c.Request.Context(), gitopsOwner, gitopsRepo, configPath); err == nil {
			scaffoldErr(c, http.StatusConflict, stepValidating, fmt.Sprintf("project %s/%s already has config in gitops-infra — choose a different name", req.Team, req.AppName))
			return
		}
	}

	// Build manifests (shared between local and Gitea modes).
	giteaURL := h.cfg.GiteaURL
	if giteaURL == "" {
		giteaURL = "https://gitea.example.com"
	}

	xApp := scaffold.NewXTenantAppBase(&req, giteaURL)
	if err := xApp.Validate(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	appYAML, err := xApp.Marshal()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "marshal XTenantApp: " + err.Error()})
		return
	}

	// Manifests keyed by filename (relative to base/ directory).
	xrFiles := map[string][]byte{
		"xtenant-app.yaml": appYAML,
	}

	// XTenantDatabase — only when database toggle is on.
	if req.DatabaseSecrets {
		xDb := scaffold.NewXTenantDatabase(&req)
		dbYAML, err := xDb.Marshal()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "marshal XTenantDatabase: " + err.Error()})
			return
		}
		xrFiles["xtenant-database.yaml"] = dbYAML
	}

	// ExternalSecrets — generated when vault or database is enabled.
	if req.VaultSecrets {
		es := scaffold.NewEnvExternalSecret(&req)
		esYAML, err := es.Marshal()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "marshal ExternalSecret (env): " + err.Error()})
			return
		}
		xrFiles["external-secret-env.yaml"] = esYAML
	}
	if req.DatabaseSecrets {
		es := scaffold.NewDbExternalSecret(&req)
		esYAML, err := es.Marshal()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "marshal ExternalSecret (db): " + err.Error()})
			return
		}
		xrFiles["external-secret-db.yaml"] = esYAML
	}

	catalogEntities := scaffold.GenerateCatalogEntities(&req, giteaURL)

	// ── Local dev mode ──────────────────────────────────────────────────────
	if h.cfg.ScaffoldLocalDir != "" {
		resp, err := h.writeLocal(&req, xrFiles, catalogEntities)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, resp)
		return
	}

	// ── Production mode (Gitea) ─────────────────────────────────────────────
	if h.giteaClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "scaffold not configured"})
		return
	}
	h.createViaGitea(c, &req, xrFiles, catalogEntities)
}

// writeLocal persists manifests to the local filesystem for dev testing.
//
// XTenantApp manifests go to _output/ for inspection.
// Catalog entities go to CatalogLocalDir so the catalog store picks them
// up on the next cache refresh — this lets you scaffold a project and
// immediately see it in the catalog UI.
func (h *ScaffoldHandler) writeLocal(req *scaffold.CreateProjectRequest, xrFiles map[string][]byte, entities []scaffold.CatalogEntityPair) (*scaffold.CreateProjectResponse, error) {
	// XR manifests → _output/ (not read by the catalog store).
	outDir := filepath.Join(h.cfg.ScaffoldLocalDir, "_output", req.Team, req.AppName)
	for name, data := range xrFiles {
		full := filepath.Join(outDir, name)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return nil, fmt.Errorf("mkdir %q: %w", filepath.Dir(full), err)
		}
		if err := os.WriteFile(full, data, 0o644); err != nil {
			return nil, fmt.Errorf("write %q: %w", full, err)
		}
	}
	log.Printf("[scaffold] XR output: %s", outDir)

	// Catalog entities → CatalogLocalDir so the catalog UI sees them.
	// ep.Path is relative: "<team>/<kindDir>/<name>.yaml"
	catalogDir := h.cfg.CatalogLocalDir
	if catalogDir != "" {
		for _, ep := range entities {
			full := filepath.Join(catalogDir, ep.Path)
			if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
				return nil, fmt.Errorf("mkdir catalog %q: %w", filepath.Dir(full), err)
			}
			if err := os.WriteFile(full, ep.YAML, 0o644); err != nil {
				return nil, fmt.Errorf("write catalog %q: %w", full, err)
			}
			log.Printf("[scaffold] catalog entity: %s", full)
		}
	}

	return &scaffold.CreateProjectResponse{
		RepoURL: fmt.Sprintf("file://%s", outDir),
		Status:  "Project created locally",
		AppName: req.AppName,
		Team:    req.Team,
	}, nil
}

// Scaffold step constants — used by both backend errors and frontend progress.
const (
	stepValidating   = 1
	stepCreatingRepo = 2
	stepTemplate     = 3
	stepGitOpsConfig = 4
	stepOpenPR       = 5
)

func scaffoldErr(c *gin.Context, status, step int, msg string) {
	c.JSON(status, gin.H{"error": msg, "failedStep": step})
}

// createViaGitea runs the full Gitea orchestration:
// 1. Create empty repo → push template files in one commit
// 2. Branch gitops-infra → commit all XR + catalog manifests in one commit → open PR
// 3. Write vault secrets (only after all remote operations succeed)
func (h *ScaffoldHandler) createViaGitea(c *gin.Context, req *scaffold.CreateProjectRequest, xrFiles map[string][]byte, entities []scaffold.CatalogEntityPair) {
	ctx := c.Request.Context()

	templateOwner := h.cfg.GiteaTemplateOwner
	if templateOwner == "" {
		templateOwner = h.cfg.GiteaCatalogOwner
	}
	templateRepo := h.cfg.GiteaTemplateRepo

	// Step 2: Create an empty repo for the new project (default branch: develop).
	repoInfo, err := h.giteaClient.CreateEmptyRepo(ctx, req.Team, req.AppName, req.Description)
	if err != nil {
		scaffoldErr(c, http.StatusBadGateway, stepCreatingRepo, fmt.Sprintf("create repo: %s", err))
		return
	}

	// Create staging and main BEFORE pushing template files. At this point
	// develop has only the auto_init README, so all three start identical.
	// Code reaches staging/main only through merge PRs — never direct push.
	for _, b := range []struct {
		name      string
		requirePR bool
	}{
		{"staging", true},
		{"main", true},
	} {
		if err := h.giteaClient.CreateBranch(ctx, req.Team, req.AppName, b.name, "develop"); err != nil {
			log.Printf("[scaffold] warning: failed to create %s branch: %v", b.name, err)
		}
	}

	// Protect all three golden-path branches. Protection rules prevent deletion
	// and force-pushes by non-admins regardless of the enablePush setting.
	// develop: allow direct push (CI writes here); staging/main: require PR + 1 approval.
	// The CI bot is whitelisted on main so it can push changelog commits
	// (chore(release): [skip ci]) directly without hitting 403.
	botUser := h.cfg.GiteaBotUsername
	for _, b := range []struct {
		name      string
		requirePR bool
		whitelist []string
	}{
		{"develop", false, nil},
		{"staging", true, nil},
		{"main", true, func() []string {
			if botUser != "" {
				return []string{botUser}
			}
			return nil
		}()},
	} {
		if err := h.giteaClient.ProtectBranch(ctx, req.Team, req.AppName, b.name, b.requirePR, b.whitelist...); err != nil {
			log.Printf("[scaffold] warning: failed to protect %s branch: %v", b.name, err)
		}
	}

	// Step 3: Push template files to develop only — triggers the first dev-* image build.
	// staging and main remain empty (only README.md).
	templateFiles, err := h.giteaClient.FetchRepoTree(ctx, templateOwner, templateRepo, req.TemplateID)
	if err != nil {
		log.Printf("[scaffold] warning: failed to fetch template %q: %v", req.TemplateID, err)
	}
	if len(templateFiles) > 0 {
		vars := buildTemplateVars(req, h.cfg.GiteaURL, h.cfg.GiteaBotUsername, h.cfg.GiteaBotEmail)
		batch := make(map[string][]byte, len(templateFiles))
		for _, f := range templateFiles {
			if f.Path == "template.yaml" {
				continue
			}
			path := substituteVars(f.Path, vars)
			content := substituteVars(string(f.Content), vars)
			batch[path] = []byte(content)
		}
		if len(batch) > 0 {
			commitMsg := fmt.Sprintf("feat(scaffold): bootstrap from template %s", req.TemplateID)
			if err := h.giteaClient.CommitFiles(ctx, req.Team, req.AppName, "develop", commitMsg, batch); err != nil {
				scaffoldErr(c, http.StatusBadGateway, stepTemplate, fmt.Sprintf("push template files: %s", err))
				return
			}
		}
	}

	gitopsOwner := h.cfg.GiteaCatalogOwner
	gitopsRepo := h.cfg.GiteaCatalogRepo
	catalogPath := h.cfg.GiteaCatalogPath
	labelID := h.ensurePortalLabel(ctx)

	// ── Step 4a: Catalog entities — commit directly to main. ──
	// These are metadata only (lifecycle: experimental), no infrastructure impact.
	// The entity is visible in the portal immediately — same as Backstage behavior.
	catalogFiles := make(map[string][]byte)
	for _, ep := range entities {
		catalogFiles[catalogPath+"/"+ep.Path] = ep.YAML
	}

	catalogCommit := fmt.Sprintf("feat(catalog): register %s/%s", req.Team, req.AppName)
	if err := h.giteaClient.CommitFiles(ctx, gitopsOwner, gitopsRepo, "main", catalogCommit, catalogFiles); err != nil {
		scaffoldErr(c, http.StatusBadGateway, stepGitOpsConfig, fmt.Sprintf("commit catalog entities: %s", err))
		return
	}

	// ── Step 4b: Infrastructure PR — Kustomize base (no dev overlay). ──
	// The dev overlay is created separately via the Promote flow once the
	// developer confirms the service is ready for development promotion.
	infraBranch := fmt.Sprintf("scaffold/%s/%s-%d", req.Team, req.AppName, time.Now().Unix())
	if err := h.giteaClient.CreateBranch(ctx, gitopsOwner, gitopsRepo, infraBranch, "main"); err != nil {
		scaffoldErr(c, http.StatusBadGateway, stepGitOpsConfig, fmt.Sprintf("create infra branch: %s", err))
		return
	}

	baseDir := fmt.Sprintf("tenants-apps/%s/%s/base", req.Team, req.AppName)

	infraFiles := make(map[string][]byte)
	var baseResources []string
	for filename, data := range xrFiles {
		infraFiles[baseDir+"/"+filename] = data
		baseResources = append(baseResources, filename)
	}

	baseKustomization, err := scaffold.BuildBaseKustomization(baseResources)
	if err != nil {
		scaffoldErr(c, http.StatusInternalServerError, stepGitOpsConfig, fmt.Sprintf("build base kustomization: %s", err))
		return
	}
	infraFiles[baseDir+"/kustomization.yaml"] = baseKustomization

	imageUpdater := scaffold.NewImageUpdater(req, h.cfg.GiteaURL, scaffold.GitopsRepoURL(h.cfg.GiteaURL, gitopsOwner, gitopsRepo))
	imageUpdaterYAML, err := imageUpdater.Marshal()
	if err != nil {
		scaffoldErr(c, http.StatusInternalServerError, stepGitOpsConfig, fmt.Sprintf("build image-updater: %s", err))
		return
	}
	infraFiles[fmt.Sprintf("tenants/%s/%s-image-updater.yaml", req.Team, req.AppName)] = imageUpdaterYAML

	infraCommit := fmt.Sprintf("feat(scaffold): infrastructure for %s/%s", req.Team, req.AppName)
	if err := h.giteaClient.CommitFiles(ctx, gitopsOwner, gitopsRepo, infraBranch, infraCommit, infraFiles); err != nil {
		scaffoldErr(c, http.StatusBadGateway, stepGitOpsConfig, fmt.Sprintf("commit infrastructure: %s", err))
		return
	}

	// Step 5: Open infrastructure PR.
	prTitle := fmt.Sprintf("[Scaffold] New project: %s/%s", req.Team, req.AppName)
	prBody := buildPRBody(req, repoInfo.HTMLURL)
	if labelID > 0 {
		_, err = h.giteaClient.CreatePullRequest(ctx, gitopsOwner, gitopsRepo, prTitle, prBody, infraBranch, "main", labelID)
	} else {
		_, err = h.giteaClient.CreatePullRequest(ctx, gitopsOwner, gitopsRepo, prTitle, prBody, infraBranch, "main")
	}
	if err != nil {
		scaffoldErr(c, http.StatusBadGateway, stepOpenPR, fmt.Sprintf("create PR: %s", err))
		return
	}

	c.JSON(http.StatusCreated, scaffold.CreateProjectResponse{
		RepoURL: repoInfo.HTMLURL,
		Status:  "Project created — platform review PR opened",
		AppName: req.AppName,
		Team:    req.Team,
	})
}

// UpdateSecrets writes (creates or replaces) vault secrets for an existing
// project. This lets users upload a new .env after the initial scaffold.
//
// @Summary      Write vault secrets for a project
// @Description  Creates or updates vault secrets at {team}/{appName}/env.
// @Tags         scaffold
// @Accept       json
// @Produce      json
// @Param        body  body  object  true  "team, appName, envVars[]"
// @Success      200   {object}  map[string]string
// @Failure      400   {object}  map[string]string
// @Failure      403   {object}  map[string]string
// @Failure      503   {object}  map[string]string
// @Security     CookieAuth
// @Router       /api/v1/scaffold/secrets [put]
func (h *ScaffoldHandler) UpdateSecrets(c *gin.Context) {
	var req struct {
		Team      string              `json:"team" binding:"required"`
		AppName   string              `json:"appName" binding:"required"`
		TargetEnv string              `json:"targetEnv"` // "dev" | "staging" | "production"; defaults to "dev"
		EnvVars   []scaffold.KeyValue `json:"envVars"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	session := auth.GetSession(c)
	if session == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	if !auth.MemberOfTeam(session.Groups, req.Team) {
		c.JSON(http.StatusForbidden, gin.H{"error": fmt.Sprintf("you are not a member of %q", req.Team)})
		return
	}

	if len(req.EnvVars) == 0 {
		c.JSON(http.StatusOK, gin.H{"written": 0})
		return
	}

	if h.vaultClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "vault not configured (set VAULT_ADDR and VAULT_TOKEN)"})
		return
	}

	// Verify the project actually exists before writing secrets —
	// prevents accidental Vault writes for non-existent or deleted projects.
	if h.giteaClient != nil {
		if !h.giteaClient.RepoExists(c.Request.Context(), req.Team, req.AppName) {
			c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("repository %s/%s does not exist — cannot write secrets for a non-existent project", req.Team, req.AppName)})
			return
		}

		gitopsOwner := h.cfg.GiteaCatalogOwner
		gitopsRepo := h.cfg.GiteaCatalogRepo
		configPath := fmt.Sprintf("tenants-apps/%s/%s/base/xtenant-app.yaml", req.Team, req.AppName)
		if _, err := h.giteaClient.GetRepoFile(c.Request.Context(), gitopsOwner, gitopsRepo, configPath); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("project config for %s/%s not found in gitops-infra — scaffold the project first", req.Team, req.AppName)})
			return
		}
	}

	secretData := make(map[string]string, len(req.EnvVars))
	for _, kv := range req.EnvVars {
		if kv.Key != "" {
			secretData[kv.Key] = kv.Value
		}
	}
	if len(secretData) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no env vars provided"})
		return
	}

	targetEnv := req.TargetEnv
	if targetEnv == "" {
		targetEnv = "dev"
	}
	vaultPath := fmt.Sprintf("%s/%s/%s/env", req.Team, req.AppName, targetEnv)
	if err := h.vaultClient.WriteSecret(c.Request.Context(), vaultPath, secretData); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("vault write: %s", err)})
		return
	}

	log.Printf("[scaffold] updated %d secrets at vault: %s", len(secretData), vaultPath)
	c.JSON(http.StatusOK, gin.H{
		"message":   fmt.Sprintf("wrote %d secrets to %s", len(secretData), vaultPath),
		"vaultPath": vaultPath,
	})
}

// GetProjectConfig reads the current XTenantApp YAML for a project and returns it as JSON.
//
// @Summary      Get project config
// @Description  Returns the current XTenantApp configuration for a project.
// @Tags         scaffold
// @Produce      json
// @Param        team     path   string  true  "Team name"
// @Param        appName  path   string  true  "App name"
// @Success      200  {object}  scaffold.XTenantApp
// @Failure      403  {object}  map[string]string
// @Failure      404  {object}  map[string]string
// @Security     CookieAuth
// @Router       /api/v1/scaffold/projects/{team}/{appName}/config [get]
func (h *ScaffoldHandler) GetProjectConfig(c *gin.Context) {
	team := c.Param("team")
	appName := c.Param("appName")

	session := auth.GetSession(c)
	if session == nil || !auth.MemberOfTeam(session.Groups, team) {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a member of " + team})
		return
	}

	filePath := fmt.Sprintf("tenants-apps/%s/%s/base/xtenant-app.yaml", team, appName)

	var data []byte
	var err error

	if h.cfg.ScaffoldLocalDir != "" {
		data, err = os.ReadFile(filepath.Join(h.cfg.ScaffoldLocalDir, "_output", team, appName, "base", "xtenant-app.yaml"))
	} else if h.giteaClient != nil {
		data, err = h.giteaClient.GetFile(c.Request.Context(), filePath)
	} else {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no config source configured"})
		return
	}

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": fmt.Sprintf("XTenantApp config not found for %s/%s. This may not have been scaffolded through the portal, or the PR has not been merged yet.", team, appName),
		})
		return
	}

	var app scaffold.XTenantApp
	if err := yaml.Unmarshal(data, &app); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "parse config: " + err.Error()})
		return
	}

	// Merge dev overlay patch (replicas, resources, ingress, secretsFrom) into the
	// base so the edit-config form receives a unified view of the current dev config.
	patchPath := fmt.Sprintf("tenants-apps/%s/%s/overlays/dev/patch-xtenant-app.yaml", team, appName)
	var patchData []byte
	if h.cfg.ScaffoldLocalDir != "" {
		patchData, _ = os.ReadFile(filepath.Join(h.cfg.ScaffoldLocalDir, "_output", team, appName, "overlays", "dev", "patch-xtenant-app.yaml"))
	} else if h.giteaClient != nil {
		patchData, _ = h.giteaClient.GetFile(c.Request.Context(), patchPath)
	}
	if patchData != nil {
		var patch scaffold.XTenantApp
		if err := yaml.Unmarshal(patchData, &patch); err == nil {
			scaffold.MergeEnvPatch(&app, &patch)
		}
	}

	// Also try to read the XTenantDatabase config (optional — may not exist).
	result := gin.H{"app": app}
	dbPath := fmt.Sprintf("tenants-apps/%s/%s/base/xtenant-database.yaml", team, appName)
	var dbData []byte
	if h.cfg.ScaffoldLocalDir != "" {
		dbData, _ = os.ReadFile(filepath.Join(h.cfg.ScaffoldLocalDir, "_output", team, appName, "base", "xtenant-database.yaml"))
	} else if h.giteaClient != nil {
		dbData, _ = h.giteaClient.GetFile(c.Request.Context(), dbPath)
	}
	if dbData != nil {
		var db scaffold.XTenantDatabase
		if err := yaml.Unmarshal(dbData, &db); err == nil {
			result["database"] = db
		}
	}

	c.JSON(http.StatusOK, result)
}

// UpdateProjectConfig updates the XTenantApp YAML for a project via PR.
//
// @Summary      Update project config
// @Description  Updates the XTenantApp configuration. Creates a PR in Gitea mode.
// @Tags         scaffold
// @Accept       json
// @Produce      json
// @Param        team     path   string                        true  "Team name"
// @Param        appName  path   string                        true  "App name"
// @Param        body     body   scaffold.UpdateConfigRequest   true  "Updated config"
// @Success      200  {object}  map[string]any
// @Failure      400  {object}  map[string]string
// @Failure      403  {object}  map[string]string
// @Security     CookieAuth
// @Router       /api/v1/scaffold/projects/{team}/{appName}/config [put]
func (h *ScaffoldHandler) UpdateProjectConfig(c *gin.Context) {
	team := c.Param("team")
	appName := c.Param("appName")

	session := auth.GetSession(c)
	if session == nil || !auth.MemberOfTeam(session.Groups, team) {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a member of " + team})
		return
	}

	var req scaffold.UpdateConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Build XTenantApp base from the update request.
	// Only platform feature toggles and env-agnostic config are updated here.
	// Env-specific values (replicas, resources, ingress host) live in overlay
	// patches and are managed via the Promote flow.
	createReq := &scaffold.CreateProjectRequest{
		AppName:    appName,
		Team:       team,
		TemplateID: req.TemplateID,
		AppFlavor:  req.AppFlavor,
		Namespace:     req.Namespace,
		ContainerPort: req.ContainerPort,
		Reloader:      req.Reloader,
		VaultSecrets:    req.VaultSecrets,
		DatabaseSecrets: req.DatabaseSecrets,
		CertManager: req.CertManager,
		SSOAuth:     req.SSOAuth,
		IngressEnabled:  req.IngressEnabled,
		LivenessPath:    req.LivenessPath,
		ReadinessPath:   req.ReadinessPath,
		RolloutType:     req.RolloutType,
		EnvVars:         req.EnvVars,
		PodAnnotations:  req.PodAnnotations,
		ExtraLabels:     req.ExtraLabels,
	}

	giteaURL := ""
	if h.giteaClient != nil {
		giteaURL = h.cfg.GiteaURL
	}
	app := scaffold.NewXTenantAppBase(createReq, giteaURL)
	appYAML, err := yaml.Marshal(app)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "marshal config: " + err.Error()})
		return
	}

	// Local dev mode — only write the base manifest.
	if h.cfg.ScaffoldLocalDir != "" {
		basePath := filepath.Join(h.cfg.ScaffoldLocalDir, "_output", team, appName, "base", "xtenant-app.yaml")
		if err := os.MkdirAll(filepath.Dir(basePath), 0o755); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "mkdir: " + err.Error()})
			return
		}
		if err := os.WriteFile(basePath, appYAML, 0o644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "write: " + err.Error()})
			return
		}
		log.Printf("[scaffold] config updated: %s/%s", team, appName)
		c.JSON(http.StatusOK, gin.H{"updated": true})
		return
	}

	// Gitea mode — commit base directly to main (dev iteration; no PR review needed for base config).
	if h.giteaClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Gitea not configured"})
		return
	}

	ctx := c.Request.Context()
	gitopsOwner := h.cfg.GiteaCatalogOwner
	gitopsRepo := h.cfg.GiteaCatalogRepo

	commitMsg := fmt.Sprintf("chore(config): update %s/%s XTenantApp base", team, appName)
	configFiles := map[string][]byte{
		fmt.Sprintf("tenants-apps/%s/%s/base/xtenant-app.yaml", team, appName): appYAML,
	}
	if err := h.giteaClient.CommitFiles(ctx, gitopsOwner, gitopsRepo, "main", commitMsg, configFiles); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "commit: " + err.Error()})
		return
	}

	log.Printf("[scaffold] config committed to main: %s/%s by %s", team, appName, session.Username)
	c.JSON(http.StatusOK, gin.H{
		"updated": true,
		"status":  "Config saved to main",
	})
}

func buildPRBody(req *scaffold.CreateProjectRequest, repoURL string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "## New Project: %s\n\n", req.AppName)
	fmt.Fprintf(&b, "**Team:** %s\n", req.Team)
	fmt.Fprintf(&b, "**Template:** %s\n", req.TemplateID)
	if req.AppFlavor != "" {
		fmt.Fprintf(&b, "**App Flavor:** %s\n", req.AppFlavor)
	}
	ns := req.Namespace
	if ns == "" {
		ns = scaffold.DefaultNamespace(req.Team)
	}
	fmt.Fprintf(&b, "**Namespace:** %s\n", ns)
	fmt.Fprintf(&b, "**Repository:** %s\n", repoURL)
	b.WriteString("**Branches:** `develop` (default), `staging`, `main`\n")

	b.WriteString("\n### Infrastructure (this PR)\n\n")
	baseDir := fmt.Sprintf("tenants-apps/%s/%s/base", req.Team, req.AppName)
	fmt.Fprintf(&b, "- `%s/kustomization.yaml` — Kustomize base\n", baseDir)
	fmt.Fprintf(&b, "- `%s/xtenant-app.yaml` — XTenantApp CR\n", baseDir)
	if req.DatabaseSecrets {
		fmt.Fprintf(&b, "- `%s/xtenant-database.yaml` — XTenantDatabase CR\n", baseDir)
	}
	if req.VaultSecrets {
		fmt.Fprintf(&b, "- `%s/external-secret-env.yaml` — ExternalSecret (vault env)\n", baseDir)
	}
	if req.DatabaseSecrets {
		fmt.Fprintf(&b, "- `%s/external-secret-db.yaml` — ExternalSecret (db creds)\n", baseDir)
	}
	b.WriteString("\n### Catalog (separate commit)\n\n")
	b.WriteString("Catalog entities are committed directly to main so the project is visible in the portal immediately.\n")

	b.WriteString("\n### After merge\n\n")
	b.WriteString("The Kustomize base will be in place. Use the Promotion panel in the portal to create the dev overlay and promote the lifecycle to `development`.\n")
	b.WriteString("\n---\n*Created via WxOps Portal*\n")
	return b.String()
}

// buildTemplateVars returns a map of placeholder → replacement value for
// template files. Supports both Go template style ({{ .Key }}) and
// double-underscore style (__KEY__) for use in filenames.
func buildTemplateVars(req *scaffold.CreateProjectRequest, giteaURL, botUsername, botEmail string) map[string]string {
	ns := req.Namespace
	if ns == "" {
		ns = scaffold.DefaultNamespace(req.Team)
	}

	port := "8080"
	if req.ContainerPort != nil {
		port = strconv.Itoa(int(*req.ContainerPort))
	}

	return map[string]string{
		"ProjectName":     req.AppName,
		"ProjectOwner":    req.Team,
		"TenantNamespace": ns,
		"Namespace":       ns,
		"Description":     req.Description,
		"TemplateId":      req.TemplateID,
		"AppFlavor":       req.AppFlavor,
		"Port":            port,
		"GiteaURL":        giteaURL,
		"RuntimeVersion":  req.RuntimeVersion,
		"PackageManager":  req.PackageManager,
		"BotUsername":     botUsername,
		"BotEmail":        botEmail,
	}
}

// substituteVars replaces template placeholders in s with their values.
// Handles: {{ .Key }}, {{.Key}}, __KEY__
func substituteVars(s string, vars map[string]string) string {
	for key, val := range vars {
		// Go template style with varying whitespace: {{ .Key }}, {{.Key}}, {{ .Key}}
		s = strings.ReplaceAll(s, "{{ ."+key+" }}", val)
		s = strings.ReplaceAll(s, "{{."+key+"}}", val)
		s = strings.ReplaceAll(s, "{{ ."+key+"}}", val)
		s = strings.ReplaceAll(s, "{{."+key+" }}", val)
		// Double-underscore style for filenames
		s = strings.ReplaceAll(s, "__"+key+"__", val)
	}
	return s
}
