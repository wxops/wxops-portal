package cluster

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// SpokeClient makes authenticated requests to a single spoke cluster on behalf
// of a user.  The user's Pinniped Supervisor id_token is forwarded as the
// Bearer token; Pinniped Concierge on the spoke validates it against the hub
// Supervisor without any additional round-trip to the portal.
type SpokeClient struct {
	http      *http.Client
	apiServer string
	idToken   string
}

// NewSpokeClient builds an *http.Client that trusts the spoke cluster's CA and
// wraps it with the user's id_token as a Bearer token.
//
// Use this only for clusters that are not behind a Pinniped Concierge
// impersonation proxy (e.g. the kube-apiserver is configured with a direct
// OIDC authenticator).
func NewSpokeClient(info *ClusterInfo, idToken string) (*SpokeClient, error) {
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}

	if len(info.CABundle) > 0 {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(info.CABundle) {
			return nil, fmt.Errorf("failed to parse CA bundle for cluster %s", info.ID)
		}
		tlsCfg.RootCAs = pool
	}

	transport := &http.Transport{TLSClientConfig: tlsCfg}
	return &SpokeClient{
		http:      &http.Client{Transport: transport},
		apiServer: info.APIServer,
		idToken:   idToken,
	}, nil
}

// NewSpokeClientWithCert builds a SpokeClient that authenticates via an mTLS
// client certificate issued by the Pinniped Concierge TokenCredentialRequest.
//
// This is used when the spoke cluster is accessed through the Concierge
// impersonation proxy.  The TLS handshake carries the credential so no Bearer
// token header is sent.
func NewSpokeClientWithCert(info *ClusterInfo, certPEM, keyPEM string) (*SpokeClient, error) {
	cert, err := tls.X509KeyPair([]byte(certPEM), []byte(keyPEM))
	if err != nil {
		return nil, fmt.Errorf("parse client cert/key for cluster %s: %w", info.ID, err)
	}

	tlsCfg := &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
	}
	if len(info.CABundle) > 0 {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(info.CABundle) {
			return nil, fmt.Errorf("failed to parse CA bundle for cluster %s", info.ID)
		}
		tlsCfg.RootCAs = pool
	}

	transport := &http.Transport{TLSClientConfig: tlsCfg}
	return &SpokeClient{
		http:      &http.Client{Transport: transport},
		apiServer: info.APIServer,
		idToken:   "", // mTLS client cert carries the credential
	}, nil
}

// — low-level helpers —

func (c *SpokeClient) get(ctx context.Context, path string) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.apiServer+path, nil)
	if err != nil {
		return nil, 0, err
	}
	if c.idToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.idToken)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	return body, resp.StatusCode, err
}

func (c *SpokeClient) post(ctx context.Context, path string, payload any) ([]byte, int, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.apiServer+path, bytes.NewReader(data))
	if err != nil {
		return nil, 0, err
	}
	if c.idToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.idToken)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	return body, resp.StatusCode, err
}

// — high-level API methods —

// ListNamespaces returns all namespace names visible to the user.
func (c *SpokeClient) ListNamespaces(ctx context.Context) ([]string, error) {
	body, status, err := c.get(ctx, "/api/v1/namespaces")
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("kubernetes API returned %d: %s", status, body)
	}

	var result struct {
		Items []struct {
			Metadata struct {
				Name string `json:"name"`
			} `json:"metadata"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parse namespace list: %w", err)
	}

	names := make([]string, 0, len(result.Items))
	for _, item := range result.Items {
		names = append(names, item.Metadata.Name)
	}
	return names, nil
}

// WhoAmIResponse is the identity response returned to the frontend.
// It is populated from the Pinniped WhoAmIRequest API.
type WhoAmIResponse struct {
	Username string   `json:"username"`
	UID      string   `json:"uid"`
	Groups   []string `json:"groups"`
}

// WhoAmI performs a Pinniped WhoAmIRequest against the Concierge aggregated
// API to discover the user's Kubernetes identity as seen by Pinniped.
//
// This is preferred over SelfSubjectReview because it reflects the exact
// identity that Pinniped resolved from the mTLS client certificate, including
// group memberships mapped from the upstream identity provider.
func (c *SpokeClient) WhoAmI(ctx context.Context) (*WhoAmIResponse, error) {
	payload := map[string]any{
		"apiVersion": "identity.concierge.pinniped.dev/v1alpha1",
		"kind":       "WhoAmIRequest",
	}

	body, status, err := c.post(ctx, "/apis/identity.concierge.pinniped.dev/v1alpha1/whoamirequests", payload)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK && status != http.StatusCreated {
		return nil, fmt.Errorf("WhoAmIRequest returned %d: %s", status, body)
	}

	var result struct {
		Status struct {
			KubernetesUserInfo struct {
				User struct {
					Username string   `json:"username"`
					UID      string   `json:"uid"`
					Groups   []string `json:"groups"`
				} `json:"user"`
			} `json:"kubernetesUserInfo"`
		} `json:"status"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parse WhoAmIRequest response: %w", err)
	}

	u := result.Status.KubernetesUserInfo.User
	groups := u.Groups
	if groups == nil {
		groups = []string{}
	}
	return &WhoAmIResponse{
		Username: u.Username,
		UID:      u.UID,
		Groups:   groups,
	}, nil
}

