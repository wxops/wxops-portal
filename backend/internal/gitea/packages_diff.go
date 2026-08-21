package gitea

import "sort"

// PackageBump is a package present in both sides of a comparison with a
// different version. Ecosystem and file are carried on the enclosing
// ManifestDiff, not repeated here.
type PackageBump struct {
	Name        string `json:"name"`
	FromVersion string `json:"fromVersion"`
	ToVersion   string `json:"toVersion"`
}

// ManifestDiff is the added/removed/bumped packages for a single manifest
// file. Base and head manifests are matched by (ecosystem, file) before
// anything inside them is compared — a monorepo with more than one manifest
// in the same ecosystem (e.g. a CLI's go.mod alongside a backend's go.mod)
// must never have a dependency from one silently collide with a
// same-named, differently-versioned dependency from the other.
type ManifestDiff struct {
	Ecosystem string        `json:"ecosystem"`
	File      string        `json:"file"`
	Added     []Package     `json:"added"`
	Removed   []Package     `json:"removed"`
	Bumped    []PackageBump `json:"bumped"`
	// BaseTruncated/HeadTruncated mirror PackageManifest.Truncated for
	// whichever side had this manifest. If either is true, packages past
	// that side's cutoff were invisible to the diff — the added/removed
	// counts above may not reflect the true change, since the two sides can
	// be truncated at different points (different total package counts).
	BaseTruncated bool `json:"baseTruncated"`
	HeadTruncated bool `json:"headTruncated"`
}

// PackageDiff is the result of comparing two sets of manifests, one entry
// per manifest that actually changed. It's a set diff, not a line diff —
// package lists have no meaningful "line order" to preserve, so the
// LCS-based diff already used elsewhere in this codebase (for config-YAML
// text) is the wrong tool here.
type PackageDiff struct {
	Manifests []ManifestDiff `json:"manifests"`
}

// DiffPackages compares base (e.g. the default branch) against head (e.g. a
// release tag) manifest-by-manifest. A manifest present on only one side
// (a tag's directory structure can differ from the current default
// branch's — see DiscoverPackagesAtRef) reports every package in it as
// wholly added or wholly removed; this never detects renames, by design.
func DiffPackages(base, head []PackageManifest) PackageDiff {
	baseByKey := manifestsByKey(base)
	headByKey := manifestsByKey(head)

	keys := make(map[string]bool, len(baseByKey)+len(headByKey))
	for k := range baseByKey {
		keys[k] = true
	}
	for k := range headByKey {
		keys[k] = true
	}

	diff := PackageDiff{Manifests: []ManifestDiff{}}
	for key := range keys {
		md := diffManifest(baseByKey[key], headByKey[key])
		if len(md.Added) == 0 && len(md.Removed) == 0 && len(md.Bumped) == 0 {
			continue
		}
		diff.Manifests = append(diff.Manifests, md)
	}

	sort.Slice(diff.Manifests, func(i, j int) bool {
		if diff.Manifests[i].Ecosystem != diff.Manifests[j].Ecosystem {
			return diff.Manifests[i].Ecosystem < diff.Manifests[j].Ecosystem
		}
		return diff.Manifests[i].File < diff.Manifests[j].File
	})
	return diff
}

// diffManifest compares one manifest pair by package name. base or head may
// be the zero value (manifest absent on that side) — Ecosystem/File then
// come from whichever side actually has the manifest.
func diffManifest(base, head PackageManifest) ManifestDiff {
	md := ManifestDiff{
		Ecosystem:     firstNonEmpty(base.Ecosystem, head.Ecosystem),
		File:          firstNonEmpty(base.File, head.File),
		Added:         []Package{},
		Removed:       []Package{},
		Bumped:        []PackageBump{},
		BaseTruncated: base.Truncated,
		HeadTruncated: head.Truncated,
	}

	baseIdx := indexByName(base.Packages)
	headIdx := indexByName(head.Packages)

	for name, b := range baseIdx {
		h, ok := headIdx[name]
		if !ok {
			md.Removed = append(md.Removed, b)
			continue
		}
		if b.Version != h.Version {
			md.Bumped = append(md.Bumped, PackageBump{
				Name:        name,
				FromVersion: b.Version,
				ToVersion:   h.Version,
			})
		}
	}
	for name, h := range headIdx {
		if _, ok := baseIdx[name]; !ok {
			md.Added = append(md.Added, h)
		}
	}

	sort.Slice(md.Added, func(i, j int) bool { return md.Added[i].Name < md.Added[j].Name })
	sort.Slice(md.Removed, func(i, j int) bool { return md.Removed[i].Name < md.Removed[j].Name })
	sort.Slice(md.Bumped, func(i, j int) bool { return md.Bumped[i].Name < md.Bumped[j].Name })
	return md
}

func indexByName(pkgs []Package) map[string]Package {
	idx := make(map[string]Package, len(pkgs))
	for _, p := range pkgs {
		idx[p.Name] = p
	}
	return idx
}

func manifestsByKey(manifests []PackageManifest) map[string]PackageManifest {
	idx := make(map[string]PackageManifest, len(manifests))
	for _, m := range manifests {
		idx[m.Ecosystem+":"+m.File] = m
	}
	return idx
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
