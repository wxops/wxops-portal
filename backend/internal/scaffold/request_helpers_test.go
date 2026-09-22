package scaffold

import (
	"bytes"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestResolveDbName(t *testing.T) {
	tests := []struct {
		name    string
		appName string
		dbName  string
		want    string
	}{
		{name: "empty dbName defaults to {appName}-db", appName: "rocket-api", dbName: "", want: "rocket-api-db"},
		{name: "explicit dbName is used verbatim", appName: "rocket-api", dbName: "custom-db", want: "custom-db"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ResolveDbName(tt.appName, tt.dbName); got != tt.want {
				t.Errorf("ResolveDbName(%q, %q) = %q, want %q", tt.appName, tt.dbName, got, tt.want)
			}
		})
	}
}

func TestDbSecretTarget(t *testing.T) {
	tests := []struct {
		name    string
		appName string
		dbName  string
		want    string
	}{
		{name: "empty dbName defaults to {appName}-db-creds", appName: "rocket-api", dbName: "", want: "rocket-api-db-creds"},
		{name: "dbName already ends in -db appends only -creds", appName: "rocket-api", dbName: "custom-db", want: "custom-db-creds"},
		{name: "dbName without -db suffix appends -db-creds", appName: "rocket-api", dbName: "custom", want: "custom-db-creds"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := DbSecretTarget(tt.appName, tt.dbName); got != tt.want {
				t.Errorf("DbSecretTarget(%q, %q) = %q, want %q", tt.appName, tt.dbName, got, tt.want)
			}
		})
	}
}

