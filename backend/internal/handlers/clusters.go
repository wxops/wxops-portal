package handlers

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/wxops/wxops-portal-v2/internal/auth"
	"github.com/wxops/wxops-portal-v2/internal/cluster"
)

// ClusterHandler handles all cluster-related endpoints.
//
// Cluster metadata is discovered either from Kubernetes Secrets in the hub
// cluster (GitOps / production) or from a static JSON config file
// (dev / testing).  The registry field is agnostic to which backend is used.
//
// Spoke-cluster API calls are proxied using the user's Pinniped Supervisor
// id_token from the encrypted session cookie — the "One Token" model.
//
// For clusters that have Audience and JWTAuthenticatorName configured, the
// /token and /credentials endpoints implement the full Pinniped flow:
//  1. RFC 8693 token exchange against the Supervisor → cluster-scoped id_token
//  2. TokenCredentialRequest to Concierge → short-lived mTLS client certificate
type ClusterHandler struct {
	registry   cluster.Registry
	oidcClient *auth.OIDCClient
	sm         *auth.SessionManager
	// credCache caches short-lived Concierge mTLS credentials to avoid hitting
	// the Supervisor and Concierge on every request.
	// Key: "<sub>:<clusterID>"   Value: cachedCred
	credCache sync.Map
}

// cachedCred holds a ClusterCredential and its expiry for quick comparison.
type cachedCred struct {
	cred      *cluster.ClusterCredential
	expiresAt time.Time
}

// NewClusterHandler constructs a ClusterHandler.
func NewClusterHandler(registry cluster.Registry, oidcClient *auth.OIDCClient, sm *auth.SessionManager) *ClusterHandler {
	return &ClusterHandler{registry: registry, oidcClient: oidcClient, sm: sm}
}

// ListClusters returns all registered spoke clusters.
//
//	GET /api/v1/clusters
func (h *ClusterHandler) ListClusters(c *gin.Context) {
	clusters, err := h.registry.ListClusters(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	type item struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		APIServer string `json:"api_server"`
	}
	resp := make([]item, 0, len(clusters))
	for _, cl := range clusters {
		resp = append(resp, item{ID: cl.ID, Name: cl.Name, APIServer: cl.APIServer})
	}
	c.JSON(http.StatusOK, gin.H{"clusters": resp})
}

// GetCluster returns metadata for a single cluster.
//
//	GET /api/v1/clusters/:id
func (h *ClusterHandler) GetCluster(c *gin.Context) {
	cl, ok := h.resolveCluster(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id":         cl.ID,
		"name":       cl.Name,
		"api_server": cl.APIServer,
	})
}

// ListNamespaces lists namespaces on a spoke cluster using the user's session token.
//
//	GET /api/v1/clusters/:id/namespaces
func (h *ClusterHandler) ListNamespaces(c *gin.Context) {
	client, ok := h.buildSpokeClient(c)
	if !ok {
		return
	}
	namespaces, err := client.ListNamespaces(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"namespaces": namespaces})
}

