package commands

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/wxops/wxops-cli/internal/client"
)

func entityServer(t *testing.T, owner string) *client.Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(struct {
			Kind     string `json:"kind"`
			Metadata struct {
				Name string `json:"name"`
			} `json:"metadata"`
			Spec struct {
				Owner string `json:"owner"`
			} `json:"spec"`
		}{
			Kind: "Component",
			Metadata: struct {
				Name string `json:"name"`
			}{Name: "rocket-api"},
			Spec: struct {
				Owner string `json:"owner"`
			}{Owner: owner},
		})
	}))
	t.Cleanup(srv.Close)
	return client.New(&client.Credentials{PortalURL: srv.URL, Token: "tok"})
}

func TestResolveTarget(t *testing.T) {
	t.Run("regular org maps to tenant-{org} namespace, dev deployment has no env suffix", func(t *testing.T) {
		c := entityServer(t, "group:rocket-team")
		ns, deploy, err := resolveTarget(c, "rocket-api", "dev", "", "")
		if err != nil {
			t.Fatalf("resolveTarget() error = %v", err)
		}
		if ns != "tenant-rocket-team" {
			t.Errorf("ns = %q, want tenant-rocket-team", ns)
		}
		if deploy != "rocket-api-darlane" {
			t.Errorf("deploy = %q, want rocket-api-darlane", deploy)
		}
	})

	t.Run("platform-team org maps to the platform namespace", func(t *testing.T) {
		c := entityServer(t, "group:platform-team")
		ns, _, err := resolveTarget(c, "rocket-api", "dev", "", "")
		if err != nil {
			t.Fatalf("resolveTarget() error = %v", err)
		}
		if ns != "platform" {
			t.Errorf("ns = %q, want platform (matches wxops debug's derivation)", ns)
		}
	})

	t.Run("non-dev env suffixes the deployment name", func(t *testing.T) {
		c := entityServer(t, "group:rocket-team")
		_, deploy, err := resolveTarget(c, "rocket-api", "staging", "", "")
		if err != nil {
			t.Fatalf("resolveTarget() error = %v", err)
		}
		if deploy != "rocket-api-staging-darlane" {
			t.Errorf("deploy = %q, want rocket-api-staging-darlane", deploy)
		}
	})

	t.Run("empty env behaves like dev", func(t *testing.T) {
		c := entityServer(t, "group:rocket-team")
		_, deploy, err := resolveTarget(c, "rocket-api", "", "", "")
		if err != nil {
			t.Fatalf("resolveTarget() error = %v", err)
		}
		if deploy != "rocket-api-darlane" {
			t.Errorf("deploy = %q, want rocket-api-darlane", deploy)
		}
	})

	t.Run("explicit overrides win over derived values", func(t *testing.T) {
		c := entityServer(t, "group:rocket-team")
		ns, deploy, err := resolveTarget(c, "rocket-api", "dev", "custom-ns", "custom-deploy")
		if err != nil {
			t.Fatalf("resolveTarget() error = %v", err)
		}
		if ns != "custom-ns" || deploy != "custom-deploy" {
			t.Errorf("ns/deploy = %q/%q, want custom-ns/custom-deploy", ns, deploy)
		}
	})
}

func TestIsExcluded(t *testing.T) {
	sep := string(filepath.Separator)
	tests := []struct {
		name     string
		path     string
		excludes []string
		want     bool
	}{
		{name: "direct component match", path: "src" + sep + "node_modules", excludes: []string{"node_modules"}, want: true},
		{name: "nested path component match", path: "src" + sep + "node_modules" + sep + "pkg" + sep + "index.js", excludes: []string{"node_modules"}, want: true},
		{name: "glob pattern match", path: "src" + sep + "main.pyc", excludes: []string{"*.pyc"}, want: true},
		{name: "no match", path: "src" + sep + "main.go", excludes: []string{"node_modules", "*.pyc"}, want: false},
		{name: "path ending in excluded dir (no trailing content)", path: "project" + sep + "vendor", excludes: []string{"vendor"}, want: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isExcluded(tt.path, tt.excludes); got != tt.want {
				t.Errorf("isExcluded(%q, %v) = %v, want %v", tt.path, tt.excludes, got, tt.want)
			}
		})
	}
}