// ListPods returns the raw Kubernetes PodList JSON for the given namespace.
func (c *SpokeClient) ListPods(ctx context.Context, namespace string) (json.RawMessage, error) {
	path := fmt.Sprintf("/api/v1/namespaces/%s/pods", namespace)
	body, status, err := c.get(ctx, path)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("kubernetes API returned %d: %s", status, body)
	}
	return json.RawMessage(body), nil
}

// ListDeployments returns the raw Kubernetes DeploymentList JSON.
func (c *SpokeClient) ListDeployments(ctx context.Context, namespace string) (json.RawMessage, error) {
	path := fmt.Sprintf("/apis/apps/v1/namespaces/%s/deployments", namespace)
	body, status, err := c.get(ctx, path)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("kubernetes API returned %d: %s", status, body)
	}
	return json.RawMessage(body), nil
}

// GetPod returns the raw Kubernetes Pod JSON for a single pod.
func (c *SpokeClient) GetPod(ctx context.Context, namespace, name string) (json.RawMessage, error) {
	path := fmt.Sprintf("/api/v1/namespaces/%s/pods/%s", namespace, name)
	body, status, err := c.get(ctx, path)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("kubernetes API returned %d: %s", status, body)
	}
	return json.RawMessage(body), nil
}

// ListServices returns the raw Kubernetes ServiceList JSON for the given namespace.
func (c *SpokeClient) ListServices(ctx context.Context, namespace string) (json.RawMessage, error) {
	path := fmt.Sprintf("/api/v1/namespaces/%s/services", namespace)
	body, status, err := c.get(ctx, path)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("kubernetes API returned %d: %s", status, body)
	}
	return json.RawMessage(body), nil
}

// ListResourceQuotas returns the raw Kubernetes ResourceQuotaList JSON for the given namespace.
func (c *SpokeClient) ListResourceQuotas(ctx context.Context, namespace string) (json.RawMessage, error) {
	path := fmt.Sprintf("/api/v1/namespaces/%s/resourcequotas", namespace)
	body, status, err := c.get(ctx, path)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("kubernetes API returned %d: %s", status, body)
	}
	return json.RawMessage(body), nil
}

// Sentinel errors for the runtime-observability reads.
//
// These two cases must be told apart by the caller: a 403 means the cluster's
// RBAC prerequisite has not been applied yet (an operator action), while a 404
// means the application simply is not deployed to that environment (a normal,
// expected state). Rendering them the same way would make an un-provisioned
// environment look broken.
var (
	ErrForbidden = fmt.Errorf("forbidden")
	ErrNotFound  = fmt.Errorf("not found")
)

// classify maps an API server status code onto the sentinels above.
func classify(status int, body []byte) error {
	switch status {
	case http.StatusOK:
		return nil
	case http.StatusForbidden, http.StatusUnauthorized:
		return ErrForbidden
	case http.StatusNotFound:
		return ErrNotFound
	default:
		return fmt.Errorf("kubernetes API returned %d: %s", status, body)
	}
}

// GetArgoApplication returns the raw ArgoCD Application JSON.
//
// Application CRs live in ArgoCD's own namespace (argocd), not in the tenant
// namespace where the workload runs — reading them therefore needs a
// RoleBinding in that namespace, which is why ErrForbidden is surfaced
// distinctly. Name follows the ApplicationSet convention {team}-{app}-{env}.
func (c *SpokeClient) GetArgoApplication(ctx context.Context, namespace, name string) (json.RawMessage, error) {
	path := fmt.Sprintf("/apis/argoproj.io/v1alpha1/namespaces/%s/applications/%s", namespace, name)
	body, status, err := c.get(ctx, path)
	if err != nil {
		return nil, err
	}
	if err := classify(status, body); err != nil {
		return nil, err
	}
	return json.RawMessage(body), nil
}

// GetXTenantApp returns the raw Crossplane XTenantApp JSON.
//
// XTenantApp is a Crossplane v2 composite with scope: Cluster, so there is no
// namespace path segment — reading it requires a ClusterRoleBinding rather than
// a namespaced RoleBinding.
func (c *SpokeClient) GetXTenantApp(ctx context.Context, name string) (json.RawMessage, error) {
	path := fmt.Sprintf("/apis/platform.wxops.cloud/v1alpha1/xtenantapps/%s", name)
	body, status, err := c.get(ctx, path)
	if err != nil {
		return nil, err
	}
	if err := classify(status, body); err != nil {
		return nil, err
	}
	return json.RawMessage(body), nil
}
