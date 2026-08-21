package gitea

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetRepoFileAtRef_URLConstruction(t *testing.T) {
	tests := []struct {
		name      string
		ref       string
		wantQuery string // "" means no ?ref= param at all
	}{
		{"empty ref omits query param", "", ""},
		{"branch ref", "develop", "ref=develop"},
		{"tag ref", "v1.2.3", "ref=v1.2.3"},
		{"ref needing escaping", "feature/x y", "ref=feature%2Fx+y"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotQuery string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotQuery = r.URL.RawQuery
				content := base64.StdEncoding.EncodeToString([]byte("hello"))
				_ = json.NewEncoder(w).Encode(map[string]string{"content": content})
			}))
			defer srv.Close()

			c := New(srv.URL, "token", "owner", "repo")
			data, err := c.GetRepoFileAtRef(context.Background(), "owner", "repo", "go.mod", tt.ref)
			if err != nil {
				t.Fatalf("GetRepoFileAtRef: %v", err)
			}
			if string(data) != "hello" {
				t.Errorf("decoded content = %q, want %q", data, "hello")
			}
			if gotQuery != tt.wantQuery {
				t.Errorf("query = %q, want %q", gotQuery, tt.wantQuery)
			}
		})
	}
}

func TestGetRepoFile_IsRefLessWrapper(t *testing.T) {
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		content := base64.StdEncoding.EncodeToString([]byte("x"))
		_ = json.NewEncoder(w).Encode(map[string]string{"content": content})
	}))
	defer srv.Close()

	c := New(srv.URL, "token", "owner", "repo")
	if _, err := c.GetRepoFile(context.Background(), "owner", "repo", "go.mod"); err != nil {
		t.Fatalf("GetRepoFile: %v", err)
	}
	if gotQuery != "" {
		t.Errorf("GetRepoFile should never append ?ref=, got query %q", gotQuery)
	}
}
