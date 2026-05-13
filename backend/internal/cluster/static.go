package cluster

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// staticClusterDef is the JSON shape for a single cluster in the static config.
//
// Example clusters.json:
//
//	{
//	  "clusters": [
//	    {
//	      "id": "dev-cluster",
//	      "name": "Dev Cluster",
//	      "api_server": "https://127.0.0.1:6443",
//	      "ca_bundle_file": "/home/user/.kube/local-ca.crt",
//	      "audience": "dev-cluster",
//	      "jwt_authenticator_name": "dev-jwt-authenticator"
//	    }
//	  ]
//	}
type staticClusterDef struct {
	ID                   string `json:"id"`
	Name                 string `json:"name"`
	APIServer            string `json:"api_server"`
	CABundleFile         string `json:"ca_bundle_file"`         // path to PEM file
	CABundle             string `json:"ca_bundle"`              // inline PEM (literal \n ok)
	Audience             string `json:"audience"`               // JWTAuthenticator spec.audience
	JWTAuthenticatorName string `json:"jwt_authenticator_name"` // JWTAuthenticator metadata.name

	// Pinniped CLI exec-credential kubeconfig fields.
	// When set, GetKubeconfig returns a kubeconfig that uses the pinniped
	// CLI as an exec credential plugin (proper OIDC refresh + Concierge flow)
	// instead of a static short-lived bearer token.
	IssuerURL         string `json:"issuer_url"`         // Supervisor FederationDomain issuer
	ConciergeEndpoint string `json:"concierge_endpoint"` // Concierge impersonation proxy URL (if different from api_server)
	UpstreamIDPName   string `json:"upstream_idp_name"`  // --upstream-identity-provider-name
	UpstreamIDPType   string `json:"upstream_idp_type"`  // oidc | ldap | activedirectory | github
}

type staticConfig struct {
	Clusters []staticClusterDef `json:"clusters"`
}

// StaticRegistry implements Registry from a static JSON config file or inline
// JSON string.  Intended for local development and testing — no hub K8s
// cluster is required.
type StaticRegistry struct {
	clusters []ClusterInfo
}

// NewStaticRegistry loads the cluster list from filePath (JSON file) or inline
// JSON string.  filePath takes priority when both are provided.
func NewStaticRegistry(filePath, inline string) (*StaticRegistry, error) {
	var raw []byte
	var err error

	switch {
	case filePath != "":
		raw, err = os.ReadFile(filePath)
		if err != nil {
			return nil, fmt.Errorf("reading CLUSTERS_CONFIG_FILE %q: %w", filePath, err)
		}
	case inline != "":
		raw = []byte(inline)
	default:
		return nil, fmt.Errorf("static registry: neither CLUSTERS_CONFIG_FILE nor CLUSTERS_CONFIG is set")
	}

	var cfg staticConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("parse cluster config JSON: %w", err)
	}

	clusters := make([]ClusterInfo, 0, len(cfg.Clusters))
	for i, def := range cfg.Clusters {
		if def.APIServer == "" {
			return nil, fmt.Errorf("cluster[%d] %q: api_server is required", i, def.ID)
		}

		ca, err := resolveStaticCA(def.CABundleFile, def.CABundle)
		if err != nil {
			return nil, fmt.Errorf("cluster %q: %w", def.ID, err)
		}

		id := def.ID
		if id == "" {
			id = def.Name
		}
		name := def.Name
		if name == "" {
			name = id
		}

		clusters = append(clusters, ClusterInfo{
			ID:                   id,
			Name:                 name,
			APIServer:            def.APIServer,
			CABundle:             ca,
			Audience:             def.Audience,
			JWTAuthenticatorName: def.JWTAuthenticatorName,
			IssuerURL:            def.IssuerURL,
			ConciergeEndpoint:    def.ConciergeEndpoint,
			UpstreamIDPName:      def.UpstreamIDPName,
			UpstreamIDPType:      def.UpstreamIDPType,
		})
	}

	return &StaticRegistry{clusters: clusters}, nil
}

// ListClusters returns all statically configured clusters.
func (r *StaticRegistry) ListClusters(_ context.Context) ([]ClusterInfo, error) {
	return r.clusters, nil
}

// GetCluster returns a single cluster by ID.
func (r *StaticRegistry) GetCluster(_ context.Context, id string) (*ClusterInfo, error) {
	for i := range r.clusters {
		if r.clusters[i].ID == id {
			return &r.clusters[i], nil
		}
	}
	return nil, fmt.Errorf("cluster %q not found", id)
}

// resolveStaticCA loads the CA PEM from a file path or inline string.
// filePath takes priority; returns nil when both are empty (trust system pool).
func resolveStaticCA(filePath, inline string) ([]byte, error) {
	if filePath != "" {
		data, err := os.ReadFile(filePath)
		if err != nil {
			return nil, fmt.Errorf("reading ca_bundle_file %q: %w", filePath, err)
		}
		return data, nil
	}
	if inline != "" {
		// Support literal \n in env-var or JSON strings.
		return []byte(strings.ReplaceAll(inline, `\n`, "\n")), nil
	}
	return nil, nil
}
