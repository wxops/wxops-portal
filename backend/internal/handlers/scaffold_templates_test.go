package handlers

import (
	"strings"
	"testing"

	"github.com/wxops/wxops-portal-v2/internal/scaffold"
)

func TestBuildPRBody(t *testing.T) {
	t.Run("includes required sections and identity", func(t *testing.T) {
		req := &scaffold.CreateProjectRequest{
			AppName:    "rocket-api",
			Team:       "rocket-team",
			TemplateID: "go-service",
		}
		body := buildPRBody(req, "https://gitea.example.com/rocket-team/rocket-api")

		for _, want := range []string{
			"rocket-api",
			"rocket-team",
			"go-service",
			"tenant-rocket-team", // defaulted namespace
			"https://gitea.example.com/rocket-team/rocket-api",
			"tenants-apps/rocket-team/rocket-api/base",
			"kustomization.yaml",
			"xtenant-app.yaml",
		} {
			if !strings.Contains(body, want) {
				t.Errorf("buildPRBody() missing %q\ngot:\n%s", want, body)
			}
		}
		if strings.Contains(body, "xtenant-database.yaml") {
			t.Error("buildPRBody() should omit the database line when DatabaseSecrets is false")
		}
		if strings.Contains(body, "external-secret-env.yaml") {
			t.Error("buildPRBody() should omit the vault-env line when VaultSecrets is false")
		}
	})

	t.Run("lists optional infra files only when the toggles are on", func(t *testing.T) {
		req := &scaffold.CreateProjectRequest{
			AppName:         "rocket-api",
			Team:            "rocket-team",
			TemplateID:      "go-service",
			DatabaseSecrets: true,
			VaultSecrets:    true,
		}
		body := buildPRBody(req, "https://gitea.example.com/rocket-team/rocket-api")

		for _, want := range []string{
			"xtenant-database.yaml",
			"external-secret-env.yaml",
			"external-secret-db.yaml",
		} {
			if !strings.Contains(body, want) {
				t.Errorf("buildPRBody() missing %q when toggle enabled\ngot:\n%s", want, body)
			}
		}
	})

	t.Run("explicit namespace overrides the default", func(t *testing.T) {
		req := &scaffold.CreateProjectRequest{
			AppName:    "rocket-api",
			Team:       "rocket-team",
			TemplateID: "go-service",
			Namespace:  "custom-ns",
		}
		body := buildPRBody(req, "https://gitea.example.com/rocket-team/rocket-api")
		if !strings.Contains(body, "**Namespace:** custom-ns") {
			t.Errorf("buildPRBody() did not honor explicit namespace\ngot:\n%s", body)
		}
	})
}

func TestBuildTemplateVars(t *testing.T) {
	t.Run("defaults namespace and port when unset", func(t *testing.T) {
		req := &scaffold.CreateProjectRequest{
			AppName: "rocket-api",
			Team:    "rocket-team",
		}
		vars := buildTemplateVars(req, "https://gitea.example.com", "wxops-bot", "wxops-bot@example.com")

		want := map[string]string{
			"ProjectName":     "rocket-api",
			"ProjectOwner":    "rocket-team",
			"TenantNamespace": "tenant-rocket-team",
			"Namespace":       "tenant-rocket-team",
			"Port":            "8080",
			"GiteaURL":        "https://gitea.example.com",
			"BotUsername":     "wxops-bot",
			"BotEmail":        "wxops-bot@example.com",
		}
		for k, v := range want {
			if vars[k] != v {
				t.Errorf("buildTemplateVars()[%q] = %q, want %q", k, vars[k], v)
			}
		}
	})

	t.Run("explicit namespace and container port are honored", func(t *testing.T) {
		port := int32(3000)
		req := &scaffold.CreateProjectRequest{
			AppName:       "rocket-api",
			Team:          "rocket-team",
			Namespace:     "custom-ns",
			ContainerPort: &port,
		}
		vars := buildTemplateVars(req, "https://gitea.example.com", "bot", "bot@example.com")
		if vars["Namespace"] != "custom-ns" {
			t.Errorf("Namespace = %q, want custom-ns", vars["Namespace"])
		}
		if vars["Port"] != "3000" {
			t.Errorf("Port = %q, want 3000", vars["Port"])
		}
	})
}

func TestSubstituteVars(t *testing.T) {
	vars := map[string]string{
		"ProjectName":  "rocket-api",
		"ProjectOwner": "rocket-team",
	}

	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "go template style with spaces", input: "name: {{ .ProjectName }}", want: "name: rocket-api"},
		{name: "go template style without spaces", input: "name: {{.ProjectName}}", want: "name: rocket-api"},
		{name: "go template style, space before only", input: "name: {{ .ProjectName}}", want: "name: rocket-api"},
		{name: "go template style, space after only", input: "name: {{.ProjectName }}", want: "name: rocket-api"},
		{name: "double-underscore filename style", input: "__ProjectName__-deployment.yaml", want: "rocket-api-deployment.yaml"},
		{name: "multiple distinct vars in one string", input: "{{.ProjectOwner}}/{{.ProjectName}}", want: "rocket-team/rocket-api"},
		{name: "unknown placeholder left untouched", input: "{{.Unknown}}", want: "{{.Unknown}}"},
		{name: "plain text with no placeholders", input: "no placeholders here", want: "no placeholders here"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := substituteVars(tt.input, vars); got != tt.want {
				t.Errorf("substituteVars(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
