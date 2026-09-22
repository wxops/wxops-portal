package scaffold

import (
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func mustParseKust(t *testing.T, data []byte) OverlayKustomization {
	t.Helper()
	var k OverlayKustomization
	if err := yaml.Unmarshal(data, &k); err != nil {
		t.Fatalf("unmarshal kustomization.yaml: %v", err)
	}
	return k
}

func findPatch(k OverlayKustomization, kind, name string) *PatchRef {
	for i := range k.Patches {
		p := &k.Patches[i]
		if p.Target != nil && p.Target.Kind == kind && p.Target.Name == name {
			return p
		}
	}
	return nil
}

func TestGenerateOverlayFiles_DevEnvironment(t *testing.T) {
	req := &OverlayRequest{Team: "rocket-team", AppName: "rocket-api", EnvName: "dev"}
	files, err := GenerateOverlayFiles(req)
	if err != nil {
		t.Fatalf("GenerateOverlayFiles() error = %v", err)
	}
	for _, want := range []string{"kustomization.yaml", "image-transformer.yaml", "patch-xtenant-app.yaml"} {
		if _, ok := files[want]; !ok {
			t.Errorf("GenerateOverlayFiles() missing %s", want)
		}
	}

	k := mustParseKust(t, files["kustomization.yaml"])

	// Dev must not rename the XTenantApp or ExternalSecret — no rename patch on XTenantApp.
	if p := findPatch(k, "XTenantApp", "rocket-team-rocket-api"); p != nil {
		if strings.Contains(p.Patch, "/metadata/name") {
			t.Error("dev overlay should not rename the XTenantApp XR")
		}
	}
	// Dev's ExternalSecret patch targets the base name (no -dev- suffix).
	esPatch := findPatch(k, "ExternalSecret", "rocket-api-env")
	if esPatch == nil {
		t.Fatal("dev overlay missing ExternalSecret vault-key patch")
	}
	if !strings.Contains(esPatch.Patch, "rocket-team/rocket-api/dev/env") {
		t.Errorf("dev ExternalSecret patch does not set the dev vault key:\n%s", esPatch.Patch)
	}
	if strings.Contains(esPatch.Patch, "/metadata/name") {
		t.Error("dev ExternalSecret patch should not rename the secret")
	}

	// patch-xtenant-app.yaml: dev keeps the base appName (no env suffix).
	var patch XTenantApp
	if err := yaml.Unmarshal(files["patch-xtenant-app.yaml"], &patch); err != nil {
		t.Fatalf("unmarshal patch-xtenant-app.yaml: %v", err)
	}
	if patch.Spec.Parameters.AppName != "" {
		t.Errorf("dev patch AppName = %q, want empty (inherits from base)", patch.Spec.Parameters.AppName)
	}
	if patch.Metadata.Name != "rocket-team-rocket-api" {
		t.Errorf("dev patch target name = %q, want rocket-team-rocket-api", patch.Metadata.Name)
	}
}

func TestGenerateOverlayFiles_StagingRenamesXRAndSecret(t *testing.T) {
	req := &OverlayRequest{Team: "rocket-team", AppName: "rocket-api", EnvName: "staging", IngressHost: "rocket-api-staging.example.com"}
	files, err := GenerateOverlayFiles(req)
	if err != nil {
		t.Fatalf("GenerateOverlayFiles() error = %v", err)
	}
	k := mustParseKust(t, files["kustomization.yaml"])

	// XTenantApp patch targets the base name but renames to the -staging suffix.
	appPatch := findPatch(k, "XTenantApp", "rocket-team-rocket-api")
	if appPatch == nil {
		t.Fatal("staging overlay missing XTenantApp patch")
	}
	if !strings.Contains(appPatch.Patch, "value: rocket-team-rocket-api-staging") {
		t.Errorf("staging XTenantApp patch does not rename to the -staging suffix:\n%s", appPatch.Patch)
	}
	if !strings.Contains(appPatch.Patch, "rocket-api-staging.example.com") {
		t.Errorf("staging XTenantApp patch missing ingress host:\n%s", appPatch.Patch)
	}

	// ExternalSecret is renamed with the env suffix for staging.
	esPatch := findPatch(k, "ExternalSecret", "rocket-api-env")
	if esPatch == nil {
		t.Fatal("staging overlay missing ExternalSecret patch")
	}
	if !strings.Contains(esPatch.Patch, "value: rocket-api-staging-env") {
		t.Errorf("staging ExternalSecret patch does not rename to rocket-api-staging-env:\n%s", esPatch.Patch)
	}
	if !strings.Contains(esPatch.Patch, "rocket-team/rocket-api/staging/env") {
		t.Errorf("staging ExternalSecret patch does not set the staging vault key:\n%s", esPatch.Patch)
	}

	// patch-xtenant-app.yaml: staging gets an env-suffixed appName.
	var patch XTenantApp
	if err := yaml.Unmarshal(files["patch-xtenant-app.yaml"], &patch); err != nil {
		t.Fatalf("unmarshal patch-xtenant-app.yaml: %v", err)
	}
	if patch.Spec.Parameters.AppName != "rocket-api-staging" {
		t.Errorf("staging patch AppName = %q, want rocket-api-staging", patch.Spec.Parameters.AppName)
	}
}

func TestGenerateOverlayFiles_DatabaseSharedTier(t *testing.T) {
	req := &OverlayRequest{
		Team: "rocket-team", AppName: "rocket-api", EnvName: "dev",
		DatabaseEnabled: true, DbClusterRef: "shared-pg-1", DbClusterNamespace: "cnpg-system",
	}
	files, err := GenerateOverlayFiles(req)
	if err != nil {
		t.Fatalf("GenerateOverlayFiles() error = %v", err)
	}
	k := mustParseKust(t, files["kustomization.yaml"])

	dbPatch := findPatch(k, "XTenantDatabase", "rocket-team-rocket-api-db")
	if dbPatch == nil {
		t.Fatal("missing XTenantDatabase patch")
	}
	for _, want := range []string{
		"value: rocket-api-dev-db", // dbName defaults to {appName}-{env}-db
		"value: shared",
		"value: dev",
		"value: shared-pg-1",
		"value: cnpg-system",
	} {
		if !strings.Contains(dbPatch.Patch, want) {
			t.Errorf("shared-tier db patch missing %q:\n%s", want, dbPatch.Patch)
		}
	}
	if strings.Contains(dbPatch.Patch, "dedicatedCluster") {
		t.Error("shared-tier db patch should not include a dedicatedCluster block")
	}
}

func TestGenerateOverlayFiles_DatabaseDedicatedTierDefaults(t *testing.T) {
	req := &OverlayRequest{
		Team: "rocket-team", AppName: "rocket-api", EnvName: "production",
		DatabaseEnabled: true, DbTier: "dedicated",
	}
	files, err := GenerateOverlayFiles(req)
	if err != nil {
		t.Fatalf("GenerateOverlayFiles() error = %v", err)
	}
	k := mustParseKust(t, files["kustomization.yaml"])

	// production dedicated: dbName defaults to {appName}-production-db, environment normalizes to "prod".
	dbPatch := findPatch(k, "XTenantDatabase", "rocket-team-rocket-api-db")
	if dbPatch == nil {
		t.Fatal("missing XTenantDatabase patch")
	}
	if !strings.Contains(dbPatch.Patch, "rocket-team-rocket-api-production-db") {
		t.Errorf("production db XR should be renamed with the -production-db suffix:\n%s", dbPatch.Patch)
	}
	if !strings.Contains(dbPatch.Patch, "value: prod") {
		t.Errorf("production db environment should normalize to 'prod', not 'production':\n%s", dbPatch.Patch)
	}
	for _, want := range []string{"instances: 1", "storageSize: 1Gi", "postgresVersion: 16", "enablePooler: false", "namespace: cnpg-system"} {
		if !strings.Contains(dbPatch.Patch, want) {
			t.Errorf("dedicated-tier db patch missing default %q:\n%s", want, dbPatch.Patch)
		}
	}

	// Production also renames the DB ExternalSecret.
	esPatch := findPatch(k, "ExternalSecret", "rocket-api-db-creds")
	if esPatch == nil {
		t.Fatal("production overlay missing DB ExternalSecret rename patch")
	}
	if !strings.Contains(esPatch.Patch, "rocket-api-production-db-creds") {
		t.Errorf("production DB ExternalSecret should rename to rocket-api-production-db-creds:\n%s", esPatch.Patch)
	}
}

func TestBuildOverlayPatch(t *testing.T) {
	t.Run("dev keeps base appName", func(t *testing.T) {
		p := buildOverlayPatch(&OverlayRequest{Team: "rocket-team", AppName: "rocket-api", EnvName: "dev"})
		if p.Spec.Parameters.AppName != "" {
			t.Errorf("dev appName = %q, want empty", p.Spec.Parameters.AppName)
		}
		if p.Metadata.Name != "rocket-team-rocket-api" {
			t.Errorf("target name = %q, want rocket-team-rocket-api", p.Metadata.Name)
		}
	})

	t.Run("production gets env-suffixed appName", func(t *testing.T) {
		p := buildOverlayPatch(&OverlayRequest{Team: "rocket-team", AppName: "rocket-api", EnvName: "production"})
		if p.Spec.Parameters.AppName != "rocket-api-production" {
			t.Errorf("production appName = %q, want rocket-api-production", p.Spec.Parameters.AppName)
		}
		// Target name always stays the base name — rename happens via JSON 6902 separately.
		if p.Metadata.Name != "rocket-team-rocket-api" {
			t.Errorf("target name = %q, want rocket-team-rocket-api (rename happens elsewhere)", p.Metadata.Name)
		}
	})

	t.Run("replicas and resources pass through untouched", func(t *testing.T) {
		replicas := int32(5)
		res := &ResourceSpec{Requests: &ResourceValues{CPU: "250m"}}
		p := buildOverlayPatch(&OverlayRequest{Team: "t", AppName: "a", EnvName: "dev", Replicas: &replicas, Resources: res})
		if p.Spec.Parameters.Replicas == nil || *p.Spec.Parameters.Replicas != 5 {
			t.Errorf("Replicas = %v, want 5", p.Spec.Parameters.Replicas)
		}
		if p.Spec.Parameters.Resources != res {
			t.Error("Resources pointer should pass through unchanged")
		}
	})
}

func TestParseOverlayConfig_RoundTripsGeneratedFiles(t *testing.T) {
	replicas := int32(3)
	req := &OverlayRequest{
		Team: "rocket-team", AppName: "rocket-api", EnvName: "staging",
		Replicas:    &replicas,
		IngressHost: "rocket-api-staging.example.com",
		CertIssuer:  "letsencrypt-staging",
		Resources:   &ResourceSpec{Requests: &ResourceValues{CPU: "200m", Memory: "256Mi"}},
	}
	files, err := GenerateOverlayFiles(req)
	if err != nil {
		t.Fatalf("GenerateOverlayFiles() error = %v", err)
	}

	cfg, err := ParseOverlayConfig(files["kustomization.yaml"], files["patch-xtenant-app.yaml"])
	if err != nil {
		t.Fatalf("ParseOverlayConfig() error = %v", err)
	}

	if cfg.Replicas == nil || *cfg.Replicas != 3 {
		t.Errorf("parsed Replicas = %v, want 3", cfg.Replicas)
	}
	if cfg.IngressHost != "rocket-api-staging.example.com" {
		t.Errorf("parsed IngressHost = %q, want rocket-api-staging.example.com", cfg.IngressHost)
	}
	if cfg.CertIssuer != "letsencrypt-staging" {
		t.Errorf("parsed CertIssuer = %q, want letsencrypt-staging", cfg.CertIssuer)
	}
	if cfg.Resources == nil || cfg.Resources.Requests.CPU != "200m" {
		t.Errorf("parsed Resources = %+v, want CPU 200m", cfg.Resources)
	}
}

func TestParseOverlayConfig_EmptyInputsDoNotError(t *testing.T) {
	cfg, err := ParseOverlayConfig(nil, nil)
	if err != nil {
		t.Fatalf("ParseOverlayConfig(nil, nil) error = %v, want nil", err)
	}
	if cfg == nil {
		t.Fatal("ParseOverlayConfig(nil, nil) = nil config, want a zero-value struct")
	}
}

func TestBuildDarlanePatch(t *testing.T) {
	t.Run("minimal spec: enabled only", func(t *testing.T) {
		patch := BuildDarlanePatch(&DarlaneSpec{Enabled: true}, "rocket-team-rocket-api")
		if !strings.Contains(patch, "path: /spec/parameters/darlane") {
			t.Errorf("patch missing target path:\n%s", patch)
		}
		if !strings.Contains(patch, "enabled: true") {
			t.Errorf("patch missing enabled: true:\n%s", patch)
		}
	})

	t.Run("integer command tokens are quoted for K8s []string compatibility", func(t *testing.T) {
		replicas := int32(1)
		patch := BuildDarlanePatch(&DarlaneSpec{
			Enabled:  true,
			Replicas: &replicas,
			Command:  []string{"sleep", "3600"},
		}, "x")
		if !strings.Contains(patch, "- sleep") {
			t.Errorf("patch should not quote the non-numeric token 'sleep':\n%s", patch)
		}
		if !strings.Contains(patch, "- '3600'") {
			t.Errorf("patch should single-quote the numeric token '3600' so YAML doesn't parse it as int:\n%s", patch)
		}
	})

	t.Run("fileSync without an explicit image defaults initFromImage to false", func(t *testing.T) {
		patch := BuildDarlanePatch(&DarlaneSpec{
			Enabled:  true,
			FileSync: &FileSyncSpec{Enabled: true, MountPath: "/app"},
		}, "x")
		if !strings.Contains(patch, "initFromImage: false") {
			t.Errorf("patch should default initFromImage to false when unset:\n%s", patch)
		}
	})

	t.Run("stickySession only renders when enabled", func(t *testing.T) {
		disabled := BuildDarlanePatch(&DarlaneSpec{Enabled: true, StickySession: &StickySessionSpec{Enabled: false, CookieName: "sid"}}, "x")
		if strings.Contains(disabled, "stickySession") {
			t.Errorf("disabled stickySession should not appear in the patch:\n%s", disabled)
		}
		enabled := BuildDarlanePatch(&DarlaneSpec{Enabled: true, StickySession: &StickySessionSpec{Enabled: true, CookieName: "sid", Secure: true}}, "x")
		if !strings.Contains(enabled, "cookieName: sid") || !strings.Contains(enabled, "secure: true") {
			t.Errorf("enabled stickySession should render its fields:\n%s", enabled)
		}
	})
}

func TestInjectAndRemoveDarlanePatch(t *testing.T) {
	base := &OverlayKustomization{
		APIVersion: "kustomize.config.k8s.io/v1beta1",
		Kind:       "Kustomization",
		Resources:  []string{"../../base"},
		Patches: []PatchRef{
			{Path: "patch-xtenant-app.yaml"},
		},
	}
	baseYAML, err := yaml.Marshal(base)
	if err != nil {
		t.Fatalf("marshal base kustomization: %v", err)
	}

	darlanePatch := BuildDarlanePatch(&DarlaneSpec{Enabled: true}, "rocket-team-rocket-api")
	injected, err := InjectDarlanePatch(baseYAML, darlanePatch, "rocket-team-rocket-api")
	if err != nil {
		t.Fatalf("InjectDarlanePatch() error = %v", err)
	}
	k := mustParseKust(t, injected)
	if findPatch(k, "XTenantApp", "rocket-team-rocket-api") == nil {
		t.Fatal("InjectDarlanePatch() did not add the darlane patch")
	}

	t.Run("re-injecting replaces rather than duplicates", func(t *testing.T) {
		reinjected, err := InjectDarlanePatch(injected, darlanePatch, "rocket-team-rocket-api")
		if err != nil {
			t.Fatalf("InjectDarlanePatch() (second call) error = %v", err)
		}
		k2 := mustParseKust(t, reinjected)
		count := 0
		for _, p := range k2.Patches {
			if p.Target != nil && p.Target.Kind == "XTenantApp" && strings.Contains(p.Patch, "/spec/parameters/darlane") {
				count++
			}
		}
		if count != 1 {
			t.Errorf("expected exactly 1 darlane patch after re-injecting, got %d", count)
		}
	})

	t.Run("RemoveDarlanePatch strips it and leaves other patches intact", func(t *testing.T) {
		removed, err := RemoveDarlanePatch(injected)
		if err != nil {
			t.Fatalf("RemoveDarlanePatch() error = %v", err)
		}
		k3 := mustParseKust(t, removed)
		if findPatch(k3, "XTenantApp", "rocket-team-rocket-api") != nil {
			t.Error("RemoveDarlanePatch() did not remove the darlane patch")
		}
		found := false
		for _, p := range k3.Patches {
			if p.Path == "patch-xtenant-app.yaml" {
				found = true
			}
		}
		if !found {
			t.Error("RemoveDarlanePatch() should not remove unrelated patches")
		}
	})
}
