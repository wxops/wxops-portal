// Package server wires together all components and configures the Gin router.
package server

import (
	"context"
	"fmt"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/wxops/wxops-portal-v2/internal/auth"
	"github.com/wxops/wxops-portal-v2/internal/catalog"
	"github.com/wxops/wxops-portal-v2/internal/cluster"
	"github.com/wxops/wxops-portal-v2/internal/config"
	"github.com/wxops/wxops-portal-v2/internal/gitea"
	"github.com/wxops/wxops-portal-v2/internal/handlers"
)

// Server bundles the Gin engine and config.
type Server struct {
	router *gin.Engine
	cfg    *config.Config
}

// New initialises all dependencies and builds the router.
func New(cfg *config.Config) (*Server, error) {
	// Session manager (AES-256-GCM encrypted cookies).
	sm, err := auth.NewSessionManager(cfg.SessionSecret)
	if err != nil {
		return nil, fmt.Errorf("session manager: %w", err)
	}

	// OIDC client pointing at the Pinniped Supervisor FederationDomain.
	// Build the optional custom TLS config first (nil = use system pool).
	oidcTLSCfg, err := cfg.OIDCHTTPClient()
	if err != nil {
		return nil, fmt.Errorf("OIDC TLS config: %w", err)
	}
	oidcClient, err := auth.NewOIDCClient(
		context.Background(),
		cfg.OIDCIssuerURL,
		cfg.OIDCClientID,
		cfg.OIDCClientSecret,
		cfg.OIDCRedirectURI,
		cfg.OIDCScopes,
		oidcTLSCfg,
	)
	if err != nil {
		return nil, fmt.Errorf("OIDC client: %w", err)
	}

	// Cluster registry: static file (dev/testing) OR K8s Secrets (GitOps/prod).
	// When CLUSTERS_CONFIG_FILE or CLUSTERS_CONFIG is set, the StaticRegistry is
	// used and no hub cluster connection is required.  Otherwise, Discovery reads
	// cluster registrations from Secrets in the hub cluster.
	var registry cluster.Registry
	if cfg.ClustersConfigFile != "" || cfg.ClustersConfig != "" {
		registry, err = cluster.NewStaticRegistry(cfg.ClustersConfigFile, cfg.ClustersConfig)
		if err != nil {
			return nil, fmt.Errorf("static cluster registry: %w", err)
		}
	} else {
		registry, err = cluster.NewDiscovery(cfg.KubeconfigPath, cfg.ClusterNamespace)
		if err != nil {
			return nil, fmt.Errorf("cluster discovery: %w", err)
		}
	}

	// Catalog store — backed by a RepoReader.
	// Priority: CATALOG_LOCAL_DIR (local filesystem, dev/testing) >
	//           GITEA_URL (Gitea repo, production) > nil (returns error on fetch).
	//
	// catalogPath is only meaningful for the Gitea reader — it is the directory
	// prefix inside the repo (e.g. "catalog"). For LocalReader the kind dirs
	// (components/, apis/, ...) sit directly at the root of CATALOG_LOCAL_DIR,
	// so catalogPath must be empty regardless of what GITEA_CATALOG_PATH is set to.
	var catalogReader catalog.RepoReader
	var catalogPath string
	switch {
	case cfg.CatalogLocalDir != "":
		catalogReader = catalog.NewLocalReader(cfg.CatalogLocalDir)
		catalogPath = "" // kind dirs are at the root of the local dir
	case cfg.GiteaURL != "":
		catalogReader = gitea.New(cfg.GiteaURL, cfg.GiteaToken, cfg.GiteaCatalogOwner, cfg.GiteaCatalogRepo)
		catalogPath = cfg.GiteaCatalogPath
	}
	catalogStore := catalog.NewStore(catalogReader, catalogPath)

	// HTTP handlers.
	healthH := handlers.NewHealthHandler()
	authH := handlers.NewAuthHandler(oidcClient, sm, cfg)
	clusterH := handlers.NewClusterHandler(registry, oidcClient, sm)
	catalogH := handlers.NewCatalogHandler(catalogStore)

	// Use gin.New() instead of gin.Default() so we control the logger format.
	// All request log lines are prefixed with [backend] to match the stdlib
	// log prefix set in main.go — making backend vs frontend vs nginx lines
	// distinguishable in the combined container log stream.
	gin.DefaultWriter = os.Stdout
	gin.DefaultErrorWriter = os.Stderr
	router := gin.New()
	router.Use(gin.Recovery())
	router.Use(gin.LoggerWithFormatter(func(p gin.LogFormatterParams) string {
		// Suppress probe endpoints — they fire every few seconds and add no signal.
		if p.Path == "/healthz" || p.Path == "/readyz" {
			return ""
		}
		return fmt.Sprintf("[backend] %s | %3d | %13v | %-7s %s\n",
			p.TimeStamp.Format("2006/01/02 15:04:05"),
			p.StatusCode,
			p.Latency,
			p.Method,
			p.Path,
		)
	}))
	router.Use(cors(cfg.FrontendURL))

	// ── Kubernetes probe routes (no auth, no session) ───────────────────────
	router.GET("/healthz", healthH.Liveness)
	router.GET("/readyz", healthH.Readiness)

	// ── Auth routes (no session required) ───────────────────────────────────
	// /auth/me is intentionally unprotected so Next.js server components can
	// call it directly with the forwarded cookie without a second middleware hop.
	authGroup := router.Group("/auth")
	{
		authGroup.GET("/login", authH.Login)
		authGroup.GET("/callback", authH.Callback)
		authGroup.GET("/me", authH.Me)
		authGroup.POST("/logout", authH.Logout)
	}

	// ── Protected API routes ─────────────────────────────────────────────────
	api := router.Group("/api/v1")
	api.Use(auth.RequireSession(sm))
	{
		api.GET("/me", authH.Me)

		cl := api.Group("/clusters")
		{
			cl.GET("", clusterH.ListClusters)
			cl.GET("/:id", clusterH.GetCluster)
			cl.GET("/:id/namespaces", clusterH.ListNamespaces)
			cl.GET("/:id/pods", clusterH.ListPods)
			cl.GET("/:id/deployments", clusterH.ListDeployments)
			cl.GET("/:id/identity", clusterH.GetIdentity)
			cl.GET("/:id/kubeconfig", clusterH.GetKubeconfig)
			// Pinniped cluster-scoped token exchange + mTLS credentials
			cl.GET("/:id/token", clusterH.GetClusterToken)
			cl.GET("/:id/credentials", clusterH.GetClusterCredentials)
		}

		cat := api.Group("/catalog")
		{
			cat.GET("/entities", catalogH.ListEntities)
			cat.GET("/entities/:kind/:name", catalogH.GetEntity)
		}
	}

	return &Server{router: router, cfg: cfg}, nil
}

// Run starts the HTTP server.
func (s *Server) Run() error {
	return s.router.Run(":" + s.cfg.Port)
}

// cors adds permissive CORS headers for the Next.js frontend origin.
func cors(frontendURL string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", frontendURL)
		c.Header("Access-Control-Allow-Credentials", "true")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
