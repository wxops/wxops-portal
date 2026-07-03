package scaffold

import "gopkg.in/yaml.v3"

// Kustomization represents a minimal kustomization.yaml.
type Kustomization struct {
	APIVersion string   `yaml:"apiVersion"`
	Kind       string   `yaml:"kind"`
	Resources  []string `yaml:"resources"`
}

// OverlayKustomization is a full overlay kustomization.yaml with image-updater support.
// The images: list is intentionally absent — ArgoCD Image Updater owns that section
// and writes the current tag back to this file after each successful build.
type OverlayKustomization struct {
	APIVersion     string     `yaml:"apiVersion"`
	Kind           string     `yaml:"kind"`
	Resources      []string   `yaml:"resources"`
	Configurations []string   `yaml:"configurations"`
	Patches        []PatchRef `yaml:"patches,omitempty"`
}

// PatchRef points to a patch file or contains an inline JSON 6902 patch with a target selector.
type PatchRef struct {
	Path   string       `yaml:"path,omitempty"`
	Patch  string       `yaml:"patch,omitempty"`
	Target *PatchTarget `yaml:"target,omitempty"`
}

// PatchTarget selects the resource an inline patch applies to.
type PatchTarget struct {
	Kind string `yaml:"kind,omitempty"`
	Name string `yaml:"name,omitempty"`
}

// imageTransformerConfig is the content of image-transformer.yaml.
// It tells Kustomize where to find images in custom resources that are not
// standard Deployments/StatefulSets (e.g. XTenantApp CRD).
type imageTransformerConfig struct {
	Images []imageTransformerEntry `yaml:"images"`
}

type imageTransformerEntry struct {
	Path string `yaml:"path"`
	Kind string `yaml:"kind"`
}

// BuildBaseKustomization returns a kustomization.yaml listing all resource
// files in the base directory.
func BuildBaseKustomization(filenames []string) ([]byte, error) {
	k := Kustomization{
		APIVersion: "kustomize.config.k8s.io/v1beta1",
		Kind:       "Kustomization",
		Resources:  filenames,
	}
	return yaml.Marshal(&k)
}

// BuildOverlayFiles returns a map of filename → content for an overlay directory.
//
// Two files are produced:
//
//   - kustomization.yaml: references ../../base and declares the image-transformer
//     configuration. The images: list is deliberately absent — ArgoCD Image Updater
//     owns that section and writes image tags back to this file on every build.
//
//   - image-transformer.yaml: registers spec/parameters/image on XTenantApp as
//     a Kustomize-managed image path. Without this, Kustomize only knows how to
//     substitute images in standard Deployment/StatefulSet specs.
func BuildOverlayFiles() (map[string][]byte, error) {
	kust := OverlayKustomization{
		APIVersion:     "kustomize.config.k8s.io/v1beta1",
		Kind:           "Kustomization",
		Resources:      []string{"../../base"},
		Configurations: []string{"image-transformer.yaml"},
		Patches: []PatchRef{
			{Path: "patch-xtenant-app.yaml"},
		},
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
