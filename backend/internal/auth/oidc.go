// Package auth implements OIDC login via the Pinniped Supervisor using
// Authorization Code flow with PKCE (S256).
//
// The Pinniped Supervisor acts as the hub OIDC provider.  It federates
// upstream to Dex/Gitea and issues a single id_token that:
//   - Authenticates the user to the W'xOps Portal (portal session).
//   - Serves as a Bearer token for every spoke cluster whose Pinniped Concierge
//     is configured to validate tokens against this Supervisor.
//
// No per-cluster popup is required — one login covers all spokes.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// pkceState holds the PKCE code verifier for a single login attempt.
type pkceState struct {
	codeVerifier   string
	cliRedirectURI string // non-empty when login was initiated by the CLI
	returnTo       string // sanitised same-origin path to land on after login
	createdAt      time.Time
}

// LoginContext carries where the user should end up once the callback
// completes. It is captured at login time and stored server-side alongside the
// PKCE verifier, so the destination cannot be tampered with between the
// authorization redirect and the callback.
type LoginContext struct {
	// CLIRedirectURI is set when `wxops login` initiated the flow (localhost only).
	CLIRedirectURI string
	// ReturnTo is a same-origin path, already passed through SafeReturnPath.
	// Empty means "use the default landing page".
	ReturnTo string
}

// OIDCClient wraps the Pinniped Supervisor OIDC provider.
type OIDCClient struct {
	provider   *gooidc.Provider
	config     oauth2.Config
	verifier   *gooidc.IDTokenVerifier
	httpClient *http.Client // nil = default transport (system root pool)

	mu     sync.Mutex
	states map[string]*pkceState // keyed by OAuth2 state
}

// NewOIDCClient initialises an OIDC client via issuer discovery.
// issuerURL should be the Pinniped Supervisor FederationDomain issuer URL,
// e.g. "https://supervisor.example.com/providers/pinniped".
//
// tlsCfg may be nil — when nil the default system root pool is used (suitable
// for publicly trusted Supervisor certificates).  Pass a custom *tls.Config to
// trust a self-signed or private CA, or to disable verification in dev.
func NewOIDCClient(
	ctx context.Context,
	issuerURL, clientID, clientSecret, redirectURI string,
	scopes []string,
	tlsCfg *tls.Config,
) (*OIDCClient, error) {
	// Inject a custom HTTP client into the context when TLS customisation is
	// needed.  The coreos/go-oidc library reads oidc.ClientContext to pick up
	// the custom transport for both OIDC discovery and token verification.
	var customHTTPClient *http.Client
	if tlsCfg != nil {
		customHTTPClient = &http.Client{
			Transport: &http.Transport{TLSClientConfig: tlsCfg},
		}
		ctx = gooidc.ClientContext(ctx, customHTTPClient)
	}

	provider, err := gooidc.NewProvider(ctx, issuerURL)
	if err != nil {
		return nil, fmt.Errorf("OIDC discovery at %s: %w", issuerURL, err)
	}

	cfg := oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURL:  redirectURI,
		Endpoint:     provider.Endpoint(),
		Scopes:       scopes,
	}

	verifier := provider.Verifier(&gooidc.Config{ClientID: clientID})

	return &OIDCClient{
		provider:   provider,
		config:     cfg,
		verifier:   verifier,
		httpClient: customHTTPClient,
		states:     make(map[string]*pkceState),
	}, nil
}

// withClient injects the stored custom HTTP client into ctx so that
// oauth2 token exchange and OIDC token verification use the same TLS
// settings as the initial OIDC discovery request.
func (c *OIDCClient) withClient(ctx context.Context) context.Context {
	if c.httpClient == nil {
		return ctx
	}
	return gooidc.ClientContext(ctx, c.httpClient)
}

// StartLogin generates a PKCE code verifier, stores the state, and returns the
// authorization URL to redirect the browser to.
// cliRedirectURI is optional; when non-empty the Callback handler will redirect
// to it with ?token=<session> after login instead of going to the dashboard.
func (c *OIDCClient) StartLogin(lc LoginContext) (authURL string, err error) {
	state, err := randomBase64URL(16)
	if err != nil {
		return "", fmt.Errorf("generate state: %w", err)
	}

	verifier, err := randomBase64URL(32)
	if err != nil {
		return "", fmt.Errorf("generate code verifier: %w", err)
	}

	c.mu.Lock()
	// Evict stale states (older than 10 min) to prevent memory growth.
	for k, v := range c.states {
		if time.Since(v.createdAt) > 10*time.Minute {
			delete(c.states, k)
		}
	}
	c.states[state] = &pkceState{
		codeVerifier:   verifier,
		cliRedirectURI: lc.CLIRedirectURI,
		returnTo:       lc.ReturnTo,
		createdAt:      time.Now(),
	}
	c.mu.Unlock()

	challenge := pkceS256Challenge(verifier)
	authURL = c.config.AuthCodeURL(
		state,
		oauth2.SetAuthURLParam("code_challenge", challenge),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
	)
	return authURL, nil
}

