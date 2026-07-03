package scaffold

import (
	"fmt"

	"gopkg.in/yaml.v3"
)

// XTenantApp represents the platform.wxops.cloud/v1alpha1 XTenantApp CR.
type XTenantApp struct {
	APIVersion string         `yaml:"apiVersion" json:"apiVersion"`
	Kind       string         `yaml:"kind"       json:"kind"`
	Metadata   ResourceMeta   `yaml:"metadata"   json:"metadata"`
	Spec       XTenantAppSpec `yaml:"spec"       json:"spec"`
}

type ResourceMeta struct {
	Name   string            `yaml:"name"             json:"name"`
	Labels map[string]string `yaml:"labels,omitempty" json:"labels,omitempty"`
}

type XTenantAppSpec struct {
	Parameters XTenantAppParams `yaml:"parameters" json:"parameters"`
}

type XTenantAppParams struct {
	AppName   string `yaml:"appName,omitempty"   json:"appName,omitempty"`
	Namespace string `yaml:"namespace,omitempty" json:"namespace,omitempty"`
	Image     string `yaml:"image,omitempty"     json:"image,omitempty"`

	ImagePullSecrets []string `yaml:"imagePullSecrets,omitempty" json:"imagePullSecrets,omitempty"`

	AppFlavor  string          `yaml:"appFlavor,omitempty"  json:"appFlavor,omitempty"`
	TemplateID string          `yaml:"templateId,omitempty" json:"templateId,omitempty"`
	Repository *RepositorySpec `yaml:"repository,omitempty" json:"repository,omitempty"`

	Replicas      *int32        `yaml:"replicas,omitempty"      json:"replicas,omitempty"`
	ContainerPort *int32        `yaml:"containerPort,omitempty" json:"containerPort,omitempty"`
	Resources     *ResourceSpec `yaml:"resources,omitempty"     json:"resources,omitempty"`

	Env            []EnvVar          `yaml:"env,omitempty"            json:"env,omitempty"`
	EnvFrom        []EnvFromSource   `yaml:"envFrom,omitempty"       json:"envFrom,omitempty"`
	PodAnnotations map[string]string `yaml:"podAnnotations,omitempty" json:"podAnnotations,omitempty"`

	SecretsFrom     *SecretsFromSpec `yaml:"secretsFrom,omitempty"     json:"secretsFrom,omitempty"`
	RolloutStrategy *RolloutStrategy `yaml:"rolloutStrategy,omitempty" json:"rolloutStrategy,omitempty"`
	Reloader        *ReloaderSpec    `yaml:"reloader,omitempty"        json:"reloader,omitempty"`
	DevSpace        *DevSpaceSpec    `yaml:"devSpace,omitempty"        json:"devSpace,omitempty"`
	Service         *ServiceSpec     `yaml:"service,omitempty"         json:"service,omitempty"`
	Probes          *ProbesSpec      `yaml:"probes,omitempty"          json:"probes,omitempty"`
	Ingress         *IngressSpec     `yaml:"ingress,omitempty"         json:"ingress,omitempty"`
}

type RepositorySpec struct {
	URL string `yaml:"url" json:"url"`
}

type ResourceSpec struct {
	Requests *ResourceValues `yaml:"requests,omitempty" json:"requests,omitempty"`
	Limits   *ResourceValues `yaml:"limits,omitempty"   json:"limits,omitempty"`
}

type ResourceValues struct {
	CPU    string `yaml:"cpu,omitempty"    json:"cpu,omitempty"`
	Memory string `yaml:"memory,omitempty" json:"memory,omitempty"`
}

type EnvVar struct {
	Name  string `yaml:"name"  json:"name"`
	Value string `yaml:"value" json:"value"`
}

type EnvFromSource struct {
	SecretRef    *EnvFromRef `yaml:"secretRef,omitempty"    json:"secretRef,omitempty"`
	ConfigMapRef *EnvFromRef `yaml:"configMapRef,omitempty" json:"configMapRef,omitempty"`
}

type EnvFromRef struct {
	Name string `yaml:"name" json:"name"`
}

type SecretsFromSpec struct {
	App      *SecretRefToggle `yaml:"app,omitempty"      json:"app,omitempty"`
	Database *SecretRefToggle `yaml:"database,omitempty" json:"database,omitempty"`
}

type SecretRefToggle struct {
	Enabled    bool   `yaml:"enabled"              json:"enabled"`
	SecretName string `yaml:"secretName,omitempty" json:"secretName,omitempty"`
}

