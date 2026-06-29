package scaffold

import "strings"

// CreateProjectRequest is the JSON body for POST /api/v1/scaffold/projects.
type CreateProjectRequest struct {
	// Step 1: Repository
	AppName     string `json:"appName" binding:"required"`
	Team        string `json:"team" binding:"required"`
	Description string `json:"description"`

	// Step 2: Template
	TemplateID string `json:"templateId" binding:"required"`

	// Runtime (from template.yaml runtime section)
	RuntimeVersion string `json:"runtimeVersion,omitempty"`
	PackageManager string `json:"packageManager,omitempty"`

	// Step 3: XTenantApp configuration
	AppFlavor     string `json:"appFlavor"`
	Namespace     string `json:"namespace"`
	ContainerPort *int32 `json:"containerPort,omitempty"`
	Replicas      *int32 `json:"replicas,omitempty"`

	// Catalog — System is auto-created with name = appName
	SystemName string `json:"systemName,omitempty"`
	Domain     string `json:"domain,omitempty"`

	// Platform toggles
	Reloader        bool   `json:"reloader,omitempty"`
	VaultSecrets    bool   `json:"vaultSecrets,omitempty"`
	DatabaseSecrets bool   `json:"databaseSecrets,omitempty"`
	CertManager     bool   `json:"certManager,omitempty"`
	CertIssuer      string `json:"certClusterIssuer,omitempty"`
	SSOAuth         bool   `json:"ssoAuth,omitempty"`
	APIEnabled      bool   `json:"apiEnabled,omitempty"`
	APIType         string `json:"apiType,omitempty"`     // openapi | asyncapi | grpc
	OpenAPIPath     string `json:"openapiPath,omitempty"` // relative path or public URL to spec
	MonitorEnabled  bool   `json:"monitoringEnabled,omitempty"`
	MetricsPath     string `json:"metricsPath,omitempty"` // e.g. /metrics

	// Advanced
	IngressEnabled  bool   `json:"ingressEnabled,omitempty"`
	IngressHost     string `json:"ingressHost,omitempty"`
	ResourcesCPUReq string `json:"resourcesCpuReq,omitempty"`
	ResourcesCPULim string `json:"resourcesCpuLim,omitempty"`
	ResourcesMemReq string `json:"resourcesMemReq,omitempty"`
	ResourcesMemLim string `json:"resourcesMemLim,omitempty"`
	LivenessPath    string `json:"livenessPath,omitempty"`
	ReadinessPath   string `json:"readinessPath,omitempty"`
	RolloutType     string `json:"rolloutType,omitempty"`
	DevSpaceEnabled bool   `json:"devSpaceEnabled,omitempty"`

	// Vault env vars (parsed from .env upload or manual entry)
	VaultEnvVars []KeyValue `json:"vaultEnvVars,omitempty"`

	// Database (XTenantDatabase)
	DbName              string                    `json:"dbName,omitempty"`
	DbExtensions        []string                  `json:"dbExtensions,omitempty"`
	DbTier              string                    `json:"dbTier,omitempty"`
	DbEnvironment       string                    `json:"dbEnvironment,omitempty"`
	DbClusterRef        string                    `json:"dbClusterRef,omitempty"`
	DbClusterNamespace  string                    `json:"dbClusterNamespace,omitempty"`
	DbReclaimPolicy     string                    `json:"dbReclaimPolicy,omitempty"`
	DedicatedCluster    *DedicatedClusterRequest  `json:"dedicatedCluster,omitempty"`

	// Plain env vars (non-secret, go into XTenantApp spec.parameters.env)
	EnvVars []KeyValue `json:"envVars,omitempty"`

	// Pod annotations and extra labels
	PodAnnotations []KeyValue `json:"podAnnotations,omitempty"`
	ExtraLabels    []KeyValue `json:"extraLabels,omitempty"`
}

// KeyValue is a generic key-value pair used for env vars, annotations, and labels.
type KeyValue struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// DedicatedClusterRequest holds configuration for a dedicated CNPG cluster (tier: dedicated).
type DedicatedClusterRequest struct {
	Instances       int32  `json:"instances"`
	StorageSize     string `json:"storageSize"`
	PostgresVersion int32  `json:"postgresVersion"`
	EnablePooler    bool   `json:"enablePooler"`
	Namespace       string `json:"namespace,omitempty"`
}

// UpdateConfigRequest is the JSON body for PUT /api/v1/scaffold/projects/:team/:appName/config.
// templateId is immutable (cannot be changed) but must be echoed back so the
// backend can preserve it when rebuilding the base manifest.
type UpdateConfigRequest struct {
	TemplateID string `json:"templateId,omitempty"`
	AppFlavor  string `json:"appFlavor"`
	Namespace     string `json:"namespace"`
	ContainerPort *int32 `json:"containerPort,omitempty"`
	Replicas      *int32 `json:"replicas,omitempty"`

	Reloader        bool   `json:"reloader,omitempty"`
	VaultSecrets    bool   `json:"vaultSecrets,omitempty"`
	DatabaseSecrets bool   `json:"databaseSecrets,omitempty"`
	CertManager     bool   `json:"certManager,omitempty"`
	CertIssuer      string `json:"certClusterIssuer,omitempty"`
	SSOAuth         bool   `json:"ssoAuth,omitempty"`
	IngressEnabled  bool   `json:"ingressEnabled,omitempty"`
	IngressHost     string `json:"ingressHost,omitempty"`

	ResourcesCPUReq string `json:"resourcesCpuReq,omitempty"`
	ResourcesCPULim string `json:"resourcesCpuLim,omitempty"`
	ResourcesMemReq string `json:"resourcesMemReq,omitempty"`
	ResourcesMemLim string `json:"resourcesMemLim,omitempty"`
	LivenessPath    string `json:"livenessPath,omitempty"`
	ReadinessPath   string `json:"readinessPath,omitempty"`
	RolloutType     string `json:"rolloutType,omitempty"`
	DevSpaceEnabled bool   `json:"devSpaceEnabled,omitempty"`

	EnvVars        []KeyValue `json:"envVars,omitempty"`
	PodAnnotations []KeyValue `json:"podAnnotations,omitempty"`
	ExtraLabels    []KeyValue `json:"extraLabels,omitempty"`
}

// CreateProjectResponse is returned on successful project creation.
// The gitops-infra PR URL is intentionally omitted — devs don't have
// access to that repo. They see a status message instead.
type CreateProjectResponse struct {
	RepoURL string `json:"repoUrl"`
	Status  string `json:"status"`
	AppName string `json:"appName"`
	Team    string `json:"team"`
}

// ResolveDbName returns the effective database name for XTenantDatabase
// and vault path: the user-provided dbName if set, otherwise "{appName}-db".
func ResolveDbName(appName, dbName string) string {
	if dbName == "" {
		return appName + "-db"
	}
	return dbName
}

// DbSecretTarget returns the K8s Secret name for db credentials.
// Matches XTenantApp schema default: "{appName}-db-creds".
//
// When dbName is empty (default): "{appName}-db-creds"
// When dbName already ends with "-db": "{dbName}-creds"
// Otherwise: "{dbName}-db-creds"
func DbSecretTarget(appName, dbName string) string {
	if dbName == "" {
		return appName + "-db-creds"
	}
	if strings.HasSuffix(dbName, "-db") {
		return dbName + "-creds"
	}
	return dbName + "-db-creds"
}
