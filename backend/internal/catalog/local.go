package catalog

import (
	"context"
	"os"
	"path/filepath"
)

// LocalReader implements RepoReader using the local filesystem.
// Useful for development and testing without a live Gitea connection.
// Point it at the examples/ directory (or any directory that mirrors the
// catalog layout: components/*.yaml, apis/*.yaml, systems/*.yaml, etc.)
type LocalReader struct {
	root string
}

// NewLocalReader creates a LocalReader rooted at dir.
// dir can be absolute or relative to the process working directory.
func NewLocalReader(dir string) *LocalReader {
	return &LocalReader{root: dir}
}

// GetFile reads and returns the content of a file at path relative to root.
func (r *LocalReader) GetFile(_ context.Context, path string) ([]byte, error) {
	return os.ReadFile(filepath.Join(r.root, filepath.FromSlash(path)))
}

// ListFiles returns the names of all files (not subdirectories) inside dirPath
// relative to root.  Returns nil without error when the directory does not exist.
func (r *LocalReader) ListFiles(_ context.Context, dirPath string) ([]string, error) {
	abs := filepath.Join(r.root, filepath.FromSlash(dirPath))
	entries, err := os.ReadDir(abs)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var files []string
	for _, e := range entries {
		if !e.IsDir() {
			files = append(files, e.Name())
		}
	}
	return files, nil
}
