package gitea

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListWorkflowRuns_URLConstruction(t *testing.T) {
	tests := []struct {
		name      string
		page      int
		limit     int
		wantQuery string
	}{
		{"defaults", 0, 0, "limit=5&page=1"},
		{"explicit page and limit", 2, 20, "limit=20&page=2"},
		{"negative page clamps to 1", -1, 5, "limit=5&page=1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotQuery string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotQuery = r.URL.RawQuery
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"workflow_runs":[]}`))
			}))
			defer srv.Close()

			c := New(srv.URL, "token", "owner", "repo")
			if _, err := c.ListWorkflowRuns(context.Background(), "owner", "repo", tt.page, tt.limit); err != nil {
				t.Fatalf("ListWorkflowRuns: %v", err)
			}
			if gotQuery != tt.wantQuery {
				t.Errorf("query = %q, want %q", gotQuery, tt.wantQuery)
			}
		})
	}
}

func TestListReleases_URLConstruction(t *testing.T) {
	tests := []struct {
		name      string
		page      int
		limit     int
		wantQuery string
	}{
		{"defaults", 0, 0, "limit=10&page=1"},
		{"explicit page and limit", 3, 20, "limit=20&page=3"},
		{"negative page clamps to 1", -5, 10, "limit=10&page=1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotQuery string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotQuery = r.URL.RawQuery
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`[]`))
			}))
			defer srv.Close()

			c := New(srv.URL, "token", "owner", "repo")
			if _, err := c.ListReleases(context.Background(), "owner", "repo", tt.page, tt.limit); err != nil {
				t.Fatalf("ListReleases: %v", err)
			}
			if gotQuery != tt.wantQuery {
				t.Errorf("query = %q, want %q", gotQuery, tt.wantQuery)
			}
		})
	}
}