func TestCollectAllFiles(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "node_modules"), 0o755)
	os.WriteFile(filepath.Join(dir, "node_modules", "pkg.js"), []byte("x"), 0o644)
	os.WriteFile(filepath.Join(dir, "main.go"), []byte("package main"), 0o644)
	os.MkdirAll(filepath.Join(dir, "src"), 0o755)
	os.WriteFile(filepath.Join(dir, "src", "app.go"), []byte("package src"), 0o644)

	got := collectAllFiles(dir, []string{"node_modules"})

	wantMain := filepath.Join(dir, "main.go")
	wantApp := filepath.Join(dir, "src", "app.go")
	foundMain, foundApp, foundExcluded := false, false, false
	for _, f := range got {
		switch f {
		case wantMain:
			foundMain = true
		case wantApp:
			foundApp = true
		}
		if filepath.Base(filepath.Dir(f)) == "node_modules" {
			foundExcluded = true
		}
	}
	if !foundMain || !foundApp {
		t.Errorf("collectAllFiles() = %v, missing expected files (main.go, src/app.go)", got)
	}
	if foundExcluded {
		t.Error("collectAllFiles() included a file under the excluded node_modules directory")
	}
}

func TestIsTerminal(t *testing.T) {
	t.Run("NO_COLOR forces false", func(t *testing.T) {
		t.Setenv("NO_COLOR", "1")
		f, err := os.CreateTemp(t.TempDir(), "out")
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		if isTerminal(f) {
			t.Error("isTerminal() = true with NO_COLOR set, want false")
		}
	})

	t.Run("non-file writer is never a terminal", func(t *testing.T) {
		t.Setenv("NO_COLOR", "")
		t.Setenv("TERM", "xterm")
		var buf stringWriter
		if isTerminal(&buf) {
			t.Error("isTerminal() = true for a non-*os.File writer, want false")
		}
	})

	t.Run("regular file is not a character device", func(t *testing.T) {
		t.Setenv("NO_COLOR", "")
		t.Setenv("TERM", "xterm")
		f, err := os.CreateTemp(t.TempDir(), "out")
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		if isTerminal(f) {
			t.Error("isTerminal() = true for a plain temp file, want false")
		}
	})
}

type stringWriter struct{ data []byte }

func (s *stringWriter) Write(p []byte) (int, error) {
	s.data = append(s.data, p...)
	return len(p), nil
}

func TestWithRetry(t *testing.T) {
	t.Run("succeeds on first try: recovered is false", func(t *testing.T) {
		calls := 0
		recovered, err := withRetry(func() error {
			calls++
			return nil
		}, 3, time.Millisecond, func(int) {})
		if err != nil || recovered {
			t.Errorf("withRetry() = (%v, %v), want (false, nil)", recovered, err)
		}
		if calls != 1 {
			t.Errorf("op called %d times, want 1", calls)
		}
	})

	t.Run("succeeds after failures: recovered is true", func(t *testing.T) {
		calls := 0
		warnCalls := 0
		recovered, err := withRetry(func() error {
			calls++
			if calls < 3 {
				return errors.New("transient")
			}
			return nil
		}, 5, time.Millisecond, func(int) { warnCalls++ })
		if err != nil {
			t.Fatalf("withRetry() error = %v, want nil", err)
		}
		if !recovered {
			t.Error("recovered = false, want true after failing then succeeding")
		}
		if warnCalls != 2 {
			t.Errorf("warn called %d times, want 2 (once per failed attempt)", warnCalls)
		}
	})

	t.Run("exhausts attempts and returns the last error", func(t *testing.T) {
		calls := 0
		_, err := withRetry(func() error {
			calls++
			return errors.New("always fails")
		}, 3, time.Millisecond, func(int) {})
		if err == nil {
			t.Fatal("withRetry() error = nil, want error after exhausting attempts")
		}
		if calls != 3 {
			t.Errorf("op called %d times, want 3", calls)
		}
	})
}

func TestDarlaneSessionRoundTrip(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	want := darlaneSession{Local: "./src", Remote: "/app/src", Excludes: []string{"*.log"}}
	saveDarlaneSession("rocket-api", "dev", want)

	got := loadDarlaneSession("rocket-api", "dev")
	if got == nil {
		t.Fatal("loadDarlaneSession() = nil, want the saved session")
	}
	if got.Local != want.Local || got.Remote != want.Remote || len(got.Excludes) != 1 {
		t.Errorf("loadDarlaneSession() = %+v, want %+v", got, want)
	}
}

func TestLoadDarlaneSession_MissingFileReturnsNil(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	if got := loadDarlaneSession("no-such-service", "dev"); got != nil {
		t.Errorf("loadDarlaneSession() = %+v, want nil for a service with no saved session", got)
	}
}
