package config

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

// Config holds all runtime configuration loaded from environment variables
// (with optional .env file overlay for local development).
type Config struct {
	// Server
	Port        string
	FrontendURL string

	// OIDC — points to the Pinniped Supervisor FederationDomain issuer.
	// The Supervisor federates upstream to Dex/Gitea; the portal only ever
	// talks to the Supervisor and receives a single "One Token" that is valid
	// for both the portal session and every spoke cluster.
	OIDCIssuerURL    string
	OIDCClientID     string
	OIDCClientSecret string
	OIDCRedirectURI  string
	OIDCScopes       []string

	// OIDCCABundle is the PEM-encoded CA certificate(s) used to verify the
	// Pinniped Supervisor's TLS certificate.  Set OIDC_CA_BUNDLE_FILE to a
	// path or OIDC_CA_BUNDLE to an inline PEM string.
	// Leave empty when the Supervisor serves a publicly trusted certificate.
	OIDCCABundle []byte

	// OIDCTLSSkipVerify disables TLS verification for the Supervisor endpoint.
	// Only for local development with self-signed certs — never use in production.
	OIDCTLSSkipVerify bool

	// DevBypassAuth skips the OIDC flow entirely and injects a pre-built session
	// with username "dev" and groups ["platform-team"].
	// DEV ONLY — never enable in production.
	DevBypassAuth bool

	// Session — 32-byte AES-256 key encoded as 64 lowercase hex chars.
	// Generate with: openssl rand -hex 32
	SessionSecret string

	// Kubernetes — management (hub) cluster used to discover spoke clusters.
	// If KubeconfigPath is empty, in-cluster config is used (running inside k8s).
	KubeconfigPath   string
	ClusterNamespace string // namespace where cluster Secrets live

	// Static cluster configuration — alternative to K8s-Secret-based discovery.
	// Useful for local development and testing without a hub cluster.
	// When either field is set, StaticRegistry is used instead of Discovery.
	//
	// ClustersConfigFile is a path to a JSON file listing clusters.
	// ClustersConfig is an inline JSON string (same format).
	// File takes priority when both are set.
	ClustersConfigFile string
	ClustersConfig     string

	// Gitea — service catalog source.
	//
	// NOTE: CATALOG_LOCAL_DIR — absolute or relative path to a local catalog directory
	//       (e.g. ./internal/catalog/examples). When set, Gitea config is ignored.
	//       Expected layout: <team>/systems/*.yaml, <team>/components/*.yaml, <team>/apis/*.yaml, etc.
	//       Leave empty in production.
	CatalogLocalDir string

	// NOTE: GITEA_URL — base URL of your Gitea instance, e.g. https://gitea.example.com
	// NOTE: GITEA_TOKEN — personal access token with "repository" read scope.
	//       Generate at: <your-gitea>/user/settings/applications
	// NOTE: GITEA_CATALOG_OWNER — org or user that owns the gitops-infra repo.
	// NOTE: GITEA_CATALOG_REPO — repo name that contains the catalog directory (default: gitops-infra).
	// NOTE: GITEA_CATALOG_PATH — path within the repo where the service catalog lives (default: service-catalog).
	//       Expected layout: service-catalog/<team>/systems/*.yaml, service-catalog/<team>/components/*.yaml, etc.
	GiteaURL          string
	GiteaToken        string
	GiteaCatalogOwner string
	GiteaCatalogRepo  string
	GiteaCatalogPath  string
}

