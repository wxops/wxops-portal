// Package catalog implements a service catalog backed by a central Gitea
// repository containing Backstage-compatible catalog-info.yaml entity files.
//
// The entity schema follows the Backstage catalog specification
// (https://backstage.io/docs/features/software-catalog/descriptor-format) so
// that:
//   - Teams can look up Backstage documentation to understand how to write
//     catalog-info.yaml without reading internal docs.
//   - Entities are portable — a future Backstage instance can consume them
//     without migration.
//   - The Go backend parses the YAML into typed structs; no Backstage runtime
//     is involved.
//
// Supported kinds: Component, API, System, Group, Resource, User.
package catalog

import "fmt"

// Entity is the top-level structure of a catalog-info.yaml file.
// It matches the Backstage envelope schema.
type Entity struct {
	APIVersion string         `yaml:"apiVersion" json:"apiVersion"` // "backstage.io/v1alpha1"
	Kind       string         `yaml:"kind"       json:"kind"`       // Component | API | System | Group | Resource | User
	Metadata   EntityMetadata `yaml:"metadata"   json:"metadata"`
	Spec       EntitySpec     `yaml:"spec"       json:"spec"`
}

// EntityMetadata holds fields common to every entity kind.
type EntityMetadata struct {
	// Name is the unique identifier within the entity's kind and namespace.
	// Used in API paths: /catalog/entities/Component/payments-service
	Name      string `yaml:"name"      json:"name"`
	Namespace string `yaml:"namespace" json:"namespace"` // defaults to "default"

	Title       string `yaml:"title,omitempty"       json:"title,omitempty"`
	Description string `yaml:"description,omitempty" json:"description,omitempty"`

	// Labels are free-form key/value pairs for filtering.
	Labels map[string]string `yaml:"labels,omitempty" json:"labels,omitempty"`

	// Annotations carry tool-specific metadata.
	// Example: "gitea/source-location": "platform/payments-service"
	Annotations map[string]string `yaml:"annotations,omitempty" json:"annotations,omitempty"`

	Tags  []string     `yaml:"tags,omitempty"  json:"tags,omitempty"`
	Links []EntityLink `yaml:"links,omitempty" json:"links,omitempty"`
}

// EntityLink is a human-readable link shown on the entity detail page.
type EntityLink struct {
	URL   string `yaml:"url"             json:"url"`
	Title string `yaml:"title,omitempty" json:"title,omitempty"`
	// Icon is a hint to the frontend (docs | dashboard | api | runbook | alert).
	Icon string `yaml:"icon,omitempty" json:"icon,omitempty"`
	Type string `yaml:"type,omitempty" json:"type,omitempty"`
}

// EntitySpec holds kind-specific fields.
// All spec fields are optional at the struct level; validation is enforced
// per kind in Validate().
type EntitySpec struct {
	// ── Common across most kinds ─────────────────────────────────────────
	// Owner is a group or user reference: "group:platform-team", "user:alice"
	Owner string `yaml:"owner,omitempty" json:"owner,omitempty"`

	// Lifecycle is the maturity stage: experimental | production | deprecated
	Lifecycle string `yaml:"lifecycle,omitempty" json:"lifecycle,omitempty"`

	// ── Component ────────────────────────────────────────────────────────
	// Type classifies the component: service | website | library | pipeline | documentation
	Type string `yaml:"type,omitempty" json:"type,omitempty"`

	// System groups related components under a named system.
	System string `yaml:"system,omitempty" json:"system,omitempty"`

	// DependsOn lists component or resource refs this entity depends on.
	// Format: "component:default/user-service", "resource:default/payments-db"
	DependsOn []string `yaml:"dependsOn,omitempty" json:"dependsOn,omitempty"`

	// ProvidesApis lists API entity refs exposed by this component.
	ProvidesApis []string `yaml:"providesApis,omitempty" json:"providesApis,omitempty"`

	// ConsumesApis lists API entity refs consumed by this component.
	ConsumesApis []string `yaml:"consumesApis,omitempty" json:"consumesApis,omitempty"`

	// ── API ──────────────────────────────────────────────────────────────
	// Definition holds the raw API spec (OpenAPI YAML, AsyncAPI, etc.)
	// Typically left empty here and fetched from the repo link instead.
	Definition string `yaml:"definition,omitempty" json:"definition,omitempty"`

	// ── System ───────────────────────────────────────────────────────────
	Domain string `yaml:"domain,omitempty" json:"domain,omitempty"`

	// ── Group ────────────────────────────────────────────────────────────
	// Parent is the parent group ref for nested org structures.
	Parent string `yaml:"parent,omitempty" json:"parent,omitempty"`
	// Children lists sub-group refs.
	Children []string `yaml:"children,omitempty" json:"children,omitempty"`
	// Members lists user refs that belong to this group.
	Members []string `yaml:"members,omitempty" json:"members,omitempty"`

	// ── Resource ─────────────────────────────────────────────────────────
	// (uses Type, Owner, System, DependsOn from above)
}

// Ref returns the canonical entity reference string used in relation fields:
// "kind:namespace/name" — e.g. "component:default/payments-service"
func (e *Entity) Ref() string {
	ns := e.Metadata.Namespace
	if ns == "" {
		ns = "default"
	}
	return e.Kind + ":" + ns + "/" + e.Metadata.Name
}

// Validate returns an error if required fields are missing for the entity's kind.
func (e *Entity) Validate() error {
	if e.Kind == "" {
		return errorf("entity missing kind")
	}
	if e.Metadata.Name == "" {
		return errorf("entity %q missing metadata.name", e.Kind)
	}
	switch e.Kind {
	case "Component", "API", "Resource":
		if e.Spec.Owner == "" {
			return errorf("%s %q missing spec.owner", e.Kind, e.Metadata.Name)
		}
		if e.Spec.Lifecycle == "" {
			return errorf("%s %q missing spec.lifecycle", e.Kind, e.Metadata.Name)
		}
		if e.Spec.Type == "" {
			return errorf("%s %q missing spec.type", e.Kind, e.Metadata.Name)
		}
	case "System":
		if e.Spec.Owner == "" {
			return errorf("System %q missing spec.owner", e.Metadata.Name)
		}
	case "Group":
		if e.Spec.Type == "" {
			return errorf("Group %q missing spec.type", e.Metadata.Name)
		}
	}
	return nil
}

func errorf(format string, args ...any) error {
	return fmt.Errorf(format, args...)
}
