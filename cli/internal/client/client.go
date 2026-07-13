package client

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type Client struct {
	baseURL    string
	token      string
	httpClient *http.Client
}

func New(creds *Credentials) *Client {
	return &Client{
		baseURL:    strings.TrimRight(creds.PortalURL, "/"),
		token:      creds.Token,
		httpClient: &http.Client{},
	}
}

func (c *Client) get(path string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Cookie", "wxops_session="+c.token)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("portal unreachable: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("unauthorized — run `wxops login --portal %s` to refresh your token", c.baseURL)
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return body, nil
}

// Entity mirrors the catalog entity JSON shape for CLI display.
type Entity struct {
	Kind     string `json:"kind"`
	Metadata struct {
		Name        string            `json:"name"`
		Title       string            `json:"title"`
		Description string            `json:"description"`
		Annotations map[string]string `json:"annotations"`
	} `json:"metadata"`
	Spec struct {
		Owner     string `json:"owner"`
		Lifecycle string `json:"lifecycle"`
		Type      string `json:"type"`
	} `json:"spec"`
}

type EntitiesResponse struct {
	Entities []Entity `json:"entities"`
	Total    int      `json:"total"`
}

func (c *Client) ListEntities(kind, lifecycle string) ([]Entity, error) {
	path := "/api/v1/catalog/entities"
	params := []string{}
	if kind != "" {
		params = append(params, "kind="+kind)
	}
	if lifecycle != "" {
		params = append(params, "lifecycle="+lifecycle)
	}
	if len(params) > 0 {
		path += "?" + strings.Join(params, "&")
	}

	body, err := c.get(path)
	if err != nil {
		return nil, err
	}
	var resp EntitiesResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unexpected response format: %w", err)
	}
	return resp.Entities, nil
}

func (c *Client) GetEntity(kind, name string) (*Entity, error) {
	body, err := c.get(fmt.Sprintf("/api/v1/catalog/entities/%s/%s", kind, name))
	if err != nil {
		return nil, err
	}
	var entity Entity
	if err := json.Unmarshal(body, &entity); err != nil {
		return nil, fmt.Errorf("unexpected response format: %w", err)
	}
	return &entity, nil
}

// PromoStatusOverlay is the per-environment slice of the promostatus response.
type PromoStatusOverlay struct {
	Exists         bool `json:"exists"`
	DarlaneEnabled bool `json:"darlaneEnabled"`
}

// PromoStatus mirrors the /promostatus API response fields used by the CLI.
type PromoStatus struct {
	Lifecycle string `json:"lifecycle"`
	Overlays  struct {
		Dev        PromoStatusOverlay `json:"dev"`
		Staging    PromoStatusOverlay `json:"staging"`
		Production PromoStatusOverlay `json:"production"`
	} `json:"overlays"`
}

func (c *Client) GetPromoStatus(kind, name string) (*PromoStatus, error) {
	body, err := c.get(fmt.Sprintf("/api/v1/catalog/entities/%s/%s/promostatus", kind, name))
	if err != nil {
		return nil, err
	}
	var status PromoStatus
	if err := json.Unmarshal(body, &status); err != nil {
		return nil, fmt.Errorf("unexpected response format: %w", err)
	}
	return &status, nil
}