type RolloutStrategy struct {
	Type          string         `yaml:"type,omitempty"          json:"type,omitempty"`
	RollingUpdate *RollingUpdate `yaml:"rollingUpdate,omitempty" json:"rollingUpdate,omitempty"`
}

type RollingUpdate struct {
	MaxSurge       string `yaml:"maxSurge,omitempty"       json:"maxSurge,omitempty"`
	MaxUnavailable string `yaml:"maxUnavailable,omitempty" json:"maxUnavailable,omitempty"`
}

type ReloaderSpec struct {
	Enabled bool `yaml:"enabled" json:"enabled"`
}

type DevSpaceSpec struct {
	Enabled  bool     `yaml:"enabled"            json:"enabled"`
	Replicas *int32   `yaml:"replicas,omitempty" json:"replicas,omitempty"`
	Image    string   `yaml:"image,omitempty"    json:"image,omitempty"`
	Command  []string `yaml:"command,omitempty"  json:"command,omitempty"`
}

type ServiceSpec struct {
	Enabled bool   `yaml:"enabled"        json:"enabled"`
	Type    string `yaml:"type,omitempty" json:"type,omitempty"`
	Port    *int32 `yaml:"port,omitempty" json:"port,omitempty"`
}

type ProbesSpec struct {
	Liveness  *ProbeDetail `yaml:"liveness,omitempty"  json:"liveness,omitempty"`
	Readiness *ProbeDetail `yaml:"readiness,omitempty" json:"readiness,omitempty"`
	Startup   *ProbeDetail `yaml:"startup,omitempty"   json:"startup,omitempty"`
}

type ProbeDetail struct {
	Enabled          bool   `yaml:"enabled"                   json:"enabled"`
	Path             string `yaml:"path,omitempty"            json:"path,omitempty"`
	PeriodSeconds    *int32 `yaml:"periodSeconds,omitempty"   json:"periodSeconds,omitempty"`
	FailureThreshold *int32 `yaml:"failureThreshold,omitempty" json:"failureThreshold,omitempty"`
}

type IngressSpec struct {
	Enabled   bool     `yaml:"enabled"            json:"enabled"`
	ClassName string   `yaml:"className,omitempty" json:"className,omitempty"`
	Host      string   `yaml:"host,omitempty"     json:"host,omitempty"`
	Path      string   `yaml:"path,omitempty"     json:"path,omitempty"`
	PathType  string   `yaml:"pathType,omitempty" json:"pathType,omitempty"`
	TLS       *TLSSpec `yaml:"tls,omitempty"      json:"tls,omitempty"`
	Auth      *AuthSpec `yaml:"auth,omitempty"    json:"auth,omitempty"`
}

type TLSSpec struct {
	Enabled       bool   `yaml:"enabled"                  json:"enabled"`
	SecretName    string `yaml:"secretName,omitempty"     json:"secretName,omitempty"`
	ClusterIssuer string `yaml:"clusterIssuer,omitempty" json:"clusterIssuer,omitempty"`
}

type AuthSpec struct {
	Enabled bool `yaml:"enabled" json:"enabled"`
}

// NewXTenantAppBase constructs the environment-agnostic base XTenantApp manifest.
// The base is the golden-path contract: it declares all platform feature toggles
// (secretsFrom, ingress enabled, TLS, auth, reloader, probes, rolloutStrategy).
// Only env-specific values are omitted: replicas, resources, and ingress host
// — those are patched per environment in overlay/patch-xtenant-app.yaml.
func NewXTenantAppBase(req *CreateProjectRequest, giteaURL string) *XTenantApp {
	return NewXTenantApp(req, giteaURL)
}

// MergeEnvPatch overlays environment-specific patch fields onto base in-place.
// Used by GetProjectConfig to reconstruct a unified view from base + dev patch.
func MergeEnvPatch(base, patch *XTenantApp) {
	if patch.Spec.Parameters.Replicas != nil {
		base.Spec.Parameters.Replicas = patch.Spec.Parameters.Replicas
	}
	if patch.Spec.Parameters.Resources != nil {
		base.Spec.Parameters.Resources = patch.Spec.Parameters.Resources
	}
	if patch.Spec.Parameters.Ingress != nil {
		base.Spec.Parameters.Ingress = patch.Spec.Parameters.Ingress
	}
	if patch.Spec.Parameters.SecretsFrom != nil {
		base.Spec.Parameters.SecretsFrom = patch.Spec.Parameters.SecretsFrom
	}
}

