package scaffold

import (
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// OverlayRequest holds env-specific parameters for Kustomize overlay generation.
// Only the fields that differ per environment are included here; everything else
// is inherited from the base manifests.
type OverlayRequest struct {
	Team        string
	AppName     string
	EnvName     string // "dev" | "staging" | "production"
	Replicas    *int32
	IngressHost string
	Resources   *ResourceSpec

	// Database — patch XTenantDatabase when database secrets are enabled in base.
	// All per-env DB details come from the Promote flow; the base is a stub with extensions only.
	DatabaseEnabled    bool
	DbName             string // logical db name for this env (default: {appName}-db)
	DbTier             string // "shared" or "dedicated" (default: shared)
	DbEnvironment      string // optional override for the environment label (default: EnvName); useful when dev+staging share a cluster
	DbClusterRef       string // shared-tier: cluster reference for this environment
	DbClusterNamespace string // shared-tier: namespace where the shared cluster lives

	// Dedicated-tier cluster parameters — only used when DbTier == "dedicated".
	DbInstances       int32  // number of primary+replica nodes
	DbStorageSize     string // PV size per node, e.g. "5Gi"
	DbPostgresVersion int    // major version, e.g. 16
	DbEnablePooler    bool   // deploy PgBouncer pooler sidecar
	DbNamespace       string // namespace where the dedicated CNPG cluster is created

	// Cert-TLS — override clusterIssuer per environment (e.g. letsencrypt-staging).
	CertIssuer string
}

// GenerateOverlayFiles returns the files that make up a Kustomize overlay:
//
//   - kustomization.yaml        references ../../base + image-transformer.yaml
//   - image-transformer.yaml    lets Kustomize patch spec/parameters/image on XTenantApp
//   - patch-xtenant-app.yaml    env-specific replicas, resources, ingress, XR name suffix
//
// For staging and production, kustomization.yaml also contains an inline JSON 6902 patch
// that renames the ExternalSecret and rewrites its Vault key to the env-specific path.
func GenerateOverlayFiles(req *OverlayRequest) (map[string][]byte, error) {
	files, err := buildOverlayKustomization(req)
	if err != nil {
		return nil, err
	}

	patch := buildOverlayPatch(req)
	patchYAML, err := yaml.Marshal(patch)
	if err != nil {
		return nil, err
	}
	files["patch-xtenant-app.yaml"] = patchYAML

	return files, nil
}

// buildOverlayKustomization returns kustomization.yaml and image-transformer.yaml.
// Every overlay adds an inline ExternalSecret JSON 6902 patch that rewrites the
// Vault key to the env-specific path ({team}/{appName}/{env}/env).
// Staging and production also rename the ExternalSecret and its K8s Secret target
// to {appName}-{envName}-env (e.g. python-demo-staging-env) so resources are unique
// across environments. Dev keeps the base name ({appName}-env) — only the vault key
// is overridden.
func buildOverlayKustomization(req *OverlayRequest) (map[string][]byte, error) {
	patches := []PatchRef{
		{Path: "patch-xtenant-app.yaml"},
	}

	baseXRName := req.Team + "-" + req.AppName
	xrName := baseXRName
	if req.EnvName == "staging" || req.EnvName == "production" {
		xrName += "-" + req.EnvName
	}

	vaultKey := fmt.Sprintf("%s/%s/%s/env", req.Team, req.AppName, req.EnvName)

	if req.EnvName == "staging" || req.EnvName == "production" {
		// Rename ExternalSecret + K8s Secret so they are unique per environment.
		// Pattern: {appName}-{envName}-env (e.g. python-demo-staging-env)
		envSecretName := req.AppName + "-" + req.EnvName + "-env"
		esPatch := strings.TrimSpace(fmt.Sprintf(`
- op: replace
  path: /metadata/name
  value: %s
- op: replace
  path: /spec/target/name
  value: %s
- op: replace
  path: /spec/dataFrom/0/extract/key
  value: %s`, envSecretName, envSecretName, vaultKey))

		patches = append(patches, PatchRef{
			Patch:  esPatch,
			Target: &PatchTarget{Kind: "ExternalSecret", Name: req.AppName + "-env"},
		})
	} else {
		// Dev: only override the vault key; keep the base ExternalSecret name.
		esPatch := strings.TrimSpace(fmt.Sprintf(`
- op: replace
  path: /spec/dataFrom/0/extract/key
  value: %s`, vaultKey))

		patches = append(patches, PatchRef{
			Patch:  esPatch,
			Target: &PatchTarget{Kind: "ExternalSecret", Name: req.AppName + "-env"},
		})
	}

	// XTenantApp patches: always target the base name so strategic-merge and
	// JSON 6902 patches both select the correct resource regardless of ordering.
	// For staging/production: rename is included here so the XR gets a unique
	// name per environment in the shared argocd/spoke namespace.
	if req.EnvName == "staging" || req.EnvName == "production" {
		// Build combined patch: optional ingress host + required rename + optional cert issuer.
		var appOps []string
		if req.IngressHost != "" {
			appOps = append(appOps, fmt.Sprintf("- op: add\n  path: /spec/parameters/ingress/host\n  value: %s", req.IngressHost))
		}
		appOps = append(appOps, fmt.Sprintf("- op: replace\n  path: /metadata/name\n  value: %s", xrName))
		if req.CertIssuer != "" {
			appOps = append(appOps, fmt.Sprintf("- op: add\n  path: /spec/parameters/ingress/tls/clusterIssuer\n  value: %s", req.CertIssuer))
		}
		patches = append(patches, PatchRef{
			Patch:  strings.Join(appOps, "\n"),
			Target: &PatchTarget{Kind: "XTenantApp", Name: baseXRName},
		})
	} else {
		// Dev: no rename; only add ingress/cert patches when values are provided.
		if req.IngressHost != "" {
			hostPatch := strings.TrimSpace(fmt.Sprintf(`
- op: add
  path: /spec/parameters/ingress/host
  value: %s`, req.IngressHost))
			patches = append(patches, PatchRef{
				Patch:  hostPatch,
				Target: &PatchTarget{Kind: "XTenantApp", Name: baseXRName},
			})
		}
		if req.CertIssuer != "" {
			issuerPatch := strings.TrimSpace(fmt.Sprintf(`
- op: add
  path: /spec/parameters/ingress/tls/clusterIssuer
  value: %s`, req.CertIssuer))
			patches = append(patches, PatchRef{
				Patch:  issuerPatch,
				Target: &PatchTarget{Kind: "XTenantApp", Name: baseXRName},
			})
		}
	}

	// Database patches — the base XTenantDatabase is a stub (extensions + owner only).
	// Promotion fills in dbName, tier, environment, and optional cluster details per env.
	if req.DatabaseEnabled {
		dbName := req.DbName
		if dbName == "" {
			// Always include the env suffix so each environment gets its own database by
			// default — prevents accidental cross-environment sharing.
			dbName = req.AppName + "-" + req.EnvName + "-db"
		}
		dbXRName := req.Team + "-" + req.AppName + "-db" // base stub always uses this name

		tier := req.DbTier
		if tier == "" {
			tier = "shared"
		}

		// DbEnvironment lets dev and staging share the same shared pool while each keeps
		// its own isolated database within that pool. Defaults to EnvName if not overridden.
		// XTenantDatabase accepts "dev" | "staging" | "prod" — always normalise "production".
		dbEnv := req.DbEnvironment
		if dbEnv == "" {
			dbEnv = req.EnvName
		}
		if dbEnv == "production" {
			dbEnv = "prod"
		}

		// For staging/production, rename the XTenantDatabase XR to include the env suffix
		// so it is unique in the spoke cluster alongside the dev XR.
		var dbPatch string
		if req.EnvName == "staging" || req.EnvName == "production" {
			renamedDbXRName := req.Team + "-" + req.AppName + "-" + req.EnvName + "-db"
			dbPatch = fmt.Sprintf("- op: replace\n  path: /metadata/name\n  value: %s\n", renamedDbXRName)
		}

		// op:add because these fields are absent from the base stub.
		dbPatch += strings.TrimSpace(fmt.Sprintf(`
- op: add
  path: /spec/parameters/dbName
  value: %s
- op: add
  path: /spec/parameters/tier
  value: %s
- op: add
  path: /spec/parameters/environment
  value: %s`, dbName, tier, dbEnv))

		if tier == "shared" {
			if req.DbClusterRef != "" {
				dbPatch += "\n" + strings.TrimSpace(fmt.Sprintf(`
- op: add
  path: /spec/parameters/clusterRef
  value: %s`, req.DbClusterRef))
			}
			if req.DbClusterNamespace != "" {
				dbPatch += "\n" + strings.TrimSpace(fmt.Sprintf(`
- op: add
  path: /spec/parameters/clusterNamespace
  value: %s`, req.DbClusterNamespace))
			}
		} else if tier == "dedicated" {
			// Apply defaults so the dedicatedCluster block is always well-formed.
			instances := req.DbInstances
			if instances <= 0 {
				instances = 1
			}
			storageSize := req.DbStorageSize
			if storageSize == "" {
				storageSize = "1Gi"
			}
			pgVersion := req.DbPostgresVersion
			if pgVersion <= 0 {
				pgVersion = 16
			}

			dedicated := []string{
				fmt.Sprintf("    instances: %d", instances),
				fmt.Sprintf("    storageSize: %s", storageSize),
				fmt.Sprintf("    postgresVersion: %d", pgVersion),
			}
			if req.DbEnablePooler {
				dedicated = append(dedicated, "    enablePooler: true")
			} else {
				dedicated = append(dedicated, "    enablePooler: false")
			}
			dedicated = append(dedicated, "    namespace: cnpg-system")
			dbPatch += "\n- op: add\n  path: /spec/parameters/dedicatedCluster\n  value:\n" + strings.Join(dedicated, "\n")
		}

		patches = append(patches, PatchRef{
			Patch:  strings.TrimSpace(dbPatch),
			Target: &PatchTarget{Kind: "XTenantDatabase", Name: dbXRName},
		})

		// For staging/production, rename the DB ExternalSecret and update its Vault key
		// to match the env-specific dbName. Dev keeps the base names unchanged.
		if req.EnvName == "staging" || req.EnvName == "production" {
			baseDbSecretName := DbSecretTarget(req.AppName, "")
			envDbSecretName := req.AppName + "-" + req.EnvName + "-db-creds"
			dbESPatch := strings.TrimSpace(fmt.Sprintf(`
- op: replace
  path: /spec/dataFrom/0/extract/key
  value: %s/databases/%s/connection-creds
- op: replace
  path: /spec/target/name
  value: %s
- op: replace
  path: /metadata/name
  value: %s`, req.Team, dbName, envDbSecretName, envDbSecretName))

			patches = append(patches, PatchRef{
				Patch:  dbESPatch,
				Target: &PatchTarget{Kind: "ExternalSecret", Name: baseDbSecretName},
			})
		}
	}

	kust := OverlayKustomization{
		APIVersion:     "kustomize.config.k8s.io/v1beta1",
		Kind:           "Kustomization",
		Resources:      []string{"../../base"},
		Configurations: []string{"image-transformer.yaml"},
		Patches:        patches,
	}
	kustYAML, err := yaml.Marshal(&kust)
	if err != nil {
		return nil, err
	}

	transformer := imageTransformerConfig{
		Images: []imageTransformerEntry{
			{Path: "spec/parameters/image", Kind: "XTenantApp"},
		},
	}
	transformerYAML, err := yaml.Marshal(&transformer)
	if err != nil {
		return nil, err
	}

	return map[string][]byte{
		"kustomization.yaml":     kustYAML,
		"image-transformer.yaml": transformerYAML,
	}, nil
}

// buildOverlayPatch constructs a sparse XTenantApp strategic-merge patch for an environment.
// The patch always targets the base resource name so kustomize can select it before any
// JSON 6902 rename runs. The rename itself lives in kustomization.yaml for staging/production.
//
// For staging/production, appName gets an env suffix so the XR's internal name is distinct
// from dev (e.g. python-demo-staging vs python-demo). Replicas and resources are patched
// here; ingress host and cert issuer are patched via JSON 6902 in kustomization.yaml.
func buildOverlayPatch(req *OverlayRequest) *XTenantApp {
	// Always use the base name — the rename for staging/production is applied via
	// JSON 6902 in kustomization.yaml after this strategic-merge patch is resolved.
	baseXRName := req.Team + "-" + req.AppName

	patch := &XTenantApp{
		APIVersion: "platform.wxops.cloud/v1alpha1",
		Kind:       "XTenantApp",
		Metadata:   ResourceMeta{Name: baseXRName},
	}

	params := &XTenantAppParams{}
	// For staging/production, set env-suffixed appName so the XR is distinguishable
	// from other environments within the same spoke cluster.
	if req.EnvName == "staging" || req.EnvName == "production" {
		params.AppName = req.AppName + "-" + req.EnvName
	}
	if req.Replicas != nil {
		params.Replicas = req.Replicas
	}
	if req.Resources != nil {
		params.Resources = req.Resources
	}

	patch.Spec.Parameters = *params
	return patch
}

// OverlayConfig holds the parsed values from an existing Kustomize overlay.
// It is the inverse of OverlayRequest — used to pre-fill the edit wizard.
type OverlayConfig struct {
	Replicas    *int32        `json:"replicas,omitempty"`
	IngressHost string        `json:"ingressHost,omitempty"`
	Resources   *ResourceSpec `json:"resources,omitempty"`
	// Database
	DbName             string `json:"dbName,omitempty"`
	DbTier             string `json:"dbTier,omitempty"`
	DbEnvironment      string `json:"dbEnvironment,omitempty"`
	DbClusterRef       string `json:"dbClusterRef,omitempty"`
	DbClusterNamespace string `json:"dbClusterNamespace,omitempty"`
	// Dedicated-tier
	DbInstances       int32  `json:"dbInstances,omitempty"`
	DbStorageSize     string `json:"dbStorageSize,omitempty"`
	DbPostgresVersion int    `json:"dbPostgresVersion,omitempty"`
	DbEnablePooler    bool   `json:"dbEnablePooler,omitempty"`
	DbNamespace       string `json:"dbNamespace,omitempty"`
	// Cert-TLS
	CertIssuer string `json:"certIssuer,omitempty"`
}

// ParseOverlayConfig reconstructs an OverlayConfig from kustomization.yaml and
// patch-xtenant-app.yaml bytes as generated by GenerateOverlayFiles.
// patchYAML may be nil (e.g. if the file has no replicas/resources set).
func ParseOverlayConfig(kustYAML, patchYAML []byte) (*OverlayConfig, error) {
	out := &OverlayConfig{}

	// --- patch-xtenant-app.yaml → replicas, resources ---
	if len(patchYAML) > 0 {
		var p XTenantApp
		if err := yaml.Unmarshal(patchYAML, &p); err == nil {
			out.Replicas = p.Spec.Parameters.Replicas
			if p.Spec.Parameters.Resources != nil {
				out.Resources = p.Spec.Parameters.Resources
			}
		}
	}

	// --- kustomization.yaml → inline JSON 6902 patches ---
	if len(kustYAML) == 0 {
		return out, nil
	}

	var kust struct {
		Patches []struct {
			Path   string `yaml:"path"`
			Patch  string `yaml:"patch"`
			Target *struct {
				Kind string `yaml:"kind"`
				Name string `yaml:"name"`
			} `yaml:"target"`
		} `yaml:"patches"`
	}
	if err := yaml.Unmarshal(kustYAML, &kust); err != nil {
		return out, nil // return what we have rather than hard-fail
	}

	type patchOp struct {
		Op    string      `yaml:"op"`
		Path  string      `yaml:"path"`
		Value interface{} `yaml:"value"`
	}

	for _, entry := range kust.Patches {
		if entry.Patch == "" || entry.Target == nil {
			continue
		}
		var ops []patchOp
		if err := yaml.Unmarshal([]byte(entry.Patch), &ops); err != nil {
			continue
		}
		for _, op := range ops {
			switch entry.Target.Kind {
			case "XTenantApp":
				switch op.Path {
				case "/spec/parameters/ingress/host":
					out.IngressHost = fmt.Sprintf("%v", op.Value)
				case "/spec/parameters/ingress/tls/clusterIssuer":
					out.CertIssuer = fmt.Sprintf("%v", op.Value)
				}
			case "XTenantDatabase":
				switch op.Path {
				case "/spec/parameters/dbName":
					out.DbName = fmt.Sprintf("%v", op.Value)
				case "/spec/parameters/tier":
					out.DbTier = fmt.Sprintf("%v", op.Value)
				case "/spec/parameters/environment":
					out.DbEnvironment = fmt.Sprintf("%v", op.Value)
				case "/spec/parameters/clusterRef":
					out.DbClusterRef = fmt.Sprintf("%v", op.Value)
				case "/spec/parameters/clusterNamespace":
					out.DbClusterNamespace = fmt.Sprintf("%v", op.Value)
				case "/spec/parameters/dedicatedCluster":
					if m, ok := op.Value.(map[string]interface{}); ok {
						if v, ok := m["instances"]; ok {
							if n, ok := v.(int); ok {
								out.DbInstances = int32(n)
							}
						}
						if v, ok := m["storageSize"]; ok {
							out.DbStorageSize = fmt.Sprintf("%v", v)
						}
						if v, ok := m["postgresVersion"]; ok {
							if n, ok := v.(int); ok {
								out.DbPostgresVersion = n
							}
						}
						if v, ok := m["enablePooler"]; ok {
							if b, ok := v.(bool); ok {
								out.DbEnablePooler = b
							}
						}
						if v, ok := m["namespace"]; ok {
							if s := fmt.Sprintf("%v", v); s != "<nil>" {
								out.DbNamespace = s
							}
						}
					}
				}
			}
		}
	}

	return out, nil
}
