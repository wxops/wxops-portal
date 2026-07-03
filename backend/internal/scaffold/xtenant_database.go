package scaffold

import (
	"fmt"

	"gopkg.in/yaml.v3"
)

// XTenantDatabase represents the platform.wxops.cloud/v1alpha1
// XTenantDatabase CR for provisioning a CNPG database via Crossplane.
type XTenantDatabase struct {
	APIVersion string                `yaml:"apiVersion" json:"apiVersion"`
	Kind       string                `yaml:"kind"       json:"kind"`
	Metadata   ResourceMeta          `yaml:"metadata"   json:"metadata"`
	Spec       XTenantDatabaseSpec   `yaml:"spec"       json:"spec"`
}

type XTenantDatabaseSpec struct {
	Parameters XTenantDatabaseParams `yaml:"parameters" json:"parameters"`
}

type XTenantDatabaseParams struct {
	Tier                  string                `yaml:"tier,omitempty"                   json:"tier,omitempty"`
	Environment           string                `yaml:"environment,omitempty"             json:"environment,omitempty"`
	ClusterRef            string                `yaml:"clusterRef,omitempty"             json:"clusterRef,omitempty"`
	ClusterNamespace      string                `yaml:"clusterNamespace,omitempty"       json:"clusterNamespace,omitempty"`
	DedicatedCluster      *DedicatedClusterSpec `yaml:"dedicatedCluster,omitempty"       json:"dedicatedCluster,omitempty"`
	DbName                string                `yaml:"dbName,omitempty"                 json:"dbName,omitempty"`
	Owner                 string                `yaml:"owner"                            json:"owner"`
	Extensions            []string              `yaml:"extensions,omitempty"             json:"extensions,omitempty"`
	DatabaseReclaimPolicy string                `yaml:"databaseReclaimPolicy,omitempty"  json:"databaseReclaimPolicy,omitempty"`
	VaultSecretStoreName  string                `yaml:"vaultSecretStoreName,omitempty"   json:"vaultSecretStoreName,omitempty"`
}

type DedicatedClusterSpec struct {
	Instances       int32  `yaml:"instances"                  json:"instances"`
	StorageSize     string `yaml:"storageSize"                json:"storageSize"`
	PostgresVersion int32  `yaml:"postgresVersion"            json:"postgresVersion"`
	EnablePooler    bool   `yaml:"enablePooler"               json:"enablePooler"`
	Namespace       string `yaml:"namespace,omitempty"        json:"namespace,omitempty"`
}

// NewXTenantDatabase constructs an XTenantDatabase from the scaffold request.
// NewXTenantDatabase creates the base XTenantDatabase stub for the project.
// Only project-level fields (extensions, owner, vault store) are set here.
// Per-environment fields (dbName, tier, environment, clusterRef) are patched
// via JSON 6902 in each overlay's kustomization.yaml through the Promote flow.
func NewXTenantDatabase(req *CreateProjectRequest) *XTenantDatabase {
	// Default name — used for metadata.name and as the patch target in overlays.
	dbName := req.AppName + "-db"

	extensions := req.DbExtensions
	if len(extensions) == 0 {
		extensions = []string{"uuid-ossp", "pgcrypto"}
	}

	return &XTenantDatabase{
		APIVersion: "platform.wxops.cloud/v1alpha1",
		Kind:       "XTenantDatabase",
		Metadata: ResourceMeta{
			Name: fmt.Sprintf("%s-%s", req.Team, dbName),
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": "wxops-portal",
				"wxops.cloud/team":             req.Team,
				"wxops.cloud/tenant-database":  "true",
			},
		},
		Spec: XTenantDatabaseSpec{
			Parameters: XTenantDatabaseParams{
				Owner:                req.Team,
				Extensions:           extensions,
				VaultSecretStoreName: "vault-tenant",
			},
		},
	}
}

// Marshal serialises the XTenantDatabase to YAML.
func (x *XTenantDatabase) Marshal() ([]byte, error) {
	return yaml.Marshal(x)
}
