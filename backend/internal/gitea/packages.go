package gitea

import (
	"context"
	"encoding/json"
	"strings"
)

// Package represents a single dependency.
type Package struct {
	Ecosystem string `json:"ecosystem"`
	Name      string `json:"name"`
	Version   string `json:"version"`
	Direct    bool   `json:"direct"`
	Dev       bool   `json:"dev"`
}

// PackageManifest groups packages from a single manifest file.
type PackageManifest struct {
	Ecosystem string    `json:"ecosystem"`
	File      string    `json:"file"`
	Packages  []Package `json:"packages"`
}

type depFile struct {
	path      string
	ecosystem string
	parser    func([]byte) []Package
}

var knownDepFiles = []depFile{
	{"go.mod", "go", ParseGoMod},
	{"package.json", "node", ParsePackageJSON},
	{"requirements.txt", "python", ParseRequirementsTxt},
	{"pyproject.toml", "python", ParsePyprojectToml},
}

// DiscoverPackages reads dependency files from a repo and parses them.
// It searches the root directory and one level of subdirectories (e.g. api/, frontend/).
func DiscoverPackages(ctx context.Context, c *Client, owner, repo string) ([]PackageManifest, error) {
	var manifests []PackageManifest

	// Search root
	manifests = discoverInDir(ctx, c, owner, repo, "", manifests)

	// Search 1 level deep
	dirs, err := c.ListRepoDirs(ctx, owner, repo, "")
	if err == nil {
		for _, dir := range dirs {
			if isSkippedDir(dir) {
				continue
			}
			manifests = discoverInDir(ctx, c, owner, repo, dir, manifests)
		}
	}

	return manifests, nil
}

func discoverInDir(ctx context.Context, c *Client, owner, repo, dir string, manifests []PackageManifest) []PackageManifest {
	for _, f := range knownDepFiles {
		filePath := f.path
		displayPath := f.path
		if dir != "" {
			filePath = dir + "/" + f.path
			displayPath = filePath
		}

		data, err := c.GetRepoFile(ctx, owner, repo, filePath)
		if err != nil {
			continue
		}
		pkgs := f.parser(data)
		if len(pkgs) == 0 {
			continue
		}
		if len(pkgs) > 200 {
			pkgs = pkgs[:200]
		}
		manifests = append(manifests, PackageManifest{
			Ecosystem: f.ecosystem,
			File:      displayPath,
			Packages:  pkgs,
		})
	}
	return manifests
}

func isSkippedDir(name string) bool {
	skip := map[string]bool{
		"vendor": true, "node_modules": true, ".git": true,
		".github": true, ".gitea": true, "dist": true, "build": true,
		"__pycache__": true, ".venv": true, "venv": true,
	}
	return skip[name]
}

// ParseGoMod extracts dependencies from a go.mod file.
func ParseGoMod(data []byte) []Package {
	var pkgs []Package
	lines := strings.Split(string(data), "\n")
	inRequire := false

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		if trimmed == "require (" {
			inRequire = true
			continue
		}
		if trimmed == ")" {
			inRequire = false
			continue
		}

		if inRequire {
			indirect := strings.Contains(trimmed, "// indirect")
			trimmed = strings.Split(trimmed, "//")[0]
			trimmed = strings.TrimSpace(trimmed)
			parts := strings.Fields(trimmed)
			if len(parts) >= 2 {
				pkgs = append(pkgs, Package{
					Ecosystem: "go",
					Name:      parts[0],
					Version:   parts[1],
					Direct:    !indirect,
				})
			}
		}

		// Single-line require: require module version
		if strings.HasPrefix(trimmed, "require ") && !strings.Contains(trimmed, "(") {
			rest := strings.TrimPrefix(trimmed, "require ")
			parts := strings.Fields(rest)
			if len(parts) >= 2 {
				pkgs = append(pkgs, Package{
					Ecosystem: "go",
					Name:      parts[0],
					Version:   parts[1],
					Direct:    true,
				})
			}
		}
	}
	return pkgs
}

// ParsePackageJSON extracts dependencies from a package.json file.
func ParsePackageJSON(data []byte) []Package {
	var pkg struct {
		Dependencies    map[string]string `json:"dependencies"`
		DevDependencies map[string]string `json:"devDependencies"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return nil
	}

	var pkgs []Package
	for name, version := range pkg.Dependencies {
		pkgs = append(pkgs, Package{
			Ecosystem: "node",
			Name:      name,
			Version:   version,
			Direct:    true,
		})
	}
	for name, version := range pkg.DevDependencies {
		pkgs = append(pkgs, Package{
			Ecosystem: "node",
			Name:      name,
			Version:   version,
			Direct:    true,
			Dev:       true,
		})
	}
	return pkgs
}

// ParseRequirementsTxt extracts dependencies from a requirements.txt file.
func ParseRequirementsTxt(data []byte) []Package {
	var pkgs []Package
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "-") {
			continue
		}

		// Split on version specifiers
		for _, sep := range []string{"==", ">=", "<=", "~=", "!="} {
			if idx := strings.Index(trimmed, sep); idx > 0 {
				pkgs = append(pkgs, Package{
					Ecosystem: "python",
					Name:      strings.TrimSpace(trimmed[:idx]),
					Version:   strings.TrimSpace(trimmed[idx+len(sep):]),
					Direct:    true,
				})
				goto next
			}
		}
		// No version specifier — just the package name
		pkgs = append(pkgs, Package{
			Ecosystem: "python",
			Name:      trimmed,
			Version:   "*",
			Direct:    true,
		})
	next:
	}
	return pkgs
}

// ParsePyprojectToml extracts dependencies from a pyproject.toml file.
func ParsePyprojectToml(data []byte) []Package {
	var pkgs []Package
	lines := strings.Split(string(data), "\n")
	inDeps := false

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		if trimmed == "[project.dependencies]" || trimmed == "dependencies = [" {
			inDeps = true
			continue
		}
		if inDeps && (strings.HasPrefix(trimmed, "[") || trimmed == "]") {
			inDeps = false
			continue
		}

		if inDeps {
			// Remove quotes and commas: "fastapi>=0.100" or 'requests==2.31.0',
			dep := strings.Trim(trimmed, `"',`)
			dep = strings.TrimSpace(dep)
			if dep == "" {
				continue
			}

			for _, sep := range []string{">=", "==", "<=", "~=", "!="} {
				if idx := strings.Index(dep, sep); idx > 0 {
					pkgs = append(pkgs, Package{
						Ecosystem: "python",
						Name:      strings.TrimSpace(dep[:idx]),
						Version:   strings.TrimSpace(dep[idx+len(sep):]),
						Direct:    true,
					})
					goto nextLine
				}
			}
			pkgs = append(pkgs, Package{
				Ecosystem: "python",
				Name:      dep,
				Version:   "*",
				Direct:    true,
			})
		nextLine:
		}
	}
	return pkgs
}