// NewXTenantApp constructs an XTenantApp from a CreateProjectRequest
// with sensible defaults.
func NewXTenantApp(req *CreateProjectRequest, giteaURL string) *XTenantApp {
	ns := req.Namespace
	if ns == "" {
		ns = defaultNamespace(req.Team)
	}

	app := &XTenantApp{
		APIVersion: "platform.wxops.cloud/v1alpha1",
		Kind:       "XTenantApp",
		Metadata: ResourceMeta{
			Name: req.Team + "-" + req.AppName,
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": "wxops-portal",
				"wxops.cloud/team":             req.Team,
			},
		},
		Spec: XTenantAppSpec{
			Parameters: XTenantAppParams{
				AppName:          req.AppName,
				Namespace:        ns,
				Image:            registryHost(giteaURL) + "/" + req.Team + "/" + req.AppName + ":latest",
				ImagePullSecrets: []string{"regcred"},
				AppFlavor:        req.AppFlavor,
				TemplateID:       req.TemplateID,
				ContainerPort:    req.ContainerPort,
			},
		},
	}

	if giteaURL != "" {
		app.Spec.Parameters.Repository = &RepositorySpec{
			URL: fmt.Sprintf("%s/%s/%s", giteaURL, req.Team, req.AppName),
		}
	}

	// Environment-agnostic platform toggles: declared once in the base and
	// inherited by every overlay. Overlays only patch env-specific values
	// (replicas, resources, ingress host).

	// secretsFrom — which K8s secrets the XTenantApp should mount.
	// Lives in base so all environments (dev/staging/production) inherit it
	// without each overlay having to re-declare it.
	if req.VaultSecrets || req.DatabaseSecrets {
		sf := &SecretsFromSpec{}
		if req.VaultSecrets {
			sf.App = &SecretRefToggle{Enabled: true}
		}
		if req.DatabaseSecrets {
			dbSecret := &SecretRefToggle{Enabled: true}
			target := DbSecretTarget(req.AppName, "")
			if target != req.AppName+"-db-creds" {
				dbSecret.SecretName = target
			}
			sf.Database = dbSecret
		}
		app.Spec.Parameters.SecretsFrom = sf
	}

	// ingress enabled toggle + TLS/auth config — platform decision, belongs in base.
	// The host and ClusterIssuer are env-specific and are patched by each overlay
	// via JSON 6902 in kustomization.yaml through the Promote flow.
	if req.IngressEnabled || req.CertManager || req.SSOAuth {
		ing := &IngressSpec{Enabled: true}
		if req.CertManager {
			ing.TLS = &TLSSpec{Enabled: true}
		}
		if req.SSOAuth {
			ing.Auth = &AuthSpec{Enabled: true}
		}
		app.Spec.Parameters.Ingress = ing
	}

	if req.Reloader {
		app.Spec.Parameters.Reloader = &ReloaderSpec{Enabled: true}
	}
	if req.LivenessPath != "" || req.ReadinessPath != "" {
		probes := &ProbesSpec{}
		if req.LivenessPath != "" {
			probes.Liveness = &ProbeDetail{Enabled: true, Path: req.LivenessPath}
		}
		if req.ReadinessPath != "" {
			probes.Readiness = &ProbeDetail{Enabled: true, Path: req.ReadinessPath}
		}
		app.Spec.Parameters.Probes = probes
	}
	if req.RolloutType != "" && req.RolloutType != "RollingUpdate" {
		app.Spec.Parameters.RolloutStrategy = &RolloutStrategy{Type: req.RolloutType}
	}
	if req.DevSpaceEnabled {
		replicas := int32(0)
		app.Spec.Parameters.DevSpace = &DevSpaceSpec{Enabled: true, Replicas: &replicas}
	}
	// Monitoring → Prometheus pod annotations
	if req.MonitorEnabled {
		if app.Spec.Parameters.PodAnnotations == nil {
			app.Spec.Parameters.PodAnnotations = make(map[string]string)
		}
		app.Spec.Parameters.PodAnnotations["prometheus.io/scrape"] = "true"
		if req.ContainerPort != nil {
			app.Spec.Parameters.PodAnnotations["prometheus.io/port"] = fmt.Sprintf("%d", *req.ContainerPort)
		}
		metricsPath := req.MetricsPath
		if metricsPath == "" {
			metricsPath = "/metrics"
		}
		app.Spec.Parameters.PodAnnotations["prometheus.io/path"] = metricsPath
	}

	// Plain env vars
	for _, kv := range req.EnvVars {
		if kv.Key != "" {
			app.Spec.Parameters.Env = append(app.Spec.Parameters.Env, EnvVar{
				Name: kv.Key, Value: kv.Value,
			})
		}
	}

	// Pod annotations
	if len(req.PodAnnotations) > 0 {
		if app.Spec.Parameters.PodAnnotations == nil {
			app.Spec.Parameters.PodAnnotations = make(map[string]string)
		}
		for _, kv := range req.PodAnnotations {
			if kv.Key != "" {
				app.Spec.Parameters.PodAnnotations[kv.Key] = kv.Value
			}
		}
	}

	// Extra labels (merged with managed-by and team labels)
	for _, kv := range req.ExtraLabels {
		if kv.Key != "" {
			app.Metadata.Labels[kv.Key] = kv.Value
		}
	}

	return app
}

