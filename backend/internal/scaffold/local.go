package scaffold

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// ListLocalTemplates reads template directories from a local path.
// Each subdirectory is a template; its template.yaml provides metadata.
func ListLocalTemplates(dir string) ([]TemplateMeta, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read scaffold dir %q: %w", dir, err)
	}

	var templates []TemplateMeta
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		meta := TemplateMeta{Name: e.Name()}
		metaPath := filepath.Join(dir, e.Name(), "template.yaml")
		if data, err := os.ReadFile(metaPath); err == nil {
			_ = yaml.Unmarshal(data, &meta)
			if meta.Name == "" {
				meta.Name = e.Name()
			}
		}
		templates = append(templates, meta)
	}
	return templates, nil
}
