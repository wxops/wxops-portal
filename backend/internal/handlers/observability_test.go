package handlers

import (
	"errors"
	"fmt"
	"testing"

	"github.com/wxops/wxops-portal-v2/internal/cluster"
)

func TestArgoAppName(t *testing.T) {
	tests := []struct {
		name           string
		team, app, env string
		want           string
	}{
		{name: "dev", team: "rocket-team", app: "rocket-api", env: "dev", want: "rocket-team-rocket-api-dev"},
		{name: "staging", team: "rocket-team", app: "rocket-api", env: "staging", want: "rocket-team-rocket-api-staging"},
		{name: "production", team: "rocket-team", app: "rocket-api", env: "production", want: "rocket-team-rocket-api-production"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := argoAppName(tt.team, tt.app, tt.env); got != tt.want {
				t.Errorf("argoAppName(%q, %q, %q) = %q, want %q", tt.team, tt.app, tt.env, got, tt.want)
			}
		})
	}
}

func TestXrName(t *testing.T) {
	tests := []struct {
		name           string
		team, app, env string
		want           string
	}{
		{name: "dev uses base XR unchanged", team: "rocket-team", app: "rocket-api", env: "dev", want: "rocket-team-rocket-api"},
		{name: "staging is renamed", team: "rocket-team", app: "rocket-api", env: "staging", want: "rocket-team-rocket-api-staging"},
		{name: "production is renamed", team: "rocket-team", app: "rocket-api", env: "production", want: "rocket-team-rocket-api-production"},
		{name: "unknown env falls back to base like dev", team: "rocket-team", app: "rocket-api", env: "qa", want: "rocket-team-rocket-api"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := xrName(tt.team, tt.app, tt.env); got != tt.want {
				t.Errorf("xrName(%q, %q, %q) = %q, want %q", tt.team, tt.app, tt.env, got, tt.want)
			}
		})
	}
}

func TestUnavailableReason(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want string
	}{
		{name: "forbidden maps to forbidden", err: cluster.ErrForbidden, want: "forbidden"},
		{name: "wrapped forbidden still maps via errors.Is", err: fmt.Errorf("reading application: %w", cluster.ErrForbidden), want: "forbidden"},
		{name: "not found maps to not-found", err: cluster.ErrNotFound, want: "not-found"},
		{name: "anything else maps to unreachable", err: errors.New("connection refused"), want: "unreachable"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := unavailableReason(tt.err); got != tt.want {
				t.Errorf("unavailableReason(%v) = %q, want %q", tt.err, got, tt.want)
			}
		})
	}
}

func TestShortRevision(t *testing.T) {
	tests := []struct {
		name string
		rev  string
		want string
	}{
		{name: "full 40-char sha trimmed to 7", rev: "abc1234567890abcdef1234567890abcdef1234", want: "abc1234"},
		{name: "already-short sha left untouched", rev: "abc1234", want: "abc1234"},
		{name: "shorter than 7 left untouched", rev: "abc12", want: "abc12"},
		{name: "branch name left untouched (contains a slash)", rev: "refs/heads/develop-branch-name", want: "refs/heads/develop-branch-name"},
		{name: "revision with a dot left untouched", rev: "v1.2.3-something-long-tag", want: "v1.2.3-something-long-tag"},
		{name: "empty string untouched", rev: "", want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := shortRevision(tt.rev); got != tt.want {
				t.Errorf("shortRevision(%q) = %q, want %q", tt.rev, got, tt.want)
			}
		})
	}
}
