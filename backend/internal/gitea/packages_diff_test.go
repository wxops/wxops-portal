package gitea

import "testing"

func manifests(pkgs ...Package) []PackageManifest {
	return []PackageManifest{{Ecosystem: "go", File: "go.mod", Packages: pkgs}}
}

// findManifest is a test helper — DiffPackages omits unchanged manifests and
// doesn't guarantee callers know the index of the one they care about.
func findManifest(t *testing.T, diff PackageDiff, ecosystem, file string) ManifestDiff {
	t.Helper()
	for _, m := range diff.Manifests {
		if m.Ecosystem == ecosystem && m.File == file {
			return m
		}
	}
	t.Fatalf("no manifest diff for %s:%s in %+v", ecosystem, file, diff.Manifests)
	return ManifestDiff{}
}

func TestDiffPackages(t *testing.T) {
	base := manifests(
		Package{Ecosystem: "go", Name: "a", Version: "1.0.0"},
		Package{Ecosystem: "go", Name: "b", Version: "2.0.0"},
		Package{Ecosystem: "go", Name: "c", Version: "3.0.0"},
	)
	head := manifests(
		Package{Ecosystem: "go", Name: "a", Version: "1.0.0"}, // unchanged
		Package{Ecosystem: "go", Name: "b", Version: "2.1.0"}, // bumped
		Package{Ecosystem: "go", Name: "d", Version: "4.0.0"}, // added
		// c removed
	)

	diff := DiffPackages(base, head)
	m := findManifest(t, diff, "go", "go.mod")

	if len(m.Added) != 1 || m.Added[0].Name != "d" {
		t.Errorf("Added = %+v, want [d]", m.Added)
	}
	if len(m.Removed) != 1 || m.Removed[0].Name != "c" {
		t.Errorf("Removed = %+v, want [c]", m.Removed)
	}
	if len(m.Bumped) != 1 || m.Bumped[0].Name != "b" ||
		m.Bumped[0].FromVersion != "2.0.0" || m.Bumped[0].ToVersion != "2.1.0" {
		t.Errorf("Bumped = %+v, want [{b 2.0.0 2.1.0}]", m.Bumped)
	}
}

func TestDiffPackages_SameNameDifferentEcosystemAreDistinct(t *testing.T) {
	base := []PackageManifest{
		{Ecosystem: "go", File: "go.mod", Packages: []Package{{Ecosystem: "go", Name: "yaml", Version: "1.0"}}},
		{Ecosystem: "python", File: "requirements.txt", Packages: []Package{{Ecosystem: "python", Name: "yaml", Version: "5.0"}}},
	}
	// Only the Go one changes.
	head := []PackageManifest{
		{Ecosystem: "go", File: "go.mod", Packages: []Package{{Ecosystem: "go", Name: "yaml", Version: "2.0"}}},
		{Ecosystem: "python", File: "requirements.txt", Packages: []Package{{Ecosystem: "python", Name: "yaml", Version: "5.0"}}},
	}

	diff := DiffPackages(base, head)

	if len(diff.Manifests) != 1 {
		t.Fatalf("expected exactly one changed manifest (go), got %+v", diff.Manifests)
	}
	m := diff.Manifests[0]
	if m.Ecosystem != "go" || len(m.Bumped) != 1 {
		t.Errorf("Bumped = %+v, want exactly one go:yaml bump, python:yaml untouched", m)
	}
}

