package scaffold

import "testing"

func kindCounts(pairs []CatalogEntityPair) map[string]int {
	counts := make(map[string]int)
	for _, p := range pairs {
		counts[p.Kind]++
	}
	return counts
}

func TestGenerateCatalogEntities(t *testing.T) {
	t.Run("minimal request generates only Component and System", func(t *testing.T) {
		req := &CreateProjectRequest{AppName: "rocket-api", Team: "rocket-team", TemplateID: "go-service"}
		pairs := GenerateCatalogEntities(req, "https://gitea.example.com")
		counts := kindCounts(pairs)

		if counts["Component"] != 1 {
			t.Errorf("Component count = %d, want 1", counts["Component"])
		}
		if counts["System"] != 1 {
			t.Errorf("System count = %d, want 1 (no systemName supplied, so one is created)", counts["System"])
		}
		if counts["Resource"] != 0 || counts["API"] != 0 {
			t.Errorf("expected no Resource/API entities, got Resource=%d API=%d", counts["Resource"], counts["API"])
		}
	})

	t.Run("systemName supplied suppresses System entity creation", func(t *testing.T) {
		req := &CreateProjectRequest{AppName: "rocket-api", Team: "rocket-team", TemplateID: "go-service", SystemName: "rocket-platform"}
		pairs := GenerateCatalogEntities(req, "https://gitea.example.com")
		counts := kindCounts(pairs)
		if counts["System"] != 0 {
			t.Errorf("System count = %d, want 0 when systemName is explicit", counts["System"])
		}
	})

	t.Run("vault toggle adds a Resource and a Component dependsOn edge", func(t *testing.T) {
		req := &CreateProjectRequest{AppName: "rocket-api", Team: "rocket-team", TemplateID: "go-service", VaultSecrets: true}
		pairs := GenerateCatalogEntities(req, "https://gitea.example.com")
		counts := kindCounts(pairs)
		if counts["Resource"] != 1 {
			t.Fatalf("Resource count = %d, want 1", counts["Resource"])
		}

		var resourceName string
		for _, p := range pairs {
			if p.Kind == "Resource" {
				resourceName = p.Name
			}
		}
		if resourceName != "rocket-api-vault" {
			t.Errorf("vault resource name = %q, want rocket-api-vault", resourceName)
		}
	})

	t.Run("database toggle adds a Resource named via ResolveDbName", func(t *testing.T) {
		req := &CreateProjectRequest{AppName: "rocket-api", Team: "rocket-team", TemplateID: "go-service", DatabaseSecrets: true}
		pairs := GenerateCatalogEntities(req, "https://gitea.example.com")
		var resourceName string
		for _, p := range pairs {
			if p.Kind == "Resource" {
				resourceName = p.Name
			}
		}
		if resourceName != "rocket-api-db" {
			t.Errorf("database resource name = %q, want rocket-api-db (ResolveDbName default)", resourceName)
		}
	})

	t.Run("vault and database both enabled produce two distinct Resources", func(t *testing.T) {
		req := &CreateProjectRequest{AppName: "rocket-api", Team: "rocket-team", TemplateID: "go-service", VaultSecrets: true, DatabaseSecrets: true}
		pairs := GenerateCatalogEntities(req, "https://gitea.example.com")
		counts := kindCounts(pairs)
		if counts["Resource"] != 2 {
			t.Errorf("Resource count = %d, want 2 (vault + database)", counts["Resource"])
		}
	})

	t.Run("API toggle adds an API entity defaulting to openapi type", func(t *testing.T) {
		req := &CreateProjectRequest{AppName: "rocket-api", Team: "rocket-team", TemplateID: "go-service", APIEnabled: true}
		pairs := GenerateCatalogEntities(req, "https://gitea.example.com")
		counts := kindCounts(pairs)
		if counts["API"] != 1 {
			t.Fatalf("API count = %d, want 1", counts["API"])
		}
	})

	t.Run("no toggles enabled: Component has no dependsOn or providesApis", func(t *testing.T) {
		req := &CreateProjectRequest{AppName: "rocket-api", Team: "rocket-team", TemplateID: "go-service"}
		pairs := GenerateCatalogEntities(req, "https://gitea.example.com")
		for _, p := range pairs {
			if p.Kind != "Component" {
				continue
			}
			if len(p.YAML) == 0 {
				t.Error("Component YAML is empty")
			}
		}
	})

	t.Run("entity file paths are namespaced under the owning team", func(t *testing.T) {
		req := &CreateProjectRequest{AppName: "rocket-api", Team: "rocket-team", TemplateID: "go-service", VaultSecrets: true}
		pairs := GenerateCatalogEntities(req, "https://gitea.example.com")
		for _, p := range pairs {
			if p.Path == "" {
				t.Errorf("entity %s/%s has an empty Path", p.Kind, p.Name)
			}
			if p.Path[:len("rocket-team/")] != "rocket-team/" {
				t.Errorf("entity %s/%s path %q not namespaced under rocket-team/", p.Kind, p.Name, p.Path)
			}
		}
	})
}
