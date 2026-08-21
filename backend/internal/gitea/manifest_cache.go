package gitea

import (
	"context"
	"sync"
	"time"
)

// manifestCacheTTL mirrors the cluster-discovery cache's 60s TTL — the
// closest existing precedent for "how short is short enough" in this
// codebase. Only applies to non-immutable (default-branch) entries.
const manifestCacheTTL = 60 * time.Second

type manifestCacheEntry struct {
	manifests []PackageManifest
	fetchedAt time.Time
	immutable bool // true for tag refs — never expires
}

// ManifestCache is a keyed cache of dependency manifests, keyed
// "owner/repo@ref". Tag refs are immutable and cached indefinitely (tags
// don't move); a default-branch ref ("" or a branch name) gets a short TTL.
//
// This is the first *keyed* cache in this codebase — every existing cache
// (catalog.Store, cluster discovery) holds a single value, not a map. Same
// double-checked-locking shape as catalog.Store, just keyed.
//
// Known limitation, accepted for v1: immutable entries never expire and
// there is no eviction, so the map grows unbounded across many repos × tags.
// Fine at this portal's likely scale; revisit with an LRU cap if it isn't.
type ManifestCache struct {
	mu      sync.RWMutex
	entries map[string]manifestCacheEntry
}

// NewManifestCache creates an empty ManifestCache.
func NewManifestCache() *ManifestCache {
	return &ManifestCache{entries: make(map[string]manifestCacheEntry)}
}

// Get returns cached manifests for key if present and not expired, otherwise
// calls fetch, caches the result, and returns it. immutable controls whether
// the cached entry ever expires — pass true only for a tag ref.
func (c *ManifestCache) Get(
	key string,
	immutable bool,
	fetch func() ([]PackageManifest, error),
) ([]PackageManifest, error) {
	// Fast path: cache hit under read lock.
	c.mu.RLock()
	if e, ok := c.entries[key]; ok && (e.immutable || time.Since(e.fetchedAt) < manifestCacheTTL) {
		m := e.manifests
		c.mu.RUnlock()
		return m, nil
	}
	c.mu.RUnlock()

	// Slow path: refresh under write lock.
	c.mu.Lock()
	defer c.mu.Unlock()

	// Another goroutine may have refreshed between the two locks.
	if e, ok := c.entries[key]; ok && (e.immutable || time.Since(e.fetchedAt) < manifestCacheTTL) {
		return e.manifests, nil
	}

	manifests, err := fetch()
	if err != nil {
		return nil, err
	}

	c.entries[key] = manifestCacheEntry{
		manifests: manifests,
		fetchedAt: time.Now(),
		immutable: immutable,
	}
	return manifests, nil
}

// manifestCacheKey builds the "owner/repo@ref" key. ref should be the
// resolved ref actually used for the fetch (a real tag name, or the literal
// string "HEAD" for the default branch) — never empty, so cache entries for
// different repos' default branches never collide with an empty-string key.
func manifestCacheKey(owner, repo, ref string) string {
	if ref == "" {
		ref = "HEAD"
	}
	return owner + "/" + repo + "@" + ref
}

// DiscoverPackagesCached is DiscoverPackagesAtRef fronted by cache. Pass
// immutable=true only when ref is a real tag (tags don't move); false for
// the default branch or any branch ref.
func DiscoverPackagesCached(
	ctx context.Context,
	c *Client,
	cache *ManifestCache,
	owner, repo, ref string,
	immutable bool,
) ([]PackageManifest, error) {
	key := manifestCacheKey(owner, repo, ref)
	return cache.Get(key, immutable, func() ([]PackageManifest, error) {
		return DiscoverPackagesAtRef(ctx, c, owner, repo, ref)
	})
}
