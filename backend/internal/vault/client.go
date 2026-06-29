package vault

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client writes secrets to a Vault KV v2 engine.
// It only supports create/update — no read or delete.
type Client struct {
	addr       string // e.g. "https://vault.example.com"
	token      string
	kvMount    string // e.g. "secret" — the KV v2 mount path
	httpClient *http.Client
}

// New creates a Vault client.
func New(addr, token, kvMount string) *Client {
	if kvMount == "" {
		kvMount = "secret"
	}
	return &Client{
		addr:       addr,
		token:      token,
		kvMount:    kvMount,
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

// WriteSecret creates or updates a secret at the given path.
// data is a map of key-value pairs to store.
// Vault KV v2 API: PUT /v1/{mount}/data/{path}
func (c *Client) WriteSecret(ctx context.Context, path string, data map[string]string) error {
	apiURL := fmt.Sprintf("%s/v1/%s/data/%s", c.addr, c.kvMount, path)

	payload := map[string]any{
		"data": data,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("vault: marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, apiURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("vault: build request: %w", err)
	}
	req.Header.Set("X-Vault-Token", c.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("vault: request %s: %w", path, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("vault: PUT %s returned %d: %s", path, resp.StatusCode, respBody)
	}
	return nil
}
