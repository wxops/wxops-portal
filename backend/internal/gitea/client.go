// Package gitea provides a minimal read-only Gitea API client used by the
// service catalog to fetch catalog-info.yaml files from gitops-infra.
package gitea

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Client reads repository content from a Gitea instance.
type Client struct {
	baseURL    string
	token      string
	owner      string
	repo       string
	httpClient *http.Client
}

// New creates a Gitea client.
//
//	baseURL — Gitea instance URL, e.g. "https://gitea.example.com"
//	token   — personal access token with repository read scope
//	owner   — org or user that owns the repo
//	repo    — repository name, e.g. "gitops-infra"
func New(baseURL, token, owner, repo string) *Client {
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		token:      token,
		owner:      owner,
		repo:       repo,
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

// GetFile fetches and base64-decodes a file from the repository.
func (c *Client) GetFile(ctx context.Context, path string) ([]byte, error) {
	body, err := c.do(ctx, path)
	if err != nil {
		return nil, err
	}

	var entry struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal(body, &entry); err != nil {
		return nil, fmt.Errorf("gitea: decode file %q: %w", path, err)
	}

	// Gitea encodes file content as base64 with embedded newlines — strip them.
	decoded, err := base64.StdEncoding.DecodeString(
		strings.ReplaceAll(entry.Content, "\n", ""),
	)
	if err != nil {
		return nil, fmt.Errorf("gitea: base64 decode %q: %w", path, err)
	}
	return decoded, nil
}

// ListFiles returns the names of all files (not subdirectories) in a
// repository directory.  Returns nil without error when the directory does
// not exist so callers can treat a missing catalog subdirectory as empty.
func (c *Client) ListFiles(ctx context.Context, dirPath string) ([]string, error) {
	entries, err := c.listContents(ctx, dirPath)
	if err != nil {
		return nil, err
	}
	var files []string
	for _, e := range entries {
		if e.Type == "file" {
			files = append(files, e.Name)
		}
	}
	return files, nil
}

// ListDirs returns the names of all subdirectories in a repository directory.
// Returns nil without error when the directory does not exist.
func (c *Client) ListDirs(ctx context.Context, dirPath string) ([]string, error) {
	entries, err := c.listContents(ctx, dirPath)
	if err != nil {
		return nil, err
	}
	var dirs []string
	for _, e := range entries {
		if e.Type == "dir" {
			dirs = append(dirs, e.Name)
		}
	}
	return dirs, nil
}

// listContents fetches the directory listing from the Gitea contents API.
// Returns nil without error on 404 so callers treat missing paths as empty.
func (c *Client) listContents(ctx context.Context, dirPath string) ([]struct {
	Type string `json:"type"`
	Name string `json:"name"`
}, error) {
	body, err := c.do(ctx, dirPath)
	if err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, nil
		}
		return nil, err
	}

	var entries []struct {
		Type string `json:"type"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(body, &entries); err != nil {
		return nil, fmt.Errorf("gitea: decode dir %q: %w", dirPath, err)
	}
	return entries, nil
}

// FetchURL downloads raw file content from a Gitea source-view URL on this
// same Gitea instance, e.g.:
//
//	https://gitea.wxops.cloud/owner/repo/src/branch/main/openapi.yaml
//
// Returns nil, nil when the URL does not belong to this client's base URL or
// when the path pattern is not recognised, so callers can treat it as absent.
func (c *Client) FetchURL(ctx context.Context, gitURL string) ([]byte, error) {
	prefix := c.baseURL + "/"
	if !strings.HasPrefix(gitURL, prefix) {
		return nil, nil
	}
	// Convert the browser view URL to the raw-file URL.
	// /src/branch/<branch>/<path> → /raw/branch/<branch>/<path>
	rawURL := strings.Replace(gitURL, "/src/branch/", "/raw/branch/", 1)
	if rawURL == gitURL {
		return nil, nil // unrecognised URL shape
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("gitea: build request for %q: %w", rawURL, err)
	}
	if c.token != "" {
		req.Header.Set("Authorization", "token "+c.token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gitea: request %q: %w", rawURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("gitea: read body for %q: %w", rawURL, err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gitea: GET %q returned %d", rawURL, resp.StatusCode)
	}
	return body, nil
}

// do executes a GET request against the Gitea contents API and returns the
// raw response body.
func (c *Client) do(ctx context.Context, path string) ([]byte, error) {
	url := fmt.Sprintf("%s/api/v1/repos/%s/%s/contents/%s",
		c.baseURL, c.owner, c.repo, path)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("gitea: build request for %q: %w", path, err)
	}
	if c.token != "" {
		req.Header.Set("Authorization", "token "+c.token)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gitea: request %q: %w", path, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("gitea: read body for %q: %w", path, err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gitea: GET %q returned %d: %s", path, resp.StatusCode, body)
	}
	return body, nil
}
