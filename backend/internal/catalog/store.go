package catalog

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

// RepoReader abstracts the source of catalog YAML files.
// Both *gitea.Client (production) and *LocalReader (development) implement this.
type RepoReader interface {
	GetFile(ctx context.Context, path string) ([]byte, error)
	ListFiles(ctx context.Context, dirPath string) ([]string, error)
	ListDirs(ctx context.Context, dirPath string) ([]string, error)
}

const cacheTTL = 5 * time.Minute

// kindDir maps the canonical entity Kind string to its subdirectory under catalogPath.
var kindDir = map[string]string{
	"Component": "components",
	"API":       "apis",
	"System":    "systems",
	"Group":     "groups",
	"User":      "users",
	"Resource":  "resources",
	"Doc":       "docs",
}

// KindDir returns the subdirectory name for a given entity kind.
// Returns the lowercase-plural form (e.g. "Component" → "components").
func KindDir(kind string) string {
	if d, ok := kindDir[kind]; ok {
		return d
	}
	return strings.ToLower(kind) + "s"
}

// kindDirSet is the set of known kind-directory names for O(1) lookup.
var kindDirSet = func() map[string]bool {
	s := make(map[string]bool, len(kindDir))
	for _, v := range kindDir {
		s[v] = true
	}
	return s
}()

// Store fetches and caches catalog entities from a RepoReader.
// Entities are read from <catalogPath>/<kind-dir>/*.yaml on first request and
// re-fetched every cacheTTL (5 minutes) thereafter.
type Store struct {
	reader      RepoReader
	catalogPath string

	mu       sync.RWMutex
	cached   []Entity
	cachedAt time.Time
}

// NewStore creates a Store.
//
//	reader      — nil returns a descriptive error on any fetch (Gitea/local not configured).
//	catalogPath — directory prefix for kind subdirs; empty means kind dirs are at the root.
func NewStore(reader RepoReader, catalogPath string) *Store {
	return &Store{reader: reader, catalogPath: catalogPath}
}

// GetFileContent returns the raw bytes of a file inside the catalog repository.
// path may be:
//   - A path relative to the catalog root (e.g. "docs/rfcs/rfc-001.md")
//   - An absolute path from the repo root (e.g. "/architecture/rfcs/rfc-001.md")
//
// Use this for Doc entities whose contentUrl is a relative path rather than a
// full https:// URL. For full URLs use the SpecFetcher in the handler layer.
func (s *Store) GetFileContent(ctx context.Context, path string) ([]byte, error) {
	if s.reader == nil {
		return nil, fmt.Errorf("catalog: no reader configured")
	}
	return s.reader.GetFile(ctx, s.joinPath(path))
}

// ListAll returns every entity across all kinds.
func (s *Store) ListAll(ctx context.Context) ([]Entity, error) {
	return s.all(ctx)
}

// ListByKind returns entities whose Kind matches (case-insensitive).
func (s *Store) ListByKind(ctx context.Context, kind string) ([]Entity, error) {
	all, err := s.all(ctx)
	if err != nil {
		return nil, err
	}
	var out []Entity
	for _, e := range all {
		if strings.EqualFold(e.Kind, kind) {
			out = append(out, e)
		}
	}
	return out, nil
}

// Get returns a single entity by kind and name (both case-insensitive).
func (s *Store) Get(ctx context.Context, kind, name string) (*Entity, error) {
	all, err := s.all(ctx)
	if err != nil {
		return nil, err
	}
	for i := range all {
		if strings.EqualFold(all[i].Kind, kind) && strings.EqualFold(all[i].Metadata.Name, name) {
			return &all[i], nil
		}
	}
	return nil, fmt.Errorf("entity %s/%s not found", kind, name)
}

// InvalidateCache clears the in-memory cache so the next read re-fetches
// from the underlying reader. Call this after writing an entity to disk
// in local-dev mode so the change is immediately visible.
func (s *Store) InvalidateCache() {
	s.mu.Lock()
	s.cached = nil
	s.mu.Unlock()
}

// CatalogPath returns the configured catalog path prefix (e.g. "service-catalog").
func (s *Store) CatalogPath() string {
	return s.catalogPath
}

