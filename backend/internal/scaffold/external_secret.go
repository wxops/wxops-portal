package scaffold

import "gopkg.in/yaml.v3"

// ExternalSecret represents an external-secrets.io/v1 ExternalSecret CR.
type ExternalSecret struct {
	APIVersion string             `yaml:"apiVersion"  json:"apiVersion"`
	Kind       string             `yaml:"kind"        json:"kind"`
	Metadata   ExternalSecretMeta `yaml:"metadata"    json:"metadata"`
	Spec       ExternalSecretSpec `yaml:"spec"        json:"spec"`
}

type ExternalSecretMeta struct {
	Name      string `yaml:"name"      json:"name"`
	Namespace string `yaml:"namespace" json:"namespace"`
}

type ExternalSecretSpec struct {
	RefreshInterval string                 `yaml:"refreshInterval" json:"refreshInterval"`
	SecretStoreRef  SecretStoreRef         `yaml:"secretStoreRef"  json:"secretStoreRef"`
	Target          ExternalSecretTarget   `yaml:"target"          json:"target"`
	DataFrom        []ExternalSecretSource `yaml:"dataFrom"        json:"dataFrom"`
}

type SecretStoreRef struct {
	Name string `yaml:"name" json:"name"`
	Kind string `yaml:"kind" json:"kind"`
}

type ExternalSecretTarget struct {
	Name string `yaml:"name" json:"name"`
}

type ExternalSecretSource struct {
	Extract ExternalSecretExtract `yaml:"extract" json:"extract"`
}

type ExternalSecretExtract struct {
	Key string `yaml:"key" json:"key"`
}

// NewEnvExternalSecret creates an ExternalSecret for vault app secrets.
// Secret target: {appName}-env
// Vault path:    {team}/{appName}/env
func NewEnvExternalSecret(req *CreateProjectRequest) *ExternalSecret {
	ns := req.Namespace
	if ns == "" {
		ns = DefaultNamespace(req.Team)
	}

	return &ExternalSecret{
		APIVersion: "external-secrets.io/v1",
		Kind:       "ExternalSecret",
		Metadata: ExternalSecretMeta{
			Name:      req.AppName + "-env",
			Namespace: ns,
		},
		Spec: ExternalSecretSpec{
			RefreshInterval: "1m",
			SecretStoreRef: SecretStoreRef{
				Name: "vault-tenant",
				Kind: "ClusterSecretStore",
			},
			Target: ExternalSecretTarget{
				Name: req.AppName + "-env",
			},
			DataFrom: []ExternalSecretSource{
				{Extract: ExternalSecretExtract{
					Key: req.Team + "/" + req.AppName + "/env",
				}},
			},
		},
	}
}

// NewDbExternalSecret creates an ExternalSecret for remote database connection credentials.
// Secret target: {dbName}-creds or {dbName}-db-creds (depending on whether dbName already has -db suffix)
// Vault path:    {team}/databases/{dbName}/connection-creds
func NewDbExternalSecret(req *CreateProjectRequest) *ExternalSecret {
	ns := req.Namespace
	if ns == "" {
		ns = DefaultNamespace(req.Team)
	}
	dbName := ResolveDbName(req.AppName, req.DbName)
	secretName := DbSecretTarget(req.AppName, req.DbName)

	return &ExternalSecret{
		APIVersion: "external-secrets.io/v1",
		Kind:       "ExternalSecret",
		Metadata: ExternalSecretMeta{
			Name:      secretName,
			Namespace: ns,
		},
		Spec: ExternalSecretSpec{
			RefreshInterval: "1m",
			SecretStoreRef: SecretStoreRef{
				Name: "vault-tenant",
				Kind: "ClusterSecretStore",
			},
			Target: ExternalSecretTarget{
				Name: secretName,
			},
			DataFrom: []ExternalSecretSource{
				{Extract: ExternalSecretExtract{
					Key: req.Team + "/databases/" + dbName + "/connection-creds",
				}},
			},
		},
	}
}

// Marshal serialises the ExternalSecret to YAML.
func (e *ExternalSecret) Marshal() ([]byte, error) {
	return yaml.Marshal(e)
}
