package gitea

import (
	"sync/atomic"
	"testing"
)

func TestManifestCache_TagIsImmutable(t *testing.T) {
	c := NewManifestCache()
	var calls int32
	fetch := func() ([]PackageManifest, error) {
		atomic.AddInt32(&calls, 1)
		return []PackageManifest{{Ecosystem: "go", File: "go.mod"}}, nil
	}

	for range 3 {
		if _, err := c.Get("owner/repo@v1.0.0", true, fetch); err != nil {
			t.Fatalf("Get: %v", err)
		}
	}

	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Errorf("fetch called %d times for a tag key, want 1 (immutable entries must not refetch)", got)
	}
}

func TestManifestCache_BranchExpiresAfterTTL(t *testing.T) {
	c := NewManifestCache()
	var calls int32
	fetch := func() ([]PackageManifest, error) {
		atomic.AddInt32(&calls, 1)
		return []PackageManifest{{Ecosystem: "go", File: "go.mod"}}, nil
	}

	if _, err := c.Get("owner/repo@HEAD", false, fetch); err != nil {
		t.Fatalf("Get: %v", err)
	}
	if _, err := c.Get("owner/repo@HEAD", false, fetch); err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Errorf("fetch called %d times within TTL, want 1 (second call should hit cache)", got)
	}

	// Force expiry by writing an entry with a stale fetchedAt, same shape as
	// what a real TTL expiry looks like, rather than sleeping in a test.
	c.mu.Lock()
	e := c.entries["owner/repo@HEAD"]
	e.fetchedAt = e.fetchedAt.Add(-2 * manifestCacheTTL)
	c.entries["owner/repo@HEAD"] = e
	c.mu.Unlock()

	if _, err := c.Get("owner/repo@HEAD", false, fetch); err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Errorf("fetch called %d times after forced expiry, want 2", got)
	}
}

func TestManifestCache_DifferentKeysDontCollide(t *testing.T) {
	c := NewManifestCache()
	var calls int32
	fetch := func() ([]PackageManifest, error) {
		atomic.AddInt32(&calls, 1)
		return nil, nil
	}

	keys := []string{
		manifestCacheKey("owner", "repo", ""),
		manifestCacheKey("owner", "repo", "v1.0.0"),
		manifestCacheKey("owner", "other-repo", ""),
	}
	for _, k := range keys {
		if _, err := c.Get(k, true, fetch); err != nil {
			t.Fatalf("Get: %v", err)
		}
	}
	if got := atomic.LoadInt32(&calls); got != 3 {
		t.Errorf("fetch called %d times for 3 distinct keys, want 3", got)
	}
	if keys[0] == keys[1] || keys[0] == keys[2] || keys[1] == keys[2] {
		t.Errorf("expected 3 distinct cache keys, got %v", keys)
	}
}