// EntityRelPath returns the relative path of an entity within the catalog
// directory. E.g. "payments-team/components/payment-api.yaml".
// Returns "" if the entity's owner team cannot be determined.
func (s *Store) EntityRelPath(kind, name string) string {
	entity, err := s.Get(context.Background(), kind, name)
	if err != nil || entity == nil {
		return ""
	}
	team := entity.Spec.Owner
	if strings.HasPrefix(team, "group:") {
		team = team[6:]
	}
	if team == "" {
		return ""
	}
	return team + "/" + KindDir(kind) + "/" + name + ".yaml"
}

// all returns the full entity list, reading from cache when fresh.
func (s *Store) all(ctx context.Context) ([]Entity, error) {
	if s.reader == nil {
		return nil, fmt.Errorf(
			"catalog: no reader configured — set CATALOG_LOCAL_DIR for local testing, " +
				"or GITEA_URL + GITEA_TOKEN + GITEA_CATALOG_OWNER + GITEA_CATALOG_REPO for production")
	}

	// Fast path: cache hit under read lock.
	s.mu.RLock()
	if s.cached != nil && time.Since(s.cachedAt) < cacheTTL {
		c := s.cached
		s.mu.RUnlock()
		return c, nil
	}
	s.mu.RUnlock()

	// Slow path: refresh under write lock.
	s.mu.Lock()
	defer s.mu.Unlock()

	// Another goroutine may have refreshed between the two locks.
	if s.cached != nil && time.Since(s.cachedAt) < cacheTTL {
		return s.cached, nil
	}

	entities, err := s.fetch(ctx)
	if err != nil {
		return nil, err
	}

	s.cached = entities
	s.cachedAt = time.Now()
	return entities, nil
}

// fetch reads every catalog subdirectory and parses the YAML files.
//
// Two directory layouts are supported and may coexist:
//
//	Flat:  <catalogPath>/<kind>/         e.g. catalog/systems/abc.yaml
//	Team:  <catalogPath>/<team>/<kind>/  e.g. catalog/payments-team/systems/abc.yaml
//
// Top-level directories whose names match a known kind dir (systems, components,
// apis, groups, resources) are read as flat; any other directory is treated as a
// team namespace and its kind subdirectories are read in turn.
func (s *Store) fetch(ctx context.Context) ([]Entity, error) {
	var entities []Entity

	topDirs, err := s.reader.ListDirs(ctx, s.catalogPath)
	if err != nil || len(topDirs) == 0 {
		return entities, nil
	}

	for _, dir := range topDirs {
		if kindDirSet[dir] {
			// Flat layout: the top-level directory is itself a kind directory.
			fetched, _ := s.readKindDir(ctx, s.joinPath(dir))
			entities = append(entities, fetched...)
		} else {
			// Team layout: descend into each kind subdirectory inside the team dir.
			for _, kindSubDir := range kindDir {
				fetched, _ := s.readKindDir(ctx, s.joinPath(dir, kindSubDir))
				entities = append(entities, fetched...)
			}
		}
	}

	return entities, nil
}

// joinPath prepends catalogPath (when non-empty) to the given path segments.
func (s *Store) joinPath(parts ...string) string {
	if s.catalogPath != "" {
		return s.catalogPath + "/" + strings.Join(parts, "/")
	}
	return strings.Join(parts, "/")
}

// readKindDir lists and parses all YAML files in a single directory.
// Missing or unreadable directories are silently skipped.
func (s *Store) readKindDir(ctx context.Context, dirPath string) ([]Entity, error) {
	files, err := s.reader.ListFiles(ctx, dirPath)
	if err != nil {
		return nil, err
	}

	var entities []Entity
	for _, filename := range files {
		if !strings.HasSuffix(filename, ".yaml") && !strings.HasSuffix(filename, ".yml") {
			continue
		}
		data, err := s.reader.GetFile(ctx, dirPath+"/"+filename)
		if err != nil {
			continue
		}
		for _, e := range parseEntities(data) {
			if err := e.Validate(); err == nil {
				entities = append(entities, e)
			}
		}
	}
	return entities, nil
}

// parseEntities decodes one or more YAML documents from data.
func parseEntities(data []byte) []Entity {
	var out []Entity
	dec := yaml.NewDecoder(bytes.NewReader(data))
	for {
		var e Entity
		if err := dec.Decode(&e); err != nil {
			if err == io.EOF {
				break
			}
			continue
		}
		if e.Kind == "" || e.Metadata.Name == "" {
			continue
		}
		out = append(out, e)
	}
	return out
}
