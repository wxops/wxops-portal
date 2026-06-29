package scaffold

import (
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// ImageUpdater represents an ArgoCD Image Updater v1.x ImageUpdater CR.
// It is deployed to the argocd namespace and covers all three environments
// (dev/staging/production) for a single application.
//
// Tag conventions (set by the CI/CD pipeline via crane re-tag):
//
//	dev-{YYYY-MM-DD_HH-MM-SS}-{sha7}   ← CI build on develop
//	vX.Y.Z-rcN                          ← crane re-tag on staging merge
//	vX.Y.Z                              ← crane re-tag on production release
type ImageUpdater struct {
	APIVersion string           `yaml:"apiVersion"`
	Kind       string           `yaml:"kind"`
	Metadata   ResourceMeta     `yaml:"metadata"`
	Spec       ImageUpdaterSpec `yaml:"spec"`
}

type ImageUpdaterSpec struct {
	Namespace       string           `yaml:"namespace"`
	WriteBackConfig WriteBackConfig  `yaml:"writeBackConfig"`
	ApplicationRefs []ApplicationRef `yaml:"applicationRefs"`
}

type WriteBackConfig struct {
	Method    string    `yaml:"method"`
	GitConfig GitConfig `yaml:"gitConfig"`
}

type GitConfig struct {
	Branch     string `yaml:"branch"`
	Repository string `yaml:"repository"`
}

type ApplicationRef struct {
	NamePattern          string               `yaml:"namePattern"`
	CommonUpdateSettings CommonUpdateSettings `yaml:"commonUpdateSettings"`
	Images               []AppImage           `yaml:"images"`
}

type CommonUpdateSettings struct {
	UpdateStrategy string   `yaml:"updateStrategy"`
	PullSecret     string   `yaml:"pullSecret"`
	ForceUpdate    bool     `yaml:"forceUpdate"`
	AllowTags      string   `yaml:"allowTags,omitempty"`
	IgnoreTags     []string `yaml:"ignoreTags,omitempty"`
}

type AppImage struct {
	Alias           string          `yaml:"alias"`
	ImageName       string          `yaml:"imageName"`
	ManifestTargets ManifestTargets `yaml:"manifestTargets"`
}

type ManifestTargets struct {
	Kustomize KustomizeTarget `yaml:"kustomize"`
}

type KustomizeTarget struct {
	Name string `yaml:"name"`
}

// NewImageUpdater builds an ImageUpdater CR for the given project.
//
// gitopsRepoURL is the full HTTPS URL of the gitops-infra repository
// (e.g. https://gitea.example.com/platform-team/gitops-infra.git).
// It is used by the ArgoCD Image Updater write-back to commit the updated
// image tag back to the overlay directory.
func NewImageUpdater(req *CreateProjectRequest, giteaURL, gitopsRepoURL string) *ImageUpdater {
	registry := registryHost(giteaURL)
	imageBase := fmt.Sprintf("%s/%s/%s", registry, req.Team, req.AppName)

	// ArgoCD Application names follow the convention set by the ApplicationSet:
	// tenants-apps-{team}-{app}-{env}  (hyphens, all lowercase)
	appPrefix := fmt.Sprintf("tenants-apps-%s-%s", req.Team, req.AppName)

	return &ImageUpdater{
		APIVersion: "argocd-image-updater.argoproj.io/v1alpha1",
		Kind:       "ImageUpdater",
		Metadata: ResourceMeta{
			Name: req.AppName,
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": "wxops-portal",
				"wxops.cloud/team":             req.Team,
				"wxops.cloud/app":              req.AppName,
			},
		},
		Spec: ImageUpdaterSpec{
			Namespace: "argocd",
			WriteBackConfig: WriteBackConfig{
				Method: "git:secret:argocd/git-creds",
				GitConfig: GitConfig{
					Branch:     "main",
					Repository: gitopsRepoURL,
				},
			},
			ApplicationRefs: []ApplicationRef{
				{
					// Dev — newest-build strategy; tracks dev-* CI tags.
					NamePattern: appPrefix + "-dev",
					CommonUpdateSettings: CommonUpdateSettings{
						UpdateStrategy: "newest-build",
						PullSecret:     "pullsecret:argocd/regcred",
						ForceUpdate:    true,
						AllowTags:      "regexp:^dev-.*$",
						IgnoreTags:     []string{"latest", "cache"},
					},
					Images: []AppImage{
						{
							Alias:     "application",
							ImageName: imageBase,
							ManifestTargets: ManifestTargets{
								Kustomize: KustomizeTarget{Name: imageBase},
							},
						},
					},
				},
				{
					// Staging — semver RC strategy; tracks vX.Y.Z-rcN crane re-tags.
					NamePattern: appPrefix + "-staging",
					CommonUpdateSettings: CommonUpdateSettings{
						UpdateStrategy: "semver",
						PullSecret:     "pullsecret:argocd/regcred",
						ForceUpdate:    true,
						IgnoreTags:     []string{"latest", "cache"},
					},
					Images: []AppImage{
						{
							Alias:     "application",
							ImageName: imageBase + ":0.x-0",
							ManifestTargets: ManifestTargets{
								Kustomize: KustomizeTarget{Name: imageBase},
							},
						},
					},
				},
				{
					// Production — stable semver strategy; tracks vX.Y.Z crane re-tags.
					NamePattern: appPrefix + "-production",
					CommonUpdateSettings: CommonUpdateSettings{
						UpdateStrategy: "semver",
						PullSecret:     "pullsecret:argocd/regcred",
						ForceUpdate:    true,
						IgnoreTags:     []string{"latest", "cache"},
					},
					Images: []AppImage{
						{
							Alias:     "application",
							ImageName: imageBase,
							ManifestTargets: ManifestTargets{
								Kustomize: KustomizeTarget{Name: imageBase},
							},
						},
					},
				},
			},
		},
	}
}

// GitopsRepoURL builds the HTTPS clone URL for the gitops-infra repository.
func GitopsRepoURL(giteaURL, owner, repo string) string {
	base := strings.TrimRight(giteaURL, "/")
	return fmt.Sprintf("%s/%s/%s.git", base, owner, repo)
}

// Marshal serialises the ImageUpdater to YAML.
func (u *ImageUpdater) Marshal() ([]byte, error) {
	return yaml.Marshal(u)
}
