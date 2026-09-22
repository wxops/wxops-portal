package handlers

import (
	"testing"

	"github.com/wxops/wxops-portal-v2/internal/catalog"
)

func TestIsAbsoluteURL(t *testing.T) {
	tests := []struct {
		name string
		s    string
		want bool
	}{
		{name: "https", s: "https://example.com/spec.yaml", want: true},
		{name: "http", s: "http://example.com/spec.yaml", want: true},
		{name: "relative path", s: "docs/spec.yaml", want: false},
		{name: "leading slash relative path", s: "/docs/spec.yaml", want: false},
		{name: "empty string", s: "", want: false},
		{name: "scheme-like but not prefix", s: "ftp://example.com/spec.yaml", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isAbsoluteURL(tt.s); got != tt.want {
				t.Errorf("isAbsoluteURL(%q) = %v, want %v", tt.s, got, tt.want)
			}
		})
	}
}

func TestEntityMatchesSearch(t *testing.T) {
	entity := catalog.Entity{
		Metadata: catalog.EntityMetadata{
			Name:        "rocket-api",
			Title:       "Rocket API",
			Description: "Handles rocket launch scheduling",
			Tags:        []string{"go", "payments"},
		},
	}

	tests := []struct {
		name  string
		query string
		want  bool
	}{
		{name: "matches name", query: "rocket-api", want: true},
		{name: "entity name itself is lowercased before comparison", query: "ROCKET-API", want: false}, // caller contract: lq must already be lowercase
		{name: "matches title, entity-side case is normalized", query: "rocket api", want: true},
		{name: "matches description substring", query: "scheduling", want: true},
		{name: "matches tag", query: "payments", want: true},
		{name: "no match", query: "billing", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := entityMatchesSearch(entity, tt.query); got != tt.want {
				t.Errorf("entityMatchesSearch(query=%q) = %v, want %v", tt.query, got, tt.want)
			}
		})
	}
}

func TestSpecContentType(t *testing.T) {
	tests := []struct {
		name     string
		filename string
		want     string
	}{
		{name: "yaml extension", filename: "openapi.yaml", want: "text/yaml; charset=utf-8"},
		{name: "yml extension", filename: "openapi.yml", want: "text/yaml; charset=utf-8"},
		{name: "json extension", filename: "openapi.json", want: "application/json"},
		{name: "no extension defaults to json", filename: "openapi", want: "application/json"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := specContentType(tt.filename); got != tt.want {
				t.Errorf("specContentType(%q) = %q, want %q", tt.filename, got, tt.want)
			}
		})
	}
}

func TestIsPortalPR(t *testing.T) {
	tests := []struct {
		name  string
		title string
		want  bool
	}{
		{name: "scaffold PR", title: "[Scaffold] New project: rocket-team/rocket-api", want: true},
		{name: "catalog PR", title: "[Catalog] Register Component/rocket-api", want: true},
		{name: "config PR", title: "[Config] Update rocket-team/rocket-api", want: true},
		{name: "unrelated PR", title: "fix: typo in README", want: false},
		{name: "empty title", title: "", want: false},
		{name: "prefix must be at start", title: "chore: [Scaffold] something", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isPortalPR(tt.title); got != tt.want {
				t.Errorf("isPortalPR(%q) = %v, want %v", tt.title, got, tt.want)
			}
		})
	}
}

func TestExtractTeamSlash(t *testing.T) {
	tests := []struct {
		name  string
		title string
		want  string
	}{
		{name: "scaffold title", title: "[Scaffold] New project: rocket-team/rocket-api", want: "rocket-team"},
		{name: "config title", title: "[Config] Update rocket-team/rocket-api", want: "rocket-team"},
		{name: "no slash anywhere", title: "[Scaffold] New project: rocketapi", want: ""},
		{name: "slash at position zero is skipped (index must be > 0)", title: "[Scaffold] /rocket-api", want: ""},
		{name: "picks the last slash-bearing token", title: "[Config] a/b rocket-team/rocket-api", want: "rocket-team"},
		{name: "empty title", title: "", want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := extractTeamSlash(tt.title); got != tt.want {
				t.Errorf("extractTeamSlash(%q) = %q, want %q", tt.title, got, tt.want)
			}
		})
	}
}

func TestEntityRelPath(t *testing.T) {
	tests := []struct {
		name  string
		kind  string
		owner string
		enti  string
		want  string
	}{
		{name: "group-prefixed owner", kind: "Component", owner: "group:rocket-team", enti: "rocket-api", want: "rocket-team/components/rocket-api.yaml"},
		{name: "bare owner without prefix", kind: "Component", owner: "rocket-team", enti: "rocket-api", want: "rocket-team/components/rocket-api.yaml"},
		{name: "empty owner falls back to default", kind: "Component", owner: "", enti: "rocket-api", want: "default/components/rocket-api.yaml"},
		{name: "API kind maps to apis dir", kind: "API", owner: "group:rocket-team", enti: "rocket-api", want: "rocket-team/apis/rocket-api.yaml"},
		{name: "Resource kind maps to resources dir", kind: "Resource", owner: "group:rocket-team", enti: "rocket-db", want: "rocket-team/resources/rocket-db.yaml"},
		{name: "unknown kind falls back to lowercase-plural", kind: "Widget", owner: "group:rocket-team", enti: "thing", want: "rocket-team/widgets/thing.yaml"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := entityRelPath(tt.kind, tt.owner, tt.enti); got != tt.want {
				t.Errorf("entityRelPath(%q, %q, %q) = %q, want %q", tt.kind, tt.owner, tt.enti, got, tt.want)
			}
		})
	}
}