// GetIdentity performs a Pinniped WhoAmIRequest on a spoke cluster to return
// the user's identity as resolved by Pinniped Concierge (username, uid, groups
// from the upstream identity provider).
//
//	GET /api/v1/clusters/:id/identity
func (h *ClusterHandler) GetIdentity(c *gin.Context) {
	client, ok := h.buildSpokeClient(c)
	if !ok {
		return
	}
	result, err := client.WhoAmI(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

// ListPods lists pods in the given namespace on a spoke cluster.
//
//	GET /api/v1/clusters/:id/pods?namespace=default
func (h *ClusterHandler) ListPods(c *gin.Context) {
	client, ok := h.buildSpokeClient(c)
	if !ok {
		return
	}
	ns := c.DefaultQuery("namespace", "default")
	raw, err := client.ListPods(c.Request.Context(), ns)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	// Parse k8s PodList → frontend PodInfo shape {pods: [{name,namespace,status,node}]}
	var podList struct {
		Items []struct {
			Metadata struct {
				Name      string `json:"name"`
				Namespace string `json:"namespace"`
			} `json:"metadata"`
			Spec struct {
				NodeName string `json:"nodeName"`
			} `json:"spec"`
			Status struct {
				Phase string `json:"phase"`
			} `json:"status"`
		} `json:"items"`
	}
	if err := json.Unmarshal(raw, &podList); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse pod list"})
		return
	}

	type podInfo struct {
		Name      string `json:"name"`
		Namespace string `json:"namespace"`
		Status    string `json:"status"`
		Node      string `json:"node"`
	}
	pods := make([]podInfo, 0, len(podList.Items))
	for _, item := range podList.Items {
		pods = append(pods, podInfo{
			Name:      item.Metadata.Name,
			Namespace: item.Metadata.Namespace,
			Status:    item.Status.Phase,
			Node:      item.Spec.NodeName,
		})
	}
	c.JSON(http.StatusOK, gin.H{"pods": pods})
}

// ListDeployments lists deployments in the given namespace on a spoke cluster.
//
//	GET /api/v1/clusters/:id/deployments?namespace=default
func (h *ClusterHandler) ListDeployments(c *gin.Context) {
	client, ok := h.buildSpokeClient(c)
	if !ok {
		return
	}
	ns := c.DefaultQuery("namespace", "default")
	raw, err := client.ListDeployments(c.Request.Context(), ns)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	// Parse k8s DeploymentList → frontend DeploymentInfo shape {deployments: [{name,namespace,ready,desired}]}
	var deployList struct {
		Items []struct {
			Metadata struct {
				Name      string `json:"name"`
				Namespace string `json:"namespace"`
			} `json:"metadata"`
			Spec struct {
				Replicas *int32 `json:"replicas"`
			} `json:"spec"`
			Status struct {
				ReadyReplicas int32 `json:"readyReplicas"`
			} `json:"status"`
		} `json:"items"`
	}
	if err := json.Unmarshal(raw, &deployList); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse deployment list"})
		return
	}

	type deployInfo struct {
		Name      string `json:"name"`
		Namespace string `json:"namespace"`
		Ready     int32  `json:"ready"`
		Desired   int32  `json:"desired"`
	}
	deployments := make([]deployInfo, 0, len(deployList.Items))
	for _, item := range deployList.Items {
		desired := int32(0)
		if item.Spec.Replicas != nil {
			desired = *item.Spec.Replicas
		}
		deployments = append(deployments, deployInfo{
			Name:      item.Metadata.Name,
			Namespace: item.Metadata.Namespace,
			Ready:     item.Status.ReadyReplicas,
			Desired:   desired,
		})
	}
	c.JSON(http.StatusOK, gin.H{"deployments": deployments})
}

