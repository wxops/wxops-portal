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
	Environment           string                `yaml:"environment"                      json:"environment"`
	ClusterRef            string                `yaml:"clusterRef,omitempty"             json:"clusterRef,omitempty"`
	ClusterNamespace      string                `yaml:"clusterNamespace,omitempty"       json:"clusterNamespace,omitempty"`
	DedicatedCluster      *DedicatedClusterSpec `yaml:"dedicatedCluster,omitempty"       json:"dedicatedCluster,omitempty"`
	DbName                string                `yaml:"dbName"                           json:"dbName"`
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
func NewXTenantDatabase(req *CreateProjectRequest) *XTenantDatabase {
	dbName := ResolveDbName(req.AppName, req.DbName)

	extensions := req.DbExtensions
	if len(extensions) == 0 {
		extensions = []string{"uuid-ossp", "pgcrypto"}
	}

	tier := req.DbTier
	if tier == "" {
		tier = "shared"
	}

	env := req.DbEnvironment
	if env == "" {
		env = "dev"
	}

	params := XTenantDatabaseParams{
		Tier:                 tier,
		Environment:          env,
		DbName:               dbName,
		Owner:                req.Team,
		Extensions:           extensions,
		VaultSecretStoreName: "vault-tenant",
	}

	if req.DbReclaimPolicy != "" {
		params.DatabaseReclaimPolicy = req.DbReclaimPolicy
	}

	if tier == "shared" {
		params.ClusterRef = req.DbClusterRef
		params.ClusterNamespace = req.DbClusterNamespace
	}

	if tier == "dedicated" && req.DedicatedCluster != nil {
		dc := req.DedicatedCluster
		instances := dc.Instances
		if instances == 0 {
			instances = 1
		}
		storageSize := dc.StorageSize
		if storageSize == "" {
			storageSize = "1Gi"
		}
		pgVersion := dc.PostgresVersion
		if pgVersion == 0 {
			pgVersion = 16
		}
		params.DedicatedCluster = &DedicatedClusterSpec{
			Instances:       instances,
			StorageSize:     storageSize,
			PostgresVersion: pgVersion,
			EnablePooler:    dc.EnablePooler,
			Namespace:       dc.Namespace,
		}
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
			Parameters: params,
		},
	}
}

// Marshal serialises the XTenantDatabase to YAML.
func (x *XTenantDatabase) Marshal() ([]byte, error) {
	return yaml.Marshal(x)
}