// TestDiffPackages_SameNameDifferentManifestSameEcosystemAreDistinct covers a
// monorepo shape this portal itself has: a CLI's go.mod and a backend's
// go.mod, both ecosystem "go", each pinning a same-named dependency at a
// different version. Before manifests were matched by (ecosystem, file)
// before diffing, these collided in one shared "ecosystem:name" map key and
// one side's change silently overwrote the other's.
func TestDiffPackages_SameNameDifferentManifestSameEcosystemAreDistinct(t *testing.T) {
	base := []PackageManifest{
		{Ecosystem: "go", File: "cli/go.mod", Packages: []Package{{Ecosystem: "go", Name: "shared-lib", Version: "1.0.0"}}},
		{Ecosystem: "go", File: "backend/go.mod", Packages: []Package{{Ecosystem: "go", Name: "shared-lib", Version: "3.0.0"}}},
	}
	head := []PackageManifest{
		{Ecosystem: "go", File: "cli/go.mod", Packages: []Package{{Ecosystem: "go", Name: "shared-lib", Version: "1.5.0"}}},
		// backend/go.mod unchanged
		{Ecosystem: "go", File: "backend/go.mod", Packages: []Package{{Ecosystem: "go", Name: "shared-lib", Version: "3.0.0"}}},
	}

	diff := DiffPackages(base, head)

	if len(diff.Manifests) != 1 {
		t.Fatalf("expected exactly one changed manifest (cli/go.mod), got %+v", diff.Manifests)
	}
	cli := findManifest(t, diff, "go", "cli/go.mod")
	if len(cli.Bumped) != 1 || cli.Bumped[0].FromVersion != "1.0.0" || cli.Bumped[0].ToVersion != "1.5.0" {
		t.Errorf("cli/go.mod Bumped = %+v, want [{shared-lib 1.0.0 1.5.0}]", cli.Bumped)
	}
}

// TestDiffPackages_ManifestOnlyOnOneSide covers a tag whose directory layout
// doesn't match the current default branch's — DiscoverPackagesAtRef already
// documents this can happen. The whole manifest's packages should read as
// wholly added or wholly removed, not silently dropped.
func TestDiffPackages_ManifestOnlyOnOneSide(t *testing.T) {
	base := []PackageManifest{
		{Ecosystem: "node", File: "legacy-frontend/package.json", Packages: []Package{{Ecosystem: "node", Name: "react", Version: "17.0.0"}}},
	}
	head := []PackageManifest{
		{Ecosystem: "node", File: "frontend/package.json", Packages: []Package{{Ecosystem: "node", Name: "react", Version: "19.0.0"}}},
	}

	diff := DiffPackages(base, head)

	if len(diff.Manifests) != 2 {
		t.Fatalf("expected two independent manifest diffs (old removed, new added), got %+v", diff.Manifests)
	}
	oldM := findManifest(t, diff, "node", "legacy-frontend/package.json")
	if len(oldM.Removed) != 1 || len(oldM.Added) != 0 {
		t.Errorf("legacy-frontend/package.json = %+v, want fully removed", oldM)
	}
	newM := findManifest(t, diff, "node", "frontend/package.json")
	if len(newM.Added) != 1 || len(newM.Removed) != 0 {
		t.Errorf("frontend/package.json = %+v, want fully added", newM)
	}
}

// TestDiffPackages_TruncationFlagsPropagate covers the case Phase 3 exists
// for: if either side of a compare was truncated, the resulting manifest
// diff's added/removed counts may be an artifact of the cutoff rather than a
// real change, so the caller must be able to tell.
func TestDiffPackages_TruncationFlagsPropagate(t *testing.T) {
	base := []PackageManifest{
		{Ecosystem: "go", File: "go.mod", Truncated: true, Total: 640, Packages: []Package{
			{Ecosystem: "go", Name: "a", Version: "1.0.0"},
		}},
	}
	head := []PackageManifest{
		{Ecosystem: "go", File: "go.mod", Truncated: false, Packages: []Package{
			{Ecosystem: "go", Name: "a", Version: "2.0.0"},
		}},
	}

	diff := DiffPackages(base, head)
	m := findManifest(t, diff, "go", "go.mod")

	if !m.BaseTruncated {
		t.Errorf("BaseTruncated = false, want true")
	}
	if m.HeadTruncated {
		t.Errorf("HeadTruncated = true, want false")
	}
}

func TestDiffPackages_NoChanges(t *testing.T) {
	base := manifests(Package{Ecosystem: "go", Name: "a", Version: "1.0.0"})
	head := manifests(Package{Ecosystem: "go", Name: "a", Version: "1.0.0"})

	diff := DiffPackages(base, head)

	if len(diff.Manifests) != 0 {
		t.Errorf("expected no changed manifests, got %+v", diff.Manifests)
	}
	if diff.Manifests == nil {
		t.Errorf("expected empty slice, not nil, so JSON serializes as [] not null: %+v", diff)
	}
}