func TestSystemRef(t *testing.T) {
	tests := []struct {
		name string
		req  *CreateProjectRequest
		want string
	}{
		{name: "explicit systemName wins", req: &CreateProjectRequest{AppName: "rocket-api", SystemName: "rocket-platform"}, want: "rocket-platform"},
		{name: "falls back to appName when systemName empty", req: &CreateProjectRequest{AppName: "rocket-api"}, want: "rocket-api"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := systemRef(tt.req); got != tt.want {
				t.Errorf("systemRef() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestRegistryHost(t *testing.T) {
	tests := []struct {
		name     string
		giteaURL string
		want     string
	}{
		{name: "strips https", giteaURL: "https://gitea.example.com", want: "gitea.example.com"},
		{name: "strips http", giteaURL: "http://gitea.example.com", want: "gitea.example.com"},
		{name: "already bare host passed through", giteaURL: "gitea.example.com", want: "gitea.example.com"},
		{name: "empty falls back to ghcr.io", giteaURL: "", want: "ghcr.io"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := registryHost(tt.giteaURL); got != tt.want {
				t.Errorf("registryHost(%q) = %q, want %q", tt.giteaURL, got, tt.want)
			}
		})
	}
}

func TestDefaultNamespace(t *testing.T) {
	tests := []struct {
		name string
		team string
		want string
	}{
		{name: "platform-team maps to platform namespace", team: "platform-team", want: "platform"},
		{name: "regular team gets tenant- prefix", team: "rocket-team", want: "tenant-rocket-team"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := DefaultNamespace(tt.team); got != tt.want {
				t.Errorf("DefaultNamespace(%q) = %q, want %q", tt.team, got, tt.want)
			}
		})
	}
}

func TestGitopsRepoURL(t *testing.T) {
	tests := []struct {
		name     string
		giteaURL string
		owner    string
		repo     string
		want     string
	}{
		{name: "trims trailing slash", giteaURL: "https://gitea.example.com/", owner: "platform-team", repo: "gitops-infra", want: "https://gitea.example.com/platform-team/gitops-infra.git"},
		{name: "no trailing slash to trim", giteaURL: "https://gitea.example.com", owner: "platform-team", repo: "gitops-infra", want: "https://gitea.example.com/platform-team/gitops-infra.git"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := GitopsRepoURL(tt.giteaURL, tt.owner, tt.repo); got != tt.want {
				t.Errorf("GitopsRepoURL() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestXTenantAppValidate(t *testing.T) {
	t.Run("missing appName is an error", func(t *testing.T) {
		x := &XTenantApp{}
		if err := x.Validate(); err == nil {
			t.Error("Validate() = nil, want error for missing appName")
		}
	})

	t.Run("appName present is valid", func(t *testing.T) {
		x := &XTenantApp{Spec: XTenantAppSpec{Parameters: XTenantAppParams{AppName: "rocket-api"}}}
		if err := x.Validate(); err != nil {
			t.Errorf("Validate() = %v, want nil", err)
		}
	})
}

func TestMergeEnvPatch(t *testing.T) {
	baseReplicas := int32(1)
	patchReplicas := int32(3)

	base := &XTenantApp{Spec: XTenantAppSpec{Parameters: XTenantAppParams{
		AppName:  "rocket-api",
		Replicas: &baseReplicas,
	}}}
	patch := &XTenantApp{Spec: XTenantAppSpec{Parameters: XTenantAppParams{
		Replicas:  &patchReplicas,
		Resources: &ResourceSpec{Requests: &ResourceValues{CPU: "100m"}},
		Ingress:   &IngressSpec{Enabled: true},
	}}}

	MergeEnvPatch(base, patch)

	if base.Spec.Parameters.AppName != "rocket-api" {
		t.Errorf("MergeEnvPatch() overwrote AppName, got %q", base.Spec.Parameters.AppName)
	}
	if base.Spec.Parameters.Replicas == nil || *base.Spec.Parameters.Replicas != 3 {
		t.Errorf("MergeEnvPatch() did not apply Replicas patch, got %v", base.Spec.Parameters.Replicas)
	}
	if base.Spec.Parameters.Resources == nil || base.Spec.Parameters.Resources.Requests.CPU != "100m" {
		t.Errorf("MergeEnvPatch() did not apply Resources patch, got %+v", base.Spec.Parameters.Resources)
	}
	if base.Spec.Parameters.Ingress == nil || !base.Spec.Parameters.Ingress.Enabled {
		t.Errorf("MergeEnvPatch() did not apply Ingress patch, got %+v", base.Spec.Parameters.Ingress)
	}

	t.Run("nil patch fields leave base untouched", func(t *testing.T) {
		base2 := &XTenantApp{Spec: XTenantAppSpec{Parameters: XTenantAppParams{
			AppName:   "rocket-api",
			Resources: &ResourceSpec{Requests: &ResourceValues{CPU: "200m"}},
		}}}
		emptyPatch := &XTenantApp{}
		MergeEnvPatch(base2, emptyPatch)
		if base2.Spec.Parameters.Resources == nil || base2.Spec.Parameters.Resources.Requests.CPU != "200m" {
			t.Errorf("MergeEnvPatch() with empty patch should not touch existing Resources, got %+v", base2.Spec.Parameters.Resources)
		}
	})
}

func TestBuildBaseKustomization(t *testing.T) {
	out, err := BuildBaseKustomization([]string{"xtenant-app.yaml", "external-secret-env.yaml"})
	if err != nil {
		t.Fatalf("BuildBaseKustomization() error = %v", err)
	}
	var k Kustomization
	if err := yaml.Unmarshal(out, &k); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	if k.APIVersion != "kustomize.config.k8s.io/v1beta1" || k.Kind != "Kustomization" {
		t.Errorf("BuildBaseKustomization() apiVersion/kind = %q/%q, want kustomize.config.k8s.io/v1beta1/Kustomization", k.APIVersion, k.Kind)
	}
	if len(k.Resources) != 2 || k.Resources[0] != "xtenant-app.yaml" || k.Resources[1] != "external-secret-env.yaml" {
		t.Errorf("BuildBaseKustomization() resources = %v, want the two input filenames in order", k.Resources)
	}
}

func TestBuildOverlayFiles(t *testing.T) {
	files, err := BuildOverlayFiles()
	if err != nil {
		t.Fatalf("BuildOverlayFiles() error = %v", err)
	}
	if _, ok := files["kustomization.yaml"]; !ok {
		t.Error("BuildOverlayFiles() missing kustomization.yaml")
	}
	if _, ok := files["image-transformer.yaml"]; !ok {
		t.Error("BuildOverlayFiles() missing image-transformer.yaml")
	}

	var k OverlayKustomization
	if err := yaml.Unmarshal(files["kustomization.yaml"], &k); err != nil {
		t.Fatalf("unmarshal kustomization.yaml: %v", err)
	}
	// The images: field must never appear — ArgoCD Image Updater owns it and a
	// static value causes a reset-to-latest fight on every reconcile.
	if bytes.Contains(files["kustomization.yaml"], []byte("images:")) {
		t.Error("BuildOverlayFiles() kustomization.yaml must never contain a static images: block")
	}
	if len(k.Resources) != 1 || k.Resources[0] != "../../base" {
		t.Errorf("BuildOverlayFiles() resources = %v, want [../../base]", k.Resources)
	}
}
