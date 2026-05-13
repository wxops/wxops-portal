package cluster

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// ClusterCredential holds the short-lived mTLS client certificate issued by
// the Pinniped Concierge via a TokenCredentialRequest.  The certificate
// embeds the user's Kubernetes identity (username + groups) and is typically
// valid for 5–15 minutes.
type ClusterCredential struct {
	ExpirationTimestamp   time.Time `json:"expiration_timestamp"`
	ClientCertificateData string    `json:"client_certificate_data"` // PEM
	ClientKeyData         string    `json:"client_key_data"`         // PEM
}

// RequestConciergeCredential posts a TokenCredentialRequest to the Pinniped
// Concierge aggregated API on the spoke cluster and returns the resulting mTLS
// client certificate.
//
// clusterScopedToken must be a cluster-scoped id_token obtained via
// ExchangeForClusterToken (RFC 8693 exchange against the Supervisor).
// The CA used to verify the Concierge TLS endpoint is taken from info.CABundle
// (set via ca_bundle_file in clusters.json).
//
// The Concierge endpoint requires no prior authentication — the token itself
// is the credential being validated.
func RequestConciergeCredential(ctx context.Context, info *ClusterInfo, clusterScopedToken string) (*ClusterCredential, error) {
	if info.JWTAuthenticatorName == "" {
		return nil, fmt.Errorf("cluster %q: jwt_authenticator_name not configured — set the annotation or static config field", info.ID)
	}

	httpClient, err := buildSpokeHTTPClient(info)
	if err != nil {
		return nil, err
	}

	reqBody := map[string]any{
		"apiVersion": "login.concierge.pinniped.dev/v1alpha1",
		"kind":       "TokenCredentialRequest",
		"spec": map[string]any{
			"token": clusterScopedToken,
			"authenticator": map[string]any{
				"apiGroup": "authentication.concierge.pinniped.dev",
				"kind":     "JWTAuthenticator",
				"name":     info.JWTAuthenticatorName,
			},
		},
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal TokenCredentialRequest: %w", err)
	}

	url := info.APIServer + "/apis/login.concierge.pinniped.dev/v1alpha1/tokencredentialrequests"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("concierge request to %s: %w", info.APIServer, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read concierge response: %w", err)
	}

	// Concierge returns 201 Created on success, but accept 200 as well.
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("concierge returned HTTP %d: %s", resp.StatusCode, body)
	}

	var result struct {
		Status struct {
			Credential *struct {
				ExpirationTimestamp   string `json:"expirationTimestamp"`
				ClientCertificateData string `json:"clientCertificateData"`
				ClientKeyData         string `json:"clientKeyData"`
			} `json:"credential"`
			Message string `json:"message"`
		} `json:"status"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parse concierge response: %w", err)
	}
	if result.Status.Credential == nil {
		return nil, fmt.Errorf("concierge rejected request: %s", result.Status.Message)
	}

	expiry, _ := time.Parse(time.RFC3339, result.Status.Credential.ExpirationTimestamp)
	return &ClusterCredential{
		ExpirationTimestamp:   expiry,
		ClientCertificateData: result.Status.Credential.ClientCertificateData,
		ClientKeyData:         result.Status.Credential.ClientKeyData,
	}, nil
}

// buildSpokeHTTPClient creates an *http.Client that trusts the cluster's CA
// bundle (from ca_bundle_file in clusters.json).
func buildSpokeHTTPClient(info *ClusterInfo) (*http.Client, error) {
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if len(info.CABundle) > 0 {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(info.CABundle) {
			return nil, fmt.Errorf("cluster %q: no valid PEM certs in CA bundle", info.ID)
		}
		tlsCfg.RootCAs = pool
	}
	return &http.Client{Transport: &http.Transport{TLSClientConfig: tlsCfg}}, nil
}
