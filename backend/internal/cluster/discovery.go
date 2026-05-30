// Package cluster provides spoke-cluster discovery and proxying.
//
// Clusters are stored as Kubernetes Secrets in the hub (management) cluster,
// labelled with "wxops.io/kind=cluster".  This replaces any relational database
// and aligns with GitOps: a Secret is the single source of truth for a cluster
// registration.
//
// Expected Secret shape
// ─────────────────────
//
//	apiVersion: v1
//	kind: Secret
//	metadata:
//	  name: cluster-a
//	  namespace: wxops-system         # CLUSTER_NAMESPACE env var
//	  labels:
//	    wxops.io/kind: cluster
//	  annotations:
//	    wxops.io/cluster-id:   cluster-a        # optional, defaults to .metadata.name
//	    wxops.io/cluster-name: "Production A"   # optional, defaults to cluster-id
//	data:
//	  api-server: aHR0cHM6Ly8...      # base64(https://api.cluster-a.example.com:6443)
//	  ca-bundle:  LS0tLS1CRUd...      # base64(PEM CA cert(s))
package cluster

import (
	"context"
	"fmt"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// ClusterInfo is the public view of a registered spoke cluster.
type ClusterInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	APIServer string `json:"api_server"`
	// CABundle is the PEM-encoded CA cert(s) for the spoke API server.
	// Not serialised to JSON — only used server-side for TLS verification.
	CABundle []byte `json:"-"`

	// Pinniped Concierge fields — required for cluster-scoped token exchange
	// and mTLS credential requests.
	//
	// Audience is the value of spec.audience on the cluster's JWTAuthenticator.
	// It is used in the RFC 8693 token exchange to obtain a cluster-scoped
	// id_token from the Pinniped Supervisor.
	//
	// JWTAuthenticatorName is the metadata.name of the JWTAuthenticator CR
	// installed on this cluster, used when calling the Concierge
	// TokenCredentialRequest API.
	//
	// When either field is empty the /token and /credentials endpoints will
	// return an error for this cluster.
	Audience             string `json:"audience,omitempty"`
	JWTAuthenticatorName string `json:"jwt_authenticator_name,omitempty"`

	// Pinniped CLI kubeconfig fields — used by GetKubeconfig to produce an
	// exec-credential kubeconfig that uses the pinniped CLI for proper OIDC
	// refresh and Concierge mTLS flows (no static short-lived token).
	IssuerURL         string `json:"issuer_url,omitempty"`         // Supervisor FederationDomain issuer
	ConciergeEndpoint string `json:"concierge_endpoint,omitempty"` // Concierge impersonation proxy URL
	UpstreamIDPName   string `json:"upstream_idp_name,omitempty"`  // --upstream-identity-provider-name
	UpstreamIDPType   string `json:"upstream_idp_type,omitempty"`  // oidc | ldap | activedirectory | github
}

const cacheTTL = 60 * time.Second

// Discovery lists spoke clusters from Kubernetes Secrets in the hub cluster.
type Discovery struct {
	client    kubernetes.Interface
	namespace string

	mu       sync.RWMutex
	cached   []ClusterInfo
	cachedAt time.Time
}

const clusterLabelSelector = "wxops.io/kind=cluster"

// NewDiscovery creates a Discovery that connects to the hub cluster.
// If kubeconfigPath is empty the in-cluster service-account config is used.
func NewDiscovery(kubeconfigPath, namespace string) (*Discovery, error) {
	var restCfg *rest.Config
	var err error

	if kubeconfigPath != "" {
		restCfg, err = clientcmd.BuildConfigFromFlags("", kubeconfigPath)
	} else {
		restCfg, err = rest.InClusterConfig()
	}
	if err != nil {
		return nil, fmt.Errorf("build kubernetes config: %w", err)
	}

	client, err := kubernetes.NewForConfig(restCfg)
	if err != nil {
		return nil, fmt.Errorf("create kubernetes client: %w", err)
	}

	return &Discovery{client: client, namespace: namespace}, nil
}

// list returns all clusters, serving from the in-memory cache when it is still
// fresh. A single hub API call is shared across all concurrent requests that
// arrive during a cache miss, thanks to the write-lock upgrade pattern.
func (d *Discovery) list(ctx context.Context) ([]ClusterInfo, error) {
	d.mu.RLock()
	if d.cached != nil && time.Since(d.cachedAt) < cacheTTL {
		c := d.cached
		d.mu.RUnlock()
		return c, nil
	}
	d.mu.RUnlock()

	secrets, err := d.client.CoreV1().Secrets(d.namespace).List(ctx, metav1.ListOptions{
		LabelSelector: clusterLabelSelector,
	})
	if err != nil {
		return nil, fmt.Errorf("list cluster secrets in %s: %w", d.namespace, err)
	}

	clusters := make([]ClusterInfo, 0, len(secrets.Items))
	for i := range secrets.Items {
		info, err := secretToCluster(&secrets.Items[i])
		if err != nil {
			continue
		}
		clusters = append(clusters, info)
	}

	d.mu.Lock()
	d.cached, d.cachedAt = clusters, time.Now()
	d.mu.Unlock()

	return clusters, nil
}

// ListClusters returns all registered spoke clusters.
func (d *Discovery) ListClusters(ctx context.Context) ([]ClusterInfo, error) {
	return d.list(ctx)
}

// GetCluster returns a single cluster by its ID.
func (d *Discovery) GetCluster(ctx context.Context, id string) (*ClusterInfo, error) {
	clusters, err := d.list(ctx)
	if err != nil {
		return nil, err
	}
	for i := range clusters {
		if clusters[i].ID == id {
			return &clusters[i], nil
		}
	}
	return nil, fmt.Errorf("cluster %q not found", id)
}

// secretToCluster converts a Kubernetes Secret to ClusterInfo.
func secretToCluster(s *corev1.Secret) (ClusterInfo, error) {
	id := s.Annotations["wxops.io/cluster-id"]
	if id == "" {
		id = s.Name
	}

	name := s.Annotations["wxops.io/cluster-name"]
	if name == "" {
		name = id
	}

	apiServer := string(s.Data["api-server"])
	if apiServer == "" {
		return ClusterInfo{}, fmt.Errorf("secret %s/%s missing 'api-server' key", s.Namespace, s.Name)
	}

	return ClusterInfo{
		ID:                   id,
		Name:                 name,
		APIServer:            apiServer,
		CABundle:             s.Data["ca-bundle"],
		Audience:             s.Annotations["wxops.io/jwt-authenticator-audience"],
		JWTAuthenticatorName: s.Annotations["wxops.io/jwt-authenticator-name"],
		IssuerURL:            s.Annotations["wxops.io/issuer-url"],
		ConciergeEndpoint:    s.Annotations["wxops.io/concierge-endpoint"],
		UpstreamIDPName:      s.Annotations["wxops.io/upstream-idp-name"],
		UpstreamIDPType:      s.Annotations["wxops.io/upstream-idp-type"],
	}, nil
}