// ExchangeCode validates the callback state, exchanges the code for tokens,
// and verifies the returned id_token.
// The third return value is the LoginContext captured at login time — the CLI
// redirect URI and/or the sanitised return path.
func (c *OIDCClient) ExchangeCode(
	ctx context.Context,
	code, state string,
) (*oauth2.Token, *gooidc.IDToken, LoginContext, error) {
	c.mu.Lock()
	ps, ok := c.states[state]
	if ok {
		delete(c.states, state)
	}
	c.mu.Unlock()

	if !ok {
		return nil, nil, LoginContext{}, fmt.Errorf("invalid or expired CSRF state")
	}
	lc := LoginContext{CLIRedirectURI: ps.cliRedirectURI, ReturnTo: ps.returnTo}

	// Re-inject the custom HTTP client so token exchange and id_token
	// verification use the same TLS settings as OIDC discovery.
	ctx = c.withClient(ctx)

	token, err := c.config.Exchange(
		ctx, code,
		oauth2.SetAuthURLParam("code_verifier", ps.codeVerifier),
	)
	if err != nil {
		return nil, nil, LoginContext{}, fmt.Errorf("token exchange: %w", err)
	}

	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		return nil, nil, LoginContext{}, fmt.Errorf("no id_token in token response")
	}

	idToken, err := c.verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return nil, nil, LoginContext{}, fmt.Errorf("id_token verification: %w", err)
	}

	return token, idToken, lc, nil
}

// VerifyIDToken verifies a raw id_token string against the Supervisor.
func (c *OIDCClient) VerifyIDToken(ctx context.Context, raw string) (*gooidc.IDToken, error) {
	return c.verifier.Verify(c.withClient(ctx), raw)
}

// RefreshTokens performs an OIDC refresh_token grant against the Supervisor
// to obtain a fresh access_token (and optionally a new id_token).
//
// Per the Pinniped documentation, this is the required first step when mTLS
// client certificates from Concierge expire: refresh the access_token, then
// redo the RFC 8693 token exchange and TokenCredentialRequest.
//
// Returns the new oauth2.Token and the raw id_token string (may be empty —
// some providers omit it on refresh; callers should fall back to the old value).
func (c *OIDCClient) RefreshTokens(ctx context.Context, refreshToken string) (*oauth2.Token, string, error) {
	ctx = c.withClient(ctx)
	// Construct a token with only RefreshToken set so the TokenSource treats it
	// as expired and immediately performs a refresh_token grant.
	ts := c.config.TokenSource(ctx, &oauth2.Token{RefreshToken: refreshToken})
	token, err := ts.Token()
	if err != nil {
		return nil, "", fmt.Errorf("token refresh: %w", err)
	}
	rawIDToken, _ := token.Extra("id_token").(string)
	return token, rawIDToken, nil
}

// ExchangeForClusterToken performs an RFC 8693 token exchange against the
// Supervisor token endpoint to obtain a cluster-scoped id_token.
//
// The returned token carries audience=clusterAudience (matching the spoke
// cluster's JWTAuthenticator spec.audience) instead of the portal client ID.
// It can then be used with Pinniped Concierge's TokenCredentialRequest to
// obtain short-lived mTLS client certificates for that specific cluster.
//
// accessToken must be the opaque access token issued by the Supervisor at the
// end of the Authorization Code flow (stored in the session).
func (c *OIDCClient) ExchangeForClusterToken(ctx context.Context, accessToken, clusterAudience string) (string, error) {
	if clusterAudience == "" {
		return "", fmt.Errorf("cluster audience is required for token exchange")
	}

	tokenURL := c.config.Endpoint.TokenURL

	vals := url.Values{
		"grant_type":           {"urn:ietf:params:oauth:grant-type:token-exchange"},
		"subject_token":        {accessToken},
		"subject_token_type":   {"urn:ietf:params:oauth:token-type:access_token"},
		"requested_token_type": {"urn:ietf:params:oauth:token-type:jwt"},
		"audience":             {clusterAudience},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(vals.Encode()))
	if err != nil {
		return "", fmt.Errorf("build token exchange request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(c.config.ClientID, c.config.ClientSecret)

	httpClient := http.DefaultClient
	if c.httpClient != nil {
		httpClient = c.httpClient
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("token exchange: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read token exchange response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token exchange failed (HTTP %d): %s", resp.StatusCode, body)
	}

	// RFC 8693 §2.2.1: the issued security token is always in "access_token".
	// Pinniped returns the cluster-scoped JWT there with
	// issued_token_type=urn:ietf:params:oauth:token-type:jwt.
	var result struct {
		AccessToken      string `json:"access_token"`
		IssuedTokenType  string `json:"issued_token_type"`
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("parse token exchange response: %w", err)
	}
	if result.Error != "" {
		return "", fmt.Errorf("token exchange error %q: %s", result.Error, result.ErrorDescription)
	}
	if result.AccessToken == "" {
		return "", fmt.Errorf("no access_token in token exchange response (body: %s)", body)
	}
	return result.AccessToken, nil
}

// — helpers —

func randomBase64URL(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func pkceS256Challenge(verifier string) string {
	h := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(h[:])
}