// registryHost extracts a container registry host from the Gitea URL.
// "https://gitea.example.com" → "gitea.example.com"
func registryHost(giteaURL string) string {
	host := giteaURL
	for _, prefix := range []string{"https://", "http://"} {
		if len(host) > len(prefix) && host[:len(prefix)] == prefix {
			host = host[len(prefix):]
			break
		}
	}
	if host == "" {
		return "ghcr.io"
	}
	return host
}

// Marshal serialises the XTenantApp to YAML.
func (x *XTenantApp) Marshal() ([]byte, error) {
	return yaml.Marshal(x)
}

// Validate checks required fields.
func (x *XTenantApp) Validate() error {
	if x.Spec.Parameters.AppName == "" {
		return fmt.Errorf("appName is required")
	}
	return nil
}

// XGiteaRepository represents the platform.wxops.cloud/v1alpha1
// XGiteaRepository CR for provisioning a Gitea repository via Crossplane.
type XGiteaRepository struct {
	APIVersion string               `yaml:"apiVersion"`
	Kind       string               `yaml:"kind"`
	Metadata   ResourceMeta         `yaml:"metadata"`
	Spec       XGiteaRepositorySpec `yaml:"spec"`
}

type XGiteaRepositorySpec struct {
	Parameters XGiteaRepositoryParams `yaml:"parameters"`
}

type XGiteaRepositoryParams struct {
	GiteaURL             string          `yaml:"giteaUrl"`
	OrgName              string          `yaml:"orgName"`
	RepoName             string          `yaml:"repoName"`
	Description          string          `yaml:"description,omitempty"`
	Private              bool            `yaml:"private"`
	AutoInit             bool            `yaml:"autoInit"`
	DefaultBranch        string          `yaml:"defaultBranch"`
	HasIssues            bool            `yaml:"hasIssues"`
	HasPullRequests      bool            `yaml:"hasPullRequests"`
	CredentialsSecretRef SecretReference `yaml:"credentialsSecretRef"`
}

type SecretReference struct {
	Name      string `yaml:"name"`
	Namespace string `yaml:"namespace"`
}

// NewXGiteaRepository constructs an XGiteaRepository from the request.
func NewXGiteaRepository(req *CreateProjectRequest, giteaURL, credSecretName, credSecretNS string) *XGiteaRepository {
	desc := req.Description
	if desc == "" {
		desc = fmt.Sprintf("%s service for %s", req.AppName, req.Team)
	}

	return &XGiteaRepository{
		APIVersion: "platform.wxops.cloud/v1alpha1",
		Kind:       "XGiteaRepository",
		Metadata: ResourceMeta{
			Name: req.Team + "-" + req.AppName,
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": "wxops-portal",
				"wxops.cloud/team":             req.Team,
			},
		},
		Spec: XGiteaRepositorySpec{
			Parameters: XGiteaRepositoryParams{
				GiteaURL:        giteaURL,
				OrgName:         req.Team,
				RepoName:        req.AppName,
				Description:     desc,
				Private:         true,
				AutoInit:        true,
				DefaultBranch:   "main",
				HasIssues:       true,
				HasPullRequests: true,
				CredentialsSecretRef: SecretReference{
					Name:      credSecretName,
					Namespace: credSecretNS,
				},
			},
		},
	}
}

// Marshal serialises the XGiteaRepository to YAML.
func (x *XGiteaRepository) Marshal() ([]byte, error) {
	return yaml.Marshal(x)
}

// DefaultNamespace returns the namespace for a given team.
// platform-team maps to "platform"; all others to "tenant-<team>".
func DefaultNamespace(team string) string {
	return defaultNamespace(team)
}

func defaultNamespace(team string) string {
	if team == "platform-team" {
		return "platform"
	}
	return "tenant-" + team
}