// GetKubeconfig generates a kubeconfig for the spoke cluster.
//
// When the cluster has Pinniped fields configured (issuer_url,
// jwt_authenticator_name, audience), it emits a kubeconfig that uses the
// pinniped CLI as an exec credential plugin — the CLI handles OIDC login,
// refresh, RFC 8693 token exchange, and Concierge TokenCredentialRequest
// automatically, so the token never goes stale.
//
// Without those fields it falls back to a static bearer token kubeconfig
// (legacy/non-Pinniped clusters).
//
//	GET /api/v1/clusters/:id/kubeconfig
func (h *ClusterHandler) GetKubeconfig(c *gin.Context) {
	cl, ok := h.resolveCluster(c)
	if !ok {
		return
	}
	session := auth.GetSession(c)
	if session == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}

	caData := base64.StdEncoding.EncodeToString(cl.CABundle)

	var kubeconfig string

	// Pinniped exec-credential kubeconfig — proper refresh + mTLS, no static token.
	if cl.Audience != "" && cl.JWTAuthenticatorName != "" && cl.IssuerURL != "" {
		conciergeEndpoint := cl.ConciergeEndpoint
		if conciergeEndpoint == "" {
			conciergeEndpoint = cl.APIServer
		}
		upstreamIDPType := cl.UpstreamIDPType
		if upstreamIDPType == "" {
			upstreamIDPType = "oidc"
		}

		// Build exec args — only include optional flags when values are set.
		execArgs := []string{
			"login", "oidc",
			"--enable-concierge",
			"--concierge-api-group-suffix=pinniped.dev",
			fmt.Sprintf("--concierge-authenticator-name=%s", cl.JWTAuthenticatorName),
			"--concierge-authenticator-type=jwt",
			fmt.Sprintf("--concierge-endpoint=%s", conciergeEndpoint),
			fmt.Sprintf("--concierge-ca-bundle-data=%s", caData),
			fmt.Sprintf("--issuer=%s", cl.IssuerURL),
			"--client-id=pinniped-cli",
			"--scopes=offline_access,openid,pinniped:request-audience,username,groups",
			fmt.Sprintf("--ca-bundle-data=%s", caData),
			fmt.Sprintf("--request-audience=%s", cl.Audience),
			fmt.Sprintf("--upstream-identity-provider-type=%s", upstreamIDPType),
			"--upstream-identity-provider-flow=browser_authcode",
		}
		if cl.UpstreamIDPName != "" {
			execArgs = append(execArgs, fmt.Sprintf("--upstream-identity-provider-name=%s", cl.UpstreamIDPName))
		}

		// Serialise exec args as YAML sequence entries.
		argLines := ""
		for _, arg := range execArgs {
			argLines += fmt.Sprintf("      - %s\n", arg)
		}

		kubeconfig = fmt.Sprintf(`apiVersion: v1
kind: Config
clusters:
- cluster:
    server: %s
    certificate-authority-data: %s
  name: %s
contexts:
- context:
    cluster: %s
    user: %s
  name: %s
current-context: %s
users:
- name: %s
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      args:
%s      command: pinniped
      env: []
      installHint: Install the Pinniped CLI — see https://pinniped.dev/docs/howto/install-cli/
      interactiveMode: IfAvailable
      provideClusterInfo: true
`, conciergeEndpoint, caData, cl.ID,
			cl.ID, cl.ID, cl.ID, cl.ID, cl.ID,
			argLines)
	} else {
		// Fallback: static bearer token (non-Pinniped clusters).
		kubeconfig = fmt.Sprintf(`apiVersion: v1
kind: Config
clusters:
- cluster:
    server: %s
    certificate-authority-data: %s
  name: %s
contexts:
- context:
    cluster: %s
    user: wxops-user
  name: %s
current-context: %s
users:
- name: wxops-user
  user:
    token: %s
`, cl.APIServer, caData, cl.ID, cl.ID, cl.ID, cl.ID, session.IDToken)
	}

	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="kubeconfig-%s.yaml"`, cl.ID))
	c.Data(http.StatusOK, "application/yaml", []byte(strings.TrimSpace(kubeconfig)))
}

// GetClusterToken performs an RFC 8693 token exchange against the Pinniped
// Supervisor and returns a cluster-scoped id_token for the requested spoke
// cluster.  The token carries audience=<cluster.Audience> so it is accepted
// by that cluster's JWTAuthenticator.
//
// This is step 1 of the Pinniped web-app authentication flow described at
// https://pinniped.dev/docs/howto/configure-auth-for-webapps/
//
//	GET /api/v1/clusters/:id/token
func (h *ClusterHandler) GetClusterToken(c *gin.Context) {
	cl, ok := h.resolveCluster(c)
	if !ok {
		return
	}
	if cl.Audience == "" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error": fmt.Sprintf("cluster %q: audience not configured — set wxops.io/jwt-authenticator-audience annotation or static config field", cl.ID),
		})
		return
	}

	session := auth.GetSession(c)
	if session == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	if session.AccessToken == "" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "no access_token in session — re-login required"})
		return
	}

	clusterToken, err := h.oidcClient.ExchangeForClusterToken(c.Request.Context(), session.AccessToken, cl.Audience)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("token exchange: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"cluster_id":    cl.ID,
		"audience":      cl.Audience,
		"cluster_token": clusterToken,
	})
}

// GetClusterCredentials performs the full Pinniped authentication flow for a
// spoke cluster:
//  1. RFC 8693 token exchange → cluster-scoped id_token
//  2. TokenCredentialRequest to Concierge → short-lived mTLS client certificate
//
// The returned certificate is typically valid for 5–15 minutes and can be used
// directly with kubectl or any Kubernetes client library.
//
//	GET /api/v1/clusters/:id/credentials
func (h *ClusterHandler) GetClusterCredentials(c *gin.Context) {
	cl, ok := h.resolveCluster(c)
	if !ok {
		return
	}
	if cl.Audience == "" || cl.JWTAuthenticatorName == "" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error": fmt.Sprintf("cluster %q: audience and jwt_authenticator_name must both be configured", cl.ID),
		})
		return
	}

	session := auth.GetSession(c)
	if session == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	if session.AccessToken == "" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "no access_token in session — re-login required"})
		return
	}

	// Step 1: exchange the Supervisor access_token for a cluster-scoped id_token.
	clusterToken, err := h.oidcClient.ExchangeForClusterToken(c.Request.Context(), session.AccessToken, cl.Audience)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("token exchange: %v", err)})
		return
	}

	// Step 2: present the cluster-scoped token to Concierge to get mTLS certs.
	cred, err := cluster.RequestConciergeCredential(c.Request.Context(), cl, clusterToken)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("concierge credential: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"cluster_id":              cl.ID,
		"expiration_timestamp":    cred.ExpirationTimestamp,
		"client_certificate_data": cred.ClientCertificateData,
		"client_key_data":         cred.ClientKeyData,
	})

}

// — internal helpers —

// resolveCluster fetches the ClusterInfo for the :id path param.
func (h *ClusterHandler) resolveCluster(c *gin.Context) (*cluster.ClusterInfo, bool) {
	id := c.Param("id")
	cl, err := h.registry.GetCluster(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("cluster %q not found", id)})
		return nil, false
	}
	return cl, true
}

// buildSpokeClient resolves the cluster and creates an authenticated spoke
// client for the current user, following the Pinniped-documented flow:
//
//  1. Check in-memory credential cache — if a valid mTLS cert exists with
//     >2 minutes remaining, reuse it (zero extra round-trips).
//  2. Cache miss: exchange the Supervisor access_token for a cluster-scoped
//     id_token via RFC 8693 (ExchangeForClusterToken).
//  3. If that exchange returns a 401 (access_token expired), perform an OIDC
//     refresh_token grant to obtain a fresh access_token, persist the updated
//     session to the cookie, then retry step 2 once.
//  4. Present the cluster-scoped id_token to the Concierge impersonation proxy
//     via TokenCredentialRequest → short-lived mTLS client certificate.
//  5. Cache the new cert and build the spoke client.
//
// For clusters without Concierge (no Audience/JWTAuthenticatorName), the
// Supervisor id_token is sent directly as a Bearer token.
func (h *ClusterHandler) buildSpokeClient(c *gin.Context) (*cluster.SpokeClient, bool) {
	cl, ok := h.resolveCluster(c)
	if !ok {
		return nil, false
	}

	session := auth.GetSession(c)
	if session == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return nil, false
	}

	// ── Pinniped Concierge path ──────────────────────────────────────────────
	if cl.Audience != "" && cl.JWTAuthenticatorName != "" {
		if session.AccessToken == "" && session.RefreshToken == "" {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "no tokens in session — re-login required"})
			return nil, false
		}

		cacheKey := session.Sub + ":" + cl.ID
		const certBuffer = 2 * time.Minute

		// Step 1 — check credential cache.
		var cred *cluster.ClusterCredential
		if v, hit := h.credCache.Load(cacheKey); hit {
			cc := v.(cachedCred)
			if time.Until(cc.expiresAt) > certBuffer {
				cred = cc.cred // cert still fresh — skip steps 2–4
			}
		}

		if cred == nil {
			// Step 2 — RFC 8693 token exchange: access_token → cluster-scoped id_token.
			clusterToken, exchangeErr := h.oidcClient.ExchangeForClusterToken(
				c.Request.Context(), session.AccessToken, cl.Audience)

			if exchangeErr != nil && session.RefreshToken != "" {
				// Step 3 — access_token stale: do OIDC refresh, then retry exchange.
				newTok, newIDRaw, refreshErr := h.oidcClient.RefreshTokens(
					c.Request.Context(), session.RefreshToken)
				if refreshErr != nil {
					c.JSON(http.StatusUnauthorized, gin.H{
						"error": "session expired and token refresh failed — please log in again",
					})
					return nil, false
				}

				// Persist refreshed session so future requests don't re-refresh.
				updatedIDToken := newIDRaw
				if updatedIDToken == "" {
					updatedIDToken = session.IDToken
				}
				updatedRT := newTok.RefreshToken
				if updatedRT == "" {
					updatedRT = session.RefreshToken
				}
				updated := &auth.Session{
					Sub:          session.Sub,
					Username:     session.Username,
					Groups:       session.Groups,
					IDToken:      updatedIDToken,
					AccessToken:  newTok.AccessToken,
					RefreshToken: updatedRT,
					ExpiresAt:    newTok.Expiry,
				}
				auth.SetSession(c, updated)
				if encoded, encErr := h.sm.Encode(updated); encErr == nil {
					c.SetSameSite(http.SameSiteLaxMode)
					c.SetCookie(auth.SessionCookieName, encoded, 8*3600, "/", "", false, true)
				}
				session = updated

				// Retry exchange with the fresh access_token.
				clusterToken, exchangeErr = h.oidcClient.ExchangeForClusterToken(
					c.Request.Context(), newTok.AccessToken, cl.Audience)
			}
			if exchangeErr != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("token exchange: %v", exchangeErr)})
				return nil, false
			}

			// Step 4 — TokenCredentialRequest → short-lived mTLS cert.
			freshCred, credErr := cluster.RequestConciergeCredential(
				c.Request.Context(), cl, clusterToken)
			if credErr != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("concierge credential: %v", credErr)})
				return nil, false
			}

			// Step 5 — cache the cert.
			h.credCache.Store(cacheKey, cachedCred{cred: freshCred, expiresAt: freshCred.ExpirationTimestamp})
			cred = freshCred
		}

		spokeClient, err := cluster.NewSpokeClientWithCert(cl, cred.ClientCertificateData, cred.ClientKeyData)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("build spoke client: %v", err)})
			return nil, false
		}
		return spokeClient, true
	}

	// ── Fallback: direct Bearer token ────────────────────────────────────────
	spokeClient, err := cluster.NewSpokeClient(cl, session.IDToken)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to build cluster client"})
		return nil, false
	}
	return spokeClient, true
}

// truncate returns the first n characters of s, or s itself if shorter.
// Used for safe debug-printing of tokens.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
