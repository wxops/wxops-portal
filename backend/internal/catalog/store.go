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
}

const cacheTTL = 5 * time.Minute

// kindDir maps the canonical entity Kind string to its subdirectory under catalogPath.
var kindDir = map[string]string{
	"Component": "components",
	"API":       "apis",
	"System":    "systems",
	"Group":     "groups",
	"Resource":  "resources",
}

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
// Directories that don't exist yet are silently skipped.
func (s *Store) fetch(ctx context.Context) ([]Entity, error) {
	var entities []Entity

	for _, dir := range kindDir {
		dirPath := dir
		if s.catalogPath != "" {
			dirPath = s.catalogPath + "/" + dir
		}

		files, err := s.reader.ListFiles(ctx, dirPath)
		if err != nil {
			continue
		}

		for _, filename := range files {
			if !strings.HasSuffix(filename, ".yaml") && !strings.HasSuffix(filename, ".yml") {
				continue
			}

			data, err := s.reader.GetFile(ctx, dirPath+"/"+filename)
			if err != nil {
				continue
			}

			parsed := parseEntities(data)
			for _, e := range parsed {
				if err := e.Validate(); err != nil {
					continue
				}
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
