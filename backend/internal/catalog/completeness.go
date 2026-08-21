package catalog

// CompletenessScore is a per-entity quality score computed on read — never
// stored, never cached separately from the entity itself.
type CompletenessScore struct {
	Score  int             `json:"score"`
	Max    int             `json:"max"`
	Checks map[string]bool `json:"checks"`
}

// ComputeCompletenessScore checks the same fields Validate() already treats
// as meaningful for a well-formed entity, plus an API-spec presence check for
// Kind == "API". It never fails — an incomplete entity is a low score, not an
// error — so it's safe to call on every read.
func ComputeCompletenessScore(e *Entity) CompletenessScore {
	checks := map[string]bool{
		"description": e.Metadata.Description != "",
		"owner":       e.Spec.Owner != "",
		"tags":        len(e.Metadata.Tags) > 0,
		"links":       len(e.Metadata.Links) > 0,
		"lifecycle":   e.Spec.Lifecycle != "",
	}
	if e.Kind == "API" {
		checks["apiSpec"] = hasAPISpec(e)
	}

	score, max := 0, 0
	for _, ok := range checks {
		max++
		if ok {
			score++
		}
	}
	return CompletenessScore{Score: score, Max: max, Checks: checks}
}

// hasAPISpec checks presence only — it mirrors the same two signals
// handlers.GetEntitySpec resolves at serve time (inline Spec.Definition, or a
// Metadata.Links entry typed "openapi"), without following the link.
func hasAPISpec(e *Entity) bool {
	if e.Spec.Definition != "" {
		return true
	}
	for _, link := range e.Metadata.Links {
		if link.Type == "openapi" {
			return true
		}
	}
	return false
}
