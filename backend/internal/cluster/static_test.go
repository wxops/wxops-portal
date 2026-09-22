package cluster

import (
	"context"
	"encoding/base64"
	"os"
	"testing"
)

func TestResolveStaticCA(t *testing.T) {
	t.Run("all empty trusts the system pool (nil, no error)", func(t *testing.T) {
		ca, err := resolveStaticCA("", "", "")
		if err != nil {
			t.Fatalf("resolveStaticCA() error = %v", err)
		}
		if ca != nil {
			t.Errorf("resolveStaticCA() = %v, want nil", ca)
		}
	})

	t.Run("inline PEM with literal \\n is unescaped", func(t *testing.T) {
		ca, err := resolveStaticCA("", "", `-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----`)
		if err != nil {
			t.Fatalf("resolveStaticCA() error = %v", err)
		}
		want := "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----"
		if string(ca) != want {
			t.Errorf("resolveStaticCA() = %q, want %q", ca, want)
		}
	})

	t.Run("standard base64 is decoded", func(t *testing.T) {
		raw := "hello-ca-bundle"
		encoded := base64.StdEncoding.EncodeToString([]byte(raw))
		ca, err := resolveStaticCA("", encoded, "")
		if err != nil {
			t.Fatalf("resolveStaticCA() error = %v", err)
		}
		if string(ca) != raw {
			t.Errorf("resolveStaticCA() = %q, want %q", ca, raw)
		}
	})

	t.Run("unpadded raw-std base64 falls back correctly", func(t *testing.T) {
		raw := "hello-ca-bundle-x" // length chosen so std encoding needs padding
		encoded := base64.RawStdEncoding.EncodeToString([]byte(raw))
		ca, err := resolveStaticCA("", encoded, "")
		if err != nil {
			t.Fatalf("resolveStaticCA() error = %v", err)
		}
		if string(ca) != raw {
			t.Errorf("resolveStaticCA() = %q, want %q", ca, raw)
		}
	})

	t.Run("invalid base64 in both encodings is an error", func(t *testing.T) {
		_, err := resolveStaticCA("", "not valid base64!!!", "")
		if err == nil {
			t.Error("resolveStaticCA() error = nil, want error for invalid base64")
		}
	})

	t.Run("file path takes priority over base64 and inline", func(t *testing.T) {
		dir := t.TempDir()
		path := dir + "/ca.pem"
		if err := os.WriteFile(path, []byte("file-contents"), 0o600); err != nil {
			t.Fatalf("os.WriteFile: %v", err)
		}
		ca, err := resolveStaticCA(path, "aWdub3JlZA==", "ignored")
		if err != nil {
			t.Fatalf("resolveStaticCA() error = %v", err)
		}
		if string(ca) != "file-contents" {
			t.Errorf("resolveStaticCA() = %q, want file-contents", ca)
		}
	})

	t.Run("missing file path is an error", func(t *testing.T) {
		_, err := resolveStaticCA("/nonexistent/path/ca.pem", "", "")
		if err == nil {
			t.Error("resolveStaticCA() error = nil, want error for missing file")
		}
	})
}

func TestNewStaticRegistry(t *testing.T) {
	t.Run("inline JSON with two clusters", func(t *testing.T) {
		inline := `{"clusters":[
			{"id":"dev","name":"Dev Cluster","api_server":"https://dev.example.com:6443"},
			{"id":"","name":"","api_server":"https://staging.example.com:6443"}
		]}`
		reg, err := NewStaticRegistry("", inline)
		if err != nil {
			t.Fatalf("NewStaticRegistry() error = %v", err)
		}
		clusters, err := reg.ListClusters(context.Background())
		if err != nil {
			t.Fatalf("ListClusters() error = %v", err)
		}
		if len(clusters) != 2 {
			t.Fatalf("ListClusters() = %d clusters, want 2", len(clusters))
		}
		if clusters[0].ID != "dev" || clusters[0].Name != "Dev Cluster" {
			t.Errorf("clusters[0] = %+v, want id=dev name='Dev Cluster'", clusters[0])
		}
		// Second cluster has no id/name — both should fall back to the api_server-derived empty id chain:
		// id falls back to Name ("") then name falls back to id (""), so both stay empty strings.
		if clusters[1].ID != "" || clusters[1].Name != "" {
			t.Errorf("clusters[1] = %+v, want empty id/name when neither is set", clusters[1])
		}
	})

	t.Run("missing api_server is an error", func(t *testing.T) {
		_, err := NewStaticRegistry("", `{"clusters":[{"id":"dev"}]}`)
		if err == nil {
			t.Error("NewStaticRegistry() error = nil, want error for missing api_server")
		}
	})

	t.Run("neither file nor inline is an error", func(t *testing.T) {
		_, err := NewStaticRegistry("", "")
		if err == nil {
			t.Error("NewStaticRegistry() error = nil, want error when neither source is set")
		}
	})

	t.Run("GetCluster finds by id, errors when absent", func(t *testing.T) {
		reg, err := NewStaticRegistry("", `{"clusters":[{"id":"dev","api_server":"https://dev.example.com"}]}`)
		if err != nil {
			t.Fatalf("NewStaticRegistry() error = %v", err)
		}
		got, err := reg.GetCluster(context.Background(), "dev")
		if err != nil {
			t.Fatalf("GetCluster(dev) error = %v", err)
		}
		if got.ID != "dev" {
			t.Errorf("GetCluster(dev).ID = %q, want dev", got.ID)
		}
		if _, err := reg.GetCluster(context.Background(), "missing"); err == nil {
			t.Error("GetCluster(missing) error = nil, want error")
		}
	})
}
