package cluster

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestSecretToCluster(t *testing.T) {
	t.Run("full annotation set", func(t *testing.T) {
		s := &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "cluster-a",
				Namespace: "wxops-system",
				Annotations: map[string]string{
					"wxops.cloud/cluster-id":                 "prod-a",
					"wxops.cloud/cluster-name":               "Production A",
					"wxops.cloud/jwt-authenticator-audience": "prod-a-aud",
					"wxops.cloud/jwt-authenticator-name":     "prod-a-jwt",
					"wxops.cloud/issuer-url":                 "https://supervisor.example.com",
					"wxops.cloud/concierge-endpoint":         "https://concierge.example.com",
					"wxops.cloud/upstream-idp-name":          "gitea",
					"wxops.cloud/upstream-idp-type":          "oidc",
				},
			},
			Data: map[string][]byte{
				"api-server": []byte("https://prod-a.example.com:6443"),
				"ca-bundle":  []byte("-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----"),
			},
		}
		got, err := secretToCluster(s)
		if err != nil {
			t.Fatalf("secretToCluster() error = %v", err)
		}
		if got.ID != "prod-a" || got.Name != "Production A" {
			t.Errorf("ID/Name = %q/%q, want prod-a/Production A", got.ID, got.Name)
		}
		if got.APIServer != "https://prod-a.example.com:6443" {
			t.Errorf("APIServer = %q", got.APIServer)
		}
		if got.Audience != "prod-a-aud" {
			t.Errorf("Audience = %q, want prod-a-aud", got.Audience)
		}
	})

	t.Run("missing annotations fall back to secret name", func(t *testing.T) {
		s := &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{Name: "cluster-b", Namespace: "wxops-system"},
			Data:       map[string][]byte{"api-server": []byte("https://cluster-b.example.com")},
		}
		got, err := secretToCluster(s)
		if err != nil {
			t.Fatalf("secretToCluster() error = %v", err)
		}
		if got.ID != "cluster-b" {
			t.Errorf("ID = %q, want cluster-b (fallback to secret name)", got.ID)
		}
		if got.Name != "cluster-b" {
			t.Errorf("Name = %q, want cluster-b (fallback to id)", got.Name)
		}
	})

	t.Run("missing api-server key is an error", func(t *testing.T) {
		s := &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{Name: "cluster-c", Namespace: "wxops-system"},
			Data:       map[string][]byte{},
		}
		if _, err := secretToCluster(s); err == nil {
			t.Error("secretToCluster() error = nil, want error for missing api-server key")
		}
	})
}
