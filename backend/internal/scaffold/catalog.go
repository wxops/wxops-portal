package scaffold

import (
	"fmt"
	"time"

	"github.com/wxops/wxops-portal-v2/internal/catalog"
	"gopkg.in/yaml.v3"
)

// CatalogEntityPair bundles a marshalled catalog entity with its
// destination path relative to the catalog root directory.
type CatalogEntityPair struct {
	Kind string
	Name string
	Path string // relative, e.g. "rocket-team/components/payment-api.yaml"
	YAML []byte
}

// GenerateCatalogEntities produces Backstage-compatible catalog entities
// for a newly scaffolded project based on the toggles enabled in the request.
//
// Always: Component entity.
// Vault toggle:    Resource entity (type: vault)    + dependsOn in Component.
// Database toggle: Resource entity (type: database) + dependsOn in Component.
// API toggle:      API entity (type: openapi/etc.)  + providesApis in Component.
// CreateSystem:    System entity.
func GenerateCatalogEntities(req *CreateProjectRequest, giteaURL string) []CatalogEntityPair {
	var pairs []CatalogEntityPair
	repoURL := fmt.Sprintf("%s/%s/%s", giteaURL, req.Team, req.AppName)

	// ── Collect relationship refs before building the Component ──────────
	var dependsOn []string
	var providesApis []string

	// Vault → Resource
	if req.VaultSecrets {
		resName := req.AppName + "-vault"
		dependsOn = append(dependsOn, fmt.Sprintf("resource:default/%s", resName))

		res := catalog.Entity{
			APIVersion: "backstage.io/v1alpha1",
			Kind:       "Resource",
			Metadata: catalog.EntityMetadata{
				Name:        resName,
				Description: fmt.Sprintf("Vault secrets for %s (path: %s/%s/env)", req.AppName, req.Team, req.AppName),
				Annotations: map[string]string{
					"wxops.cloud/vault-path": fmt.Sprintf("%s/%s/env", req.Team, req.AppName),
				},
			},
			Spec: catalog.EntitySpec{
				Type:      "vault",
				Lifecycle: "experimental",
				Owner:     "group:" + req.Team,
				System:    systemRef(req),
			},
		}
		resYAML, _ := yaml.Marshal(&res)
		pairs = append(pairs, CatalogEntityPair{
			Kind: "Resource",
			Name: resName,
			Path: fmt.Sprintf("%s/resources/%s.yaml", req.Team, resName),
			YAML: resYAML,
		})
	}

	// Database → Resource
	if req.DatabaseSecrets {
		dbName := ResolveDbName(req.AppName, "")
		resName := dbName
		dependsOn = append(dependsOn, fmt.Sprintf("resource:default/%s", resName))

		res := catalog.Entity{
			APIVersion: "backstage.io/v1alpha1",
			Kind:       "Resource",
			Metadata: catalog.EntityMetadata{
				Name:        resName,
				Description: fmt.Sprintf("PostgreSQL database for %s", req.AppName),
				Annotations: map[string]string{
					"crossplane/claim-name": fmt.Sprintf("%s-%s", req.Team, dbName),
				},
			},
			Spec: catalog.EntitySpec{
				Type:      "database",
				Lifecycle: "experimental",
				Owner:     "group:" + req.Team,
				System:    systemRef(req),
			},
		}
		resYAML, _ := yaml.Marshal(&res)
		pairs = append(pairs, CatalogEntityPair{
			Kind: "Resource",
			Name: resName,
			Path: fmt.Sprintf("%s/resources/%s.yaml", req.Team, resName),
			YAML: resYAML,
		})
	}

	// API toggle → API entity
	if req.APIEnabled {
		apiName := req.AppName + "-api"
		apiType := req.APIType
		if apiType == "" {
			apiType = "openapi"
		}
		providesApis = append(providesApis, fmt.Sprintf("api:default/%s", apiName))

		api := catalog.Entity{
			APIVersion: "backstage.io/v1alpha1",
			Kind:       "API",
			Metadata: catalog.EntityMetadata{
				Name:        apiName,
				Title:       fmt.Sprintf("%s API", req.AppName),
				Description: fmt.Sprintf("API exposed by %s", req.AppName),
			},
			Spec: catalog.EntitySpec{
				Type:      apiType,
				Lifecycle: "experimental",
				Owner:     "group:" + req.Team,
				System:    systemRef(req),
			},
		}

		// Add OpenAPI spec link if path provided.
		if req.OpenAPIPath != "" {
			api.Metadata.Links = []catalog.EntityLink{
				{
					URL:   req.OpenAPIPath,
					Title: "OpenAPI Spec",
					Type:  "openapi",
					Icon:  "api",
				},
			}
		}

		apiYAML, _ := yaml.Marshal(&api)
		pairs = append(pairs, CatalogEntityPair{
			Kind: "API",
			Name: apiName,
			Path: fmt.Sprintf("%s/apis/%s.yaml", req.Team, apiName),
			YAML: apiYAML,
		})
	}

	// ── Component (always generated) ────────────────────────────────────
	component := catalog.Entity{
		APIVersion: "backstage.io/v1alpha1",
		Kind:       "Component",
		Metadata: catalog.EntityMetadata{
			Name:        req.AppName,
			Title:       req.AppName,
			Description: req.Description,
			Annotations: func() map[string]string {
				a := map[string]string{
					"gitea/source-location":    req.Team + "/" + req.AppName,
					"wxops.cloud/template-id":  req.TemplateID,
					"wxops.cloud/scaffold-date": time.Now().UTC().Format(time.RFC3339),
				}
				if req.IngressEnabled {
					a["wxops.cloud/ingress"] = "true"
				}
				if req.CertManager {
					a["wxops.cloud/cert-manager"] = "true"
				}
				if req.DatabaseSecrets {
					dbName := ResolveDbName(req.AppName, "")
					a["wxops.cloud/database-name"] = dbName
				}
				return a
			}(),
			Links: []catalog.EntityLink{
				{
					URL:   repoURL,
					Title: "Repository",
					Type:  "repository",
					Icon:  "docs",
				},
			},
		},
		Spec: catalog.EntitySpec{
			Type:         "service",
			Lifecycle:    "experimental",
			Owner:        "group:" + req.Team,
			System:       systemRef(req),
			DependsOn:    dependsOn,
			ProvidesApis: providesApis,
		},
	}

	if req.AppFlavor != "" {
		if component.Metadata.Labels == nil {
			component.Metadata.Labels = make(map[string]string)
		}
		component.Metadata.Labels["wxops.cloud/app-flavor"] = req.AppFlavor
	}

	compYAML, _ := yaml.Marshal(&component)
	pairs = append(pairs, CatalogEntityPair{
		Kind: "Component",
		Name: req.AppName,
		Path: fmt.Sprintf("%s/components/%s.yaml", req.Team, req.AppName),
		YAML: compYAML,
	})

	// ── System ──────────────────────────────────────────────────────────
	// If systemName is provided, the developer picked an existing system —
	// just reference it (Component.spec.system is already set via systemRef).
	// If empty, create a new System entity with name = appName.
	if req.SystemName == "" {
		system := catalog.Entity{
			APIVersion: "backstage.io/v1alpha1",
			Kind:       "System",
			Metadata: catalog.EntityMetadata{
				Name:        req.AppName,
				Description: fmt.Sprintf("System for %s", req.AppName),
			},
			Spec: catalog.EntitySpec{
				Owner:  "group:" + req.Team,
				Domain: req.Domain,
			},
		}
		sysYAML, _ := yaml.Marshal(&system)
		pairs = append(pairs, CatalogEntityPair{
			Kind: "System",
			Name: req.AppName,
			Path: fmt.Sprintf("%s/systems/%s.yaml", req.Team, req.AppName),
			YAML: sysYAML,
		})
	}

	return pairs
}

func systemRef(req *CreateProjectRequest) string {
	if req.SystemName != "" {
		return req.SystemName
	}
	return req.AppName
}
