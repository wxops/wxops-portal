package handlers

import (
	"testing"

	"github.com/wxops/wxops-portal-v2/internal/auth"
)

func TestLandingPath(t *testing.T) {
	tests := []struct {
		name     string
		returnTo string
		want     string
	}{
		{name: "empty falls back to dashboard", returnTo: "", want: "/dashboard"},
		{name: "same-origin path passed through", returnTo: "/catalog/Component/rocket-api", want: "/catalog/Component/rocket-api"},
		{name: "path with query string passed through", returnTo: "/settings?tab=account", want: "/settings?tab=account"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := landingPath(tt.returnTo); got != tt.want {
				t.Errorf("landingPath(%q) = %q, want %q", tt.returnTo, got, tt.want)
			}
		})
	}
}

func TestIsCLIRedirect(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want bool
	}{
		{name: "loopback IP with path", raw: "http://127.0.0.1:8000/callback", want: true},
		{name: "localhost with path", raw: "http://localhost:8000/callback", want: true},
		{name: "https rejected", raw: "https://127.0.0.1:8000/callback", want: false},
		{name: "arbitrary external host rejected", raw: "http://evil.example.com/callback", want: false},
		{name: "no path rejected", raw: "http://127.0.0.1:8000", want: false},
		{name: "empty string rejected", raw: "", want: false},
		{name: "malformed URL rejected", raw: "http://%zz", want: false},
		{name: "loopback without port", raw: "http://127.0.0.1/callback", want: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isCLIRedirect(tt.raw); got != tt.want {
				t.Errorf("isCLIRedirect(%q) = %v, want %v", tt.raw, got, tt.want)
			}
		})
	}
}

func TestUserResponse(t *testing.T) {
	t.Run("preserves populated groups", func(t *testing.T) {
		s := &auth.Session{Sub: "alice-sub", Username: "alice", Groups: []string{"wxops:rocket-team"}}
		got := userResponse(s)
		if got.Sub != "alice-sub" || got.Username != "alice" || len(got.Groups) != 1 || got.Groups[0] != "wxops:rocket-team" {
			t.Errorf("userResponse() = %+v, unexpected", got)
		}
	})

	t.Run("nil groups become an empty slice, never null in the JSON payload", func(t *testing.T) {
		s := &auth.Session{Sub: "bob-sub", Username: "bob", Groups: nil}
		got := userResponse(s)
		if got.Groups == nil {
			t.Fatal("userResponse().Groups = nil, want non-nil empty slice")
		}
		if len(got.Groups) != 0 {
			t.Errorf("userResponse().Groups = %v, want empty", got.Groups)
		}
	})
}