// Load reads configuration from environment variables.
// If a .env file is present in the working directory it is loaded first so
// that real env vars (e.g. from a container runtime) always take precedence.
func Load() *Config {
	// Load .env silently — it is optional; real env vars win via godotenv.Overload.
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		log.Printf("config: .env not loaded: %v", err)
	}

	// Default scopes for Pinniped Supervisor.
	// "pinniped:request-audience" is the Pinniped-specific scope that allows the
	// returned id_token to carry a custom audience matching each spoke cluster's
	// JWTAuthenticator — enabling the "One Token" Hub-Spoke flow.
	defaultScopes := "openid,profile,email,groups,offline_access,pinniped:request-audience"
	scopesRaw := getEnv("OIDC_SCOPES", defaultScopes)
	scopes := strings.Split(scopesRaw, ",")

	ca, err := loadCABundle(getEnv("OIDC_CA_BUNDLE_FILE", ""), getEnv("OIDC_CA_BUNDLE", ""))
	if err != nil {
		log.Fatalf("config: OIDC CA bundle: %v", err)
	}

	return &Config{
		Port:               getEnv("PORT", "8080"),
		FrontendURL:        getEnv("FRONTEND_URL", "http://localhost:3000"),
		OIDCIssuerURL:      getEnv("OIDC_ISSUER_URL", ""),
		OIDCClientID:       getEnv("OIDC_CLIENT_ID", "wxops-portal"),
		OIDCClientSecret:   getEnv("OIDC_CLIENT_SECRET", ""),
		OIDCRedirectURI:    getEnv("OIDC_REDIRECT_URI", "http://localhost:3000/auth/callback"),
		OIDCScopes:         scopes,
		OIDCCABundle:       ca,
		OIDCTLSSkipVerify:  getBool("OIDC_TLS_SKIP_VERIFY"),
		DevBypassAuth:      getBool("DEV_BYPASS_AUTH"),
		SessionSecret:      getEnv("SESSION_SECRET", ""),
		KubeconfigPath:     getEnv("KUBECONFIG", ""),
		ClusterNamespace:   getEnv("CLUSTER_NAMESPACE", "wxops-system"),
		ClustersConfigFile: getEnv("CLUSTERS_CONFIG_FILE", ""),
		ClustersConfig:     getEnv("CLUSTERS_CONFIG", ""),
		CatalogLocalDir:    getEnv("CATALOG_LOCAL_DIR", ""),
		GiteaURL:           getEnv("GITEA_URL", ""),
		GiteaToken:         getEnv("GITEA_TOKEN", ""),
		GiteaCatalogOwner:  getEnv("GITEA_CATALOG_OWNER", ""),
		GiteaCatalogRepo:   getEnv("GITEA_CATALOG_REPO", "gitops-infra"),
		GiteaCatalogPath:   getEnv("GITEA_CATALOG_PATH", "service-catalog"),
	}
}

// OIDCHTTPClient returns an *http.Client pre-configured for the Supervisor's
// TLS requirements.  Returns nil when the system root pool is sufficient (i.e.
// the Supervisor certificate is publicly trusted).
func (c *Config) OIDCHTTPClient() (*tls.Config, error) {
	tlsCfg := &tls.Config{
		MinVersion:         tls.VersionTLS12,
		InsecureSkipVerify: c.OIDCTLSSkipVerify, //nolint:gosec // opt-in via env, dev only
	}

	if len(c.OIDCCABundle) > 0 {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(c.OIDCCABundle) {
			return nil, fmt.Errorf("OIDC_CA_BUNDLE: no valid PEM certificates found")
		}
		tlsCfg.RootCAs = pool
	}

	// Return nil if neither a custom CA nor skip-verify was requested so the
	// OIDC library uses the default http.DefaultTransport (publicly trusted pool).
	if !c.OIDCTLSSkipVerify && len(c.OIDCCABundle) == 0 {
		return nil, nil
	}
	return tlsCfg, nil
}

// — helpers —

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// getBool returns true when the env var is set to "true", "1", or "yes"
// (case-insensitive).  An unset or empty variable returns false.
func getBool(key string) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	return v == "true" || v == "1" || v == "yes"
}

// loadCABundle resolves the CA PEM from either a file path or an inline string.
// If both are empty the return value is nil (use system root pool).
// The file path takes precedence when both are set.
func loadCABundle(filePath, inline string) ([]byte, error) {
	if filePath != "" {
		data, err := os.ReadFile(filePath)
		if err != nil {
			return nil, fmt.Errorf("reading OIDC_CA_BUNDLE_FILE %q: %w", filePath, err)
		}
		return data, nil
	}
	if inline != "" {
		// Allow the PEM to be passed with literal \n instead of real newlines
		// (common in CI/CD and some .env editors).
		return []byte(strings.ReplaceAll(inline, `\n`, "\n")), nil
	}
	return nil, nil
}
