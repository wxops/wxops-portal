package client

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type Credentials struct {
	PortalURL string `json:"portal_url"`
	Token     string `json:"token"`
}

func credentialsPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".wxops", "credentials.json"), nil
}

func LoadCredentials() (*Credentials, error) {
	// WXOPS_TOKEN env var overrides stored credentials (for CI/CD use).
	if tok := os.Getenv("WXOPS_TOKEN"); tok != "" {
		portal := os.Getenv("WXOPS_PORTAL_URL")
		if portal == "" {
			return nil, fmt.Errorf("WXOPS_PORTAL_URL must be set when using WXOPS_TOKEN")
		}
		return &Credentials{PortalURL: portal, Token: tok}, nil
	}

	path, err := credentialsPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("not logged in — run `wxops login --portal <url>` first")
		}
		return nil, err
	}
	var creds Credentials
	if err := json.Unmarshal(data, &creds); err != nil {
		return nil, fmt.Errorf("corrupted credentials file — run `wxops login` again")
	}
	return &creds, nil
}

func SaveCredentials(creds *Credentials) error {
	path, err := credentialsPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(creds, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}
