package catalog

import "testing"

func TestComputeCompletenessScore(t *testing.T) {
	tests := []struct {
		name      string
		entity    Entity
		wantScore int
		wantMax   int
	}{
		{
			name: "component, all fields present",
			entity: Entity{
				Kind: "Component",
				Metadata: EntityMetadata{
					Description: "does things",
					Tags:        []string{"go"},
					Links:       []EntityLink{{URL: "https://example.com"}},
				},
				Spec: EntitySpec{Owner: "group:platform-team", Lifecycle: "production"},
			},
			wantScore: 5,
			wantMax:   5,
		},
		{
			name:      "component, nothing set",
			entity:    Entity{Kind: "Component"},
			wantScore: 0,
			wantMax:   5,
		},
		{
			name: "API, inline definition present",
			entity: Entity{
				Kind: "API",
				Spec: EntitySpec{Owner: "group:x", Lifecycle: "production", Definition: "openapi: 3.0.0"},
			},
			wantScore: 3,
			wantMax:   6,
		},
		{
			name: "API, openapi link present",
			entity: Entity{
				Kind:     "API",
				Metadata: EntityMetadata{Links: []EntityLink{{URL: "./openapi.yaml", Type: "openapi"}}},
			},
			wantScore: 2,
			wantMax:   6,
		},
		{
			name: "API, neither definition nor openapi link",
			entity: Entity{
				Kind:     "API",
				Metadata: EntityMetadata{Links: []EntityLink{{URL: "https://runbook", Type: "runbook"}}},
			},
			wantScore: 1, // links check counts (non-empty Links slice), apiSpec does not
			wantMax:   6,
		},
		{
			name:      "non-API kind never gets an apiSpec check",
			entity:    Entity{Kind: "Resource"},
			wantScore: 0,
			wantMax:   5,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ComputeCompletenessScore(&tt.entity)
			if got.Score != tt.wantScore {
				t.Errorf("Score = %d, want %d (checks: %+v)", got.Score, tt.wantScore, got.Checks)
			}
			if got.Max != tt.wantMax {
				t.Errorf("Max = %d, want %d", got.Max, tt.wantMax)
			}
			if _, hasAPI := got.Checks["apiSpec"]; tt.entity.Kind != "API" && hasAPI {
				t.Errorf("non-API entity should not have an apiSpec check key")
			}
		})
	}
}
