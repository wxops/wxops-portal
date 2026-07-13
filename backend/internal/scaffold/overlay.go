package scaffold

import (
	"fmt"
	"strconv"
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
	// Darlane — top-level flag + full sub-config for pre-filling the reconfigure wizard.
	DarlaneEnabled          bool     `json:"darlaneEnabled,omitempty"`
	DarlaneReplicas         *int32   `json:"darlaneReplicas,omitempty"`
	DarlaneTTL              string   `json:"darlaneTTL,omitempty"`
	DarlaneCommand          []string `json:"darlaneCommand,omitempty"`
	DarlaneFileSync         bool     `json:"darlaneFileSync,omitempty"`
	DarlaneMountPath        string   `json:"darlaneMountPath,omitempty"`
	DarlaneInitFromImage    string   `json:"darlaneInitFromImage,omitempty"`
	DarlaneCpuReq           string   `json:"darlaneCpuReq,omitempty"`
	DarlaneCpuLim           string   `json:"darlaneCpuLim,omitempty"`
	DarlaneMemReq           string   `json:"darlaneMemReq,omitempty"`
	DarlaneMemLim           string   `json:"darlaneMemLim,omitempty"`
	DarlaneEnvVars          []EnvVar `json:"darlaneEnvVars,omitempty"`
	DarlaneTrafficWeight    *int32   `json:"darlaneTrafficWeight,omitempty"`
	DarlaneStickySession    bool     `json:"darlaneStickySession,omitempty"`
	DarlaneCookieName       string   `json:"darlaneCookieName,omitempty"`
	DarlaneSameSite         string   `json:"darlaneSameSite,omitempty"`
	DarlaneSecure           bool     `json:"darlaneSecure,omitempty"`
	DarlaneHeaderRoutingEnabled bool   `json:"darlaneHeaderRoutingEnabled,omitempty"`
	DarlaneHeaderRoutingHeader  string `json:"darlaneHeaderRoutingHeader,omitempty"`
	DarlaneHeaderRoutingValue   string `json:"darlaneHeaderRoutingValue,omitempty"`
	DarlaneContainerPort        *int32 `json:"darlaneContainerPort,omitempty"`
	DarlaneTelemetryPort        *int32 `json:"darlaneTelemetryPort,omitempty"`
	DarlaneProductionOverride   bool   `json:"darlaneProductionOverride,omitempty"`
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
				case "/spec/parameters/darlane":
					out.DarlaneEnabled = true
					if m, ok := op.Value.(map[string]interface{}); ok {
						parseDarlaneIntoConfig(out, m)
					}
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

// parseDarlaneIntoConfig extracts Darlane sub-fields from a parsed YAML value
// map and writes them into cfg for pre-filling the reconfigure wizard.
func parseDarlaneIntoConfig(cfg *OverlayConfig, m map[string]interface{}) {
	if v, ok := m["replicas"]; ok {
		if n, ok := v.(int); ok {
			n32 := int32(n)
			cfg.DarlaneReplicas = &n32
		}
	}
	if v, ok := m["ttl"]; ok {
		cfg.DarlaneTTL = fmt.Sprintf("%v", v)
	}
	if v, ok := m["command"]; ok {
		if cmds, ok := v.([]interface{}); ok {
			for _, c := range cmds {
				cfg.DarlaneCommand = append(cfg.DarlaneCommand, fmt.Sprintf("%v", c))
			}
		}
	}
	if v, ok := m["fileSync"]; ok {
		if fs, ok := v.(map[string]interface{}); ok {
			if enabled, ok := fs["enabled"].(bool); ok && enabled {
				cfg.DarlaneFileSync = true
				if mp, ok := fs["mountPath"]; ok {
					cfg.DarlaneMountPath = fmt.Sprintf("%v", mp)
				}
				if img, ok := fs["initFromImage"]; ok {
					cfg.DarlaneInitFromImage = fmt.Sprintf("%v", img)
				}
			}
		}
	}
	if v, ok := m["resources"]; ok {
		if res, ok := v.(map[string]interface{}); ok {
			if reqs, ok := res["requests"].(map[string]interface{}); ok {
				if cpu, ok := reqs["cpu"]; ok {
					cfg.DarlaneCpuReq = fmt.Sprintf("%v", cpu)
				}
				if mem, ok := reqs["memory"]; ok {
					cfg.DarlaneMemReq = fmt.Sprintf("%v", mem)
				}
			}
			if lims, ok := res["limits"].(map[string]interface{}); ok {
				if cpu, ok := lims["cpu"]; ok {
					cfg.DarlaneCpuLim = fmt.Sprintf("%v", cpu)
				}
				if mem, ok := lims["memory"]; ok {
					cfg.DarlaneMemLim = fmt.Sprintf("%v", mem)
				}
			}
		}
	}
	if v, ok := m["env"]; ok {
		if envList, ok := v.([]interface{}); ok {
			for _, item := range envList {
				if entry, ok := item.(map[string]interface{}); ok {
					ev := EnvVar{}
					if n, ok := entry["name"]; ok {
						ev.Name = fmt.Sprintf("%v", n)
					}
					if val, ok := entry["value"]; ok {
						ev.Value = fmt.Sprintf("%v", val)
					}
					if ev.Name != "" {
						cfg.DarlaneEnvVars = append(cfg.DarlaneEnvVars, ev)
					}
				}
			}
		}
	}
	if v, ok := m["trafficWeight"]; ok {
		if n, ok := v.(int); ok {
			n32 := int32(n)
			cfg.DarlaneTrafficWeight = &n32
		}
	}
	if v, ok := m["stickySession"]; ok {
		if ss, ok := v.(map[string]interface{}); ok {
			if enabled, ok := ss["enabled"].(bool); ok && enabled {
				cfg.DarlaneStickySession = true
				if cn, ok := ss["cookieName"]; ok {
					cfg.DarlaneCookieName = fmt.Sprintf("%v", cn)
				}
				if sec, ok := ss["secure"].(bool); ok {
					cfg.DarlaneSecure = sec
				}
				if sms, ok := ss["sameSite"]; ok {
					cfg.DarlaneSameSite = fmt.Sprintf("%v", sms)
				}
			}
		}
	}
	if v, ok := m["headerRouting"]; ok {
		if hr, ok := v.(map[string]interface{}); ok {
			if enabled, ok := hr["enabled"].(bool); ok && enabled {
				cfg.DarlaneHeaderRoutingEnabled = true
				if h, ok := hr["header"]; ok {
					cfg.DarlaneHeaderRoutingHeader = fmt.Sprintf("%v", h)
				}
				if val, ok := hr["value"]; ok {
					cfg.DarlaneHeaderRoutingValue = fmt.Sprintf("%v", val)
				}
			}
		}
	}
	if v, ok := m["containerPort"]; ok {
		if n, ok := v.(int); ok {
			n32 := int32(n)
			cfg.DarlaneContainerPort = &n32
		}
	}
	if v, ok := m["telemetryPort"]; ok {
		if n, ok := v.(int); ok {
			n32 := int32(n)
			cfg.DarlaneTelemetryPort = &n32
		}
	}
	if v, ok := m["productionOverride"]; ok {
		if b, ok := v.(bool); ok {
			cfg.DarlaneProductionOverride = b
		}
	}
}

// BuildDarlanePatch returns an inline JSON 6902 patch string that adds the
// darlane block at /spec/parameters/darlane on the named XTenantApp XR.
func BuildDarlanePatch(ds *DarlaneSpec, xrName string) string {
	var lines []string
	lines = append(lines, "    enabled: true")
	if ds.Replicas != nil {
		lines = append(lines, fmt.Sprintf("    replicas: %d", *ds.Replicas))
	}
	if ds.TTL != "" {
		lines = append(lines, fmt.Sprintf("    ttl: %s", ds.TTL))
	}
	if len(ds.Command) > 0 {
		lines = append(lines, "    command:")
		for _, token := range ds.Command {
			// Bare integers (e.g. port numbers) are parsed as int by YAML but K8s
			// container command arrays require []string — single-quote them.
			if _, err := strconv.Atoi(token); err == nil {
				lines = append(lines, fmt.Sprintf("    - '%s'", token))
			} else {
				lines = append(lines, fmt.Sprintf("    - %s", token))
			}
		}
	}
	if ds.FileSync != nil && ds.FileSync.Enabled {
		lines = append(lines, "    fileSync:")
		lines = append(lines, "      enabled: true")
		if ds.FileSync.MountPath != "" {
			lines = append(lines, fmt.Sprintf("      mountPath: %s", ds.FileSync.MountPath))
		}
		if ds.FileSync.InitFromImage != "" {
			lines = append(lines, fmt.Sprintf("      initFromImage: %s", ds.FileSync.InitFromImage))
		} else {
			lines = append(lines, "      initFromImage: false")
		}
	}
	if ds.Resources != nil {
		lines = append(lines, "    resources:")
		if ds.Resources.Requests != nil && (ds.Resources.Requests.CPU != "" || ds.Resources.Requests.Memory != "") {
			lines = append(lines, "      requests:")
			if ds.Resources.Requests.CPU != "" {
				lines = append(lines, fmt.Sprintf("        cpu: %s", ds.Resources.Requests.CPU))
			}
			if ds.Resources.Requests.Memory != "" {
				lines = append(lines, fmt.Sprintf("        memory: %s", ds.Resources.Requests.Memory))
			}
		}
		if ds.Resources.Limits != nil && (ds.Resources.Limits.CPU != "" || ds.Resources.Limits.Memory != "") {
			lines = append(lines, "      limits:")
			if ds.Resources.Limits.CPU != "" {
				lines = append(lines, fmt.Sprintf("        cpu: %s", ds.Resources.Limits.CPU))
			}
			if ds.Resources.Limits.Memory != "" {
				lines = append(lines, fmt.Sprintf("        memory: %s", ds.Resources.Limits.Memory))
			}
		}
	}
	if len(ds.Env) > 0 {
		lines = append(lines, "    env:")
		for _, e := range ds.Env {
			lines = append(lines, fmt.Sprintf("    - name: %s", e.Name))
			lines = append(lines, fmt.Sprintf("      value: %q", e.Value))
		}
	}
	if ds.TrafficWeight != nil {
		lines = append(lines, fmt.Sprintf("    trafficWeight: %d", *ds.TrafficWeight))
	}
	if ds.StickySession != nil && ds.StickySession.Enabled {
		lines = append(lines, "    stickySession:")
		lines = append(lines, "      enabled: true")
		if ds.StickySession.CookieName != "" {
			lines = append(lines, fmt.Sprintf("      cookieName: %s", ds.StickySession.CookieName))
		}
		if ds.StickySession.Secure {
			lines = append(lines, "      secure: true")
		}
		if ds.StickySession.SameSite != "" {
			lines = append(lines, fmt.Sprintf("      sameSite: %s", ds.StickySession.SameSite))
		}
	}
	if ds.HeaderRouting != nil && ds.HeaderRouting.Enabled {
		lines = append(lines, "    headerRouting:")
		lines = append(lines, "      enabled: true")
		if ds.HeaderRouting.Header != "" {
			lines = append(lines, fmt.Sprintf("      header: %s", ds.HeaderRouting.Header))
		}
		if ds.HeaderRouting.Value != "" {
			lines = append(lines, fmt.Sprintf("      value: %s", ds.HeaderRouting.Value))
		}
	}
	if ds.ContainerPort != nil {
		lines = append(lines, fmt.Sprintf("    containerPort: %d", *ds.ContainerPort))
	}
	if ds.TelemetryPort != nil {
		lines = append(lines, fmt.Sprintf("    telemetryPort: %d", *ds.TelemetryPort))
	}
	if ds.ProductionOverride {
		lines = append(lines, "    productionOverride: true")
	}
	_ = xrName // xrName is used by the caller in the PatchRef target, not in the patch body
	return fmt.Sprintf("- op: add\n  path: /spec/parameters/darlane\n  value:\n%s",
		strings.Join(lines, "\n"))
}

// InjectDarlanePatch reads an existing overlay kustomization.yaml, removes any
// previous darlane patch targeting XTenantApp, and appends the new one.
func InjectDarlanePatch(kustYAML []byte, darlanePatch string, xrName string) ([]byte, error) {
	var kust OverlayKustomization
	if err := yaml.Unmarshal(kustYAML, &kust); err != nil {
		return nil, fmt.Errorf("parse kustomization: %w", err)
	}
	// Drop any existing darlane patch on XTenantApp to avoid duplicates on reconfigure.
	out := kust.Patches[:0]
	for _, p := range kust.Patches {
		if p.Target != nil && p.Target.Kind == "XTenantApp" && strings.Contains(p.Patch, "/spec/parameters/darlane") {
			continue
		}
		out = append(out, p)
	}
	out = append(out, PatchRef{
		Patch:  darlanePatch,
		Target: &PatchTarget{Kind: "XTenantApp", Name: xrName},
	})
	kust.Patches = out
	return yaml.Marshal(&kust)
}

// RemoveDarlanePatch strips the darlane patch from an overlay kustomization.yaml.
func RemoveDarlanePatch(kustYAML []byte) ([]byte, error) {
	var kust OverlayKustomization
	if err := yaml.Unmarshal(kustYAML, &kust); err != nil {
		return nil, fmt.Errorf("parse kustomization: %w", err)
	}
	out := kust.Patches[:0]
	for _, p := range kust.Patches {
		if p.Target != nil && p.Target.Kind == "XTenantApp" && strings.Contains(p.Patch, "/spec/parameters/darlane") {
			continue
		}
		out = append(out, p)
	}
	kust.Patches = out
	return yaml.Marshal(&kust)
}
