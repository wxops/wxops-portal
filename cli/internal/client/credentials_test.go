package client

import (
	"testing"
)

func TestLoadCredentials_EnvVarOverridesStoredFile(t *testing.T) {
	t.Setenv("WXOPS_TOKEN", "env-token")
	t.Setenv("WXOPS_PORTAL_URL", "https://portal.example.com")

	creds, err := LoadCredentials()
	if err != nil {
		t.Fatalf("LoadCredentials() error = %v", err)
	}
	if creds.Token != "env-token" || creds.PortalURL != "https://portal.example.com" {
		t.Errorf("LoadCredentials() = %+v, want env-derived credentials", creds)
	}
}

func TestLoadCredentials_TokenWithoutPortalURLIsAnError(t *testing.T) {
	t.Setenv("WXOPS_TOKEN", "env-token")
	t.Setenv("WXOPS_PORTAL_URL", "")

	if _, err := LoadCredentials(); err == nil {
		t.Error("LoadCredentials() error = nil, want error when WXOPS_TOKEN is set without WXOPS_PORTAL_URL")
	}
}

func TestSaveAndLoadCredentials_RoundTrip(t *testing.T) {
	t.Setenv("WXOPS_TOKEN", "")
	t.Setenv("HOME", t.TempDir())

	want := &Credentials{PortalURL: "https://portal.example.com", Token: "saved-token"}
	if err := SaveCredentials(want); err != nil {
		t.Fatalf("SaveCredentials() error = %v", err)
	}

	got, err := LoadCredentials()
	if err != nil {
		t.Fatalf("LoadCredentials() error = %v", err)
	}
	if got.PortalURL != want.PortalURL || got.Token != want.Token {
		t.Errorf("LoadCredentials() = %+v, want %+v", got, want)
	}
}

func TestLoadCredentials_MissingFileGivesLoginHint(t *testing.T) {
	t.Setenv("WXOPS_TOKEN", "")
	t.Setenv("HOME", t.TempDir())

	_, err := LoadCredentials()
	if err == nil {
		t.Fatal("LoadCredentials() error = nil, want error when no credentials file exists")
	}
}
