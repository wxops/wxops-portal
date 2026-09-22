package client

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return New(&Credentials{PortalURL: srv.URL, Token: "test-token"})
}

func TestNew_TrimsTrailingSlashFromPortalURL(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Write([]byte(`{"entities":[],"total":0}`))
	}))
	defer srv.Close()

	c := New(&Credentials{PortalURL: srv.URL + "/", Token: "tok"})
	if _, err := c.ListEntities("", ""); err != nil {
		t.Fatalf("ListEntities() error = %v", err)
	}
	if gotPath != "/api/v1/catalog/entities" {
		t.Errorf("request path = %q, want /api/v1/catalog/entities (no double slash)", gotPath)
	}
}

func TestGet_SendsSessionCookieAndAcceptHeader(t *testing.T) {
	var gotCookie, gotAccept string
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotCookie = r.Header.Get("Cookie")
		gotAccept = r.Header.Get("Accept")
		w.Write([]byte(`{"entities":[],"total":0}`))
	})
	if _, err := c.ListEntities("", ""); err != nil {
		t.Fatalf("ListEntities() error = %v", err)
	}
	if gotCookie != "wxops_session=test-token" {
		t.Errorf("Cookie header = %q, want wxops_session=test-token", gotCookie)
	}
	if gotAccept != "application/json" {
		t.Errorf("Accept header = %q, want application/json", gotAccept)
	}
}

func TestGet_401ReturnsFriendlyReloginError(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	})
	_, err := c.ListEntities("", "")
	if err == nil {
		t.Fatal("ListEntities() error = nil, want an error")
	}
	if !strings.Contains(err.Error(), "wxops login") {
		t.Errorf("error = %q, want it to suggest re-running wxops login", err.Error())
	}
}

func TestGet_4xxErrorIncludesBody(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("entity not found"))
	})
	_, err := c.GetEntity("Component", "missing")
	if err == nil {
		t.Fatal("GetEntity() error = nil, want an error")
	}
	if !strings.Contains(err.Error(), "entity not found") || !strings.Contains(err.Error(), "404") {
		t.Errorf("error = %q, want it to include status 404 and the body", err.Error())
	}
}

func TestListEntities_BuildsQueryParams(t *testing.T) {
	var gotQuery string
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		w.Write([]byte(`{"entities":[],"total":0}`))
	})
	if _, err := c.ListEntities("Component", "production"); err != nil {
		t.Fatalf("ListEntities() error = %v", err)
	}
	if gotQuery != "kind=Component&lifecycle=production" {
		t.Errorf("query = %q, want kind=Component&lifecycle=production", gotQuery)
	}
}

func TestGetEntity_ParsesResponse(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(Entity{Kind: "Component", Spec: struct {
			Owner     string `json:"owner"`
			Lifecycle string `json:"lifecycle"`
			Type      string `json:"type"`
		}{Owner: "group:rocket-team", Lifecycle: "production", Type: "service"}})
	})
	e, err := c.GetEntity("Component", "rocket-api")
	if err != nil {
		t.Fatalf("GetEntity() error = %v", err)
	}
	if e.Spec.Owner != "group:rocket-team" || e.Spec.Lifecycle != "production" {
		t.Errorf("GetEntity() = %+v, unexpected", e)
	}
}

func TestLatestVersion_ParsesVersionField(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"version":"v0.5.1"}`))
	})
	v, err := c.LatestVersion()
	if err != nil {
		t.Fatalf("LatestVersion() error = %v", err)
	}
	if v != "v0.5.1" {
		t.Errorf("LatestVersion() = %q, want v0.5.1", v)
	}
}

func TestDownloadCLI_ReturnsBodyAndContentLength(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/cli/download/linux-amd64" {
			t.Errorf("unexpected download path %q", r.URL.Path)
		}
		w.Header().Set("Content-Length", "7")
		w.Write([]byte("binary!"))
	})
	body, n, err := c.DownloadCLI("linux-amd64")
	if err != nil {
		t.Fatalf("DownloadCLI() error = %v", err)
	}
	defer body.Close()
	if n != 7 {
		t.Errorf("contentLength = %d, want 7", n)
	}
}

func TestDownloadCLI_401(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	})
	_, _, err := c.DownloadCLI("linux-amd64")
	if err == nil {
		t.Fatal("DownloadCLI() error = nil, want error")
	}
}
