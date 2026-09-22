package handlers

import "testing"

func TestGroupToTenant(t *testing.T) {
	tests := []struct {
		name  string
		group string
		want  string
	}{
		{name: "org:team resolves to org", group: "wxops:rocket-team", want: "wxops"},
		{name: "org:Managers resolves to the same org as any other sub-team", group: "wxops:Managers", want: "wxops"},
		{name: "different team, same org, same tenant", group: "wxops:platform-team", want: "wxops"},
		{name: "no colon is skipped", group: "rocket-team", want: ""},
		{name: "empty org before colon is skipped", group: ":rocket-team", want: ""},
		{name: "system-prefixed org is skipped", group: "system:masters", want: ""},
		{name: "system-prefixed org without colon suffix still skipped", group: "systemwide:admins", want: ""},
		{name: "empty string is skipped", group: "", want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := groupToTenant(tt.group); got != tt.want {
				t.Errorf("groupToTenant(%q) = %q, want %q", tt.group, got, tt.want)
			}
		})
	}
}

func TestSessionIsPlatform(t *testing.T) {
	tests := []struct {
		name   string
		groups []string
		want   bool
	}{
		{name: "plain platform-team", groups: []string{"platform-team"}, want: true},
		{name: "gitea org:platform-team form", groups: []string{"wxops:platform-team"}, want: true},
		{name: "case-insensitive match", groups: []string{"wxops:Platform-Team"}, want: true},
		{name: "tenant team only is not platform", groups: []string{"wxops:rocket-team"}, want: false},
		{name: "no groups is not platform", groups: nil, want: false},
		{name: "platform-team among several groups", groups: []string{"wxops:rocket-team", "platform-team"}, want: true},
		{name: "substring is not a match", groups: []string{"wxops:not-platform-team-really"}, want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := sessionIsPlatform(tt.groups); got != tt.want {
				t.Errorf("sessionIsPlatform(%v) = %v, want %v", tt.groups, got, tt.want)
			}
		})
	}
}
