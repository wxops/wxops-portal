package handlers

import "testing"

func TestParseArgoCDSourceTag(t *testing.T) {
	tests := []struct {
		name string
		data string
		want string
	}{
		{
			name: "well-formed kustomization images block",
			data: "kustomize:\n  images:\n  - registry.example.com/wxops/rocket-api=registry.example.com/wxops/rocket-api:v1.2.3\n",
			want: "v1.2.3",
		},
		{
			name: "dev tag with embedded timestamp and sha",
			data: "kustomize:\n  images:\n  - repo=repo:dev-2026-07-02_06-29-42-abc1234\n",
			want: "dev-2026-07-02_06-29-42-abc1234",
		},
		{
			name: "no images entries",
			data: "kustomize:\n  images: []\n",
			want: "",
		},
		{
			name: "no kustomize key at all",
			data: "apiVersion: v1\n",
			want: "",
		},
		{
			name: "malformed yaml",
			data: "not: [valid, yaml",
			want: "",
		},
		{
			name: "entry with no equals sign",
			data: "kustomize:\n  images:\n  - repo:tag\n",
			want: "",
		},
		{
			name: "entry with no colon after equals has no tag",
			data: "kustomize:\n  images:\n  - repo=repo\n",
			want: "",
		},
		{
			name: "empty input",
			data: "",
			want: "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := parseArgoCDSourceTag([]byte(tt.data)); got != tt.want {
				t.Errorf("parseArgoCDSourceTag(%q) = %q, want %q", tt.data, got, tt.want)
			}
		})
	}
}

func TestExtractDateFromDevTag(t *testing.T) {
	tests := []struct {
		name string
		tag  string
		want string
	}{
		{
			name: "well-formed dev tag",
			tag:  "dev-2026-07-02_06-29-42-abc1234",
			want: "2026-07-02T06:29:42Z",
		},
		{
			name: "release tag has no timestamp",
			tag:  "v1.2.3",
			want: "",
		},
		{
			name: "release candidate tag has no timestamp",
			tag:  "v1.2.3-rc1",
			want: "",
		},
		{
			name: "missing dev- prefix",
			tag:  "2026-07-02_06-29-42-abc1234",
			want: "",
		},
		{
			name: "truncated timestamp",
			tag:  "dev-2026-07-02",
			want: "",
		},
		{
			name: "malformed timestamp segment",
			tag:  "dev-2026-99-99_99-99-99-abc1234",
			want: "",
		},
		{
			name: "empty tag",
			tag:  "",
			want: "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := extractDateFromDevTag(tt.tag); got != tt.want {
				t.Errorf("extractDateFromDevTag(%q) = %q, want %q", tt.tag, got, tt.want)
			}
		})
	}
}
