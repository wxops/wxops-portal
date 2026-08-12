package handlers

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/wxops/wxops-portal-v2/internal/auth"
	"github.com/wxops/wxops-portal-v2/internal/cluster"
)

// CredentialBroker turns the logged-in user's session into an authenticated
// client for a spoke cluster.
//
// It exists so that more than one handler can borrow the user's identity
// without duplicating the token-exchange → refresh → Concierge flow. Cluster
// views resolve the target cluster from the :id path parameter; runtime
// observability instead fans out over every registered cluster, so the
// credential logic has to be callable with an arbitrary ClusterInfo.
//
// Every read the portal performs against a spoke runs through here, which is
// what keeps the "portal holds no standing cluster credential for tenant
// resources" property true — it always borrows the user's, per request.
type CredentialBroker struct {
	oidcClient *auth.OIDCClient
	sm         *auth.SessionManager

	// supervisorCAData is the base64-encoded PEM CA for the Pinniped Supervisor
	// TLS endpoint (from OIDC_CA_BUNDLE / OIDC_CA_BUNDLE_FILE). Empty when the
	// Supervisor uses a publicly trusted certificate.
	// Used as --ca-bundle-data in the generated exec-credential kubeconfig so
	// `pinniped login oidc` can verify the Supervisor — distinct from the spoke
	// cluster CA that goes to --concierge-ca-bundle-data.
	supervisorCAData string

	// credCache caches short-lived Concierge mTLS credentials to avoid hitting
	// the Supervisor and Concierge on every request.
	// Key: "<sub>:<clusterID>"   Value: cachedCred
	credCache sync.Map
}

// cachedCred holds a ClusterCredential and its expiry for quick comparison.
type cachedCred struct {
	cred      *cluster.ClusterCredential
	expiresAt time.Time
}

// certBuffer is how much life a cached certificate must have left to be reused.
// Renewing slightly early avoids handing out a credential that expires
// mid-request.
const certBuffer = 2 * time.Minute

// NewCredentialBroker constructs a CredentialBroker.
// supervisorCA is the raw PEM of the Pinniped Supervisor's TLS CA; pass nil
// when the Supervisor uses a publicly trusted certificate.
func NewCredentialBroker(oidcClient *auth.OIDCClient, sm *auth.SessionManager, supervisorCA []byte) *CredentialBroker {
	var supervisorCAData string
	if len(supervisorCA) > 0 {
		supervisorCAData = base64.StdEncoding.EncodeToString(supervisorCA)
	}
	return &CredentialBroker{oidcClient: oidcClient, sm: sm, supervisorCAData: supervisorCAData}
}

// SpokeClientFor builds a client authenticated as the current user against the
// given cluster.
//
// Flow when the cluster is fronted by a Pinniped Concierge:
//
//  1. Reuse a cached mTLS certificate when one is still comfortably valid.
//  2. RFC 8693 token exchange against the Supervisor → cluster-scoped id_token.
//  3. If the access_token is stale, use the refresh_token grant to obtain a
//     fresh one, persist the updated session to the cookie, then retry step 2
//     once.
//  4. Present the cluster-scoped id_token to the Concierge impersonation proxy
//     via TokenCredentialRequest → short-lived mTLS client certificate.
//  5. Cache the certificate and build the client.
//
// For clusters without Concierge (no Audience/JWTAuthenticatorName), the
// Supervisor id_token is sent directly as a Bearer token.
//
// The returned int is the HTTP status the caller should surface when err is
// non-nil, so callers can either write it straight to the response or decide
// to degrade instead.
func (b *CredentialBroker) SpokeClientFor(c *gin.Context, cl *cluster.ClusterInfo) (*cluster.SpokeClient, int, error) {
	session := auth.GetSession(c)
	if session == nil {
		return nil, http.StatusUnauthorized, fmt.Errorf("not authenticated")
	}

	// ── Pinniped Concierge path ──────────────────────────────────────────────
	if cl.Audience != "" && cl.JWTAuthenticatorName != "" {
		if session.AccessToken == "" && session.RefreshToken == "" {
			return nil, http.StatusUnprocessableEntity, fmt.Errorf("no tokens in session — re-login required")
		}

		cacheKey := session.Sub + ":" + cl.ID

		// Step 1 — check credential cache.
		var cred *cluster.ClusterCredential
		if v, hit := b.credCache.Load(cacheKey); hit {
			cc := v.(cachedCred)
			if time.Until(cc.expiresAt) > certBuffer {
				cred = cc.cred // cert still fresh — skip steps 2–4
			}
		}

		if cred == nil {
			// Step 2 — RFC 8693 token exchange: access_token → cluster-scoped id_token.
			clusterToken, exchangeErr := b.oidcClient.ExchangeForClusterToken(
				c.Request.Context(), session.AccessToken, cl.Audience)

			if exchangeErr != nil && session.RefreshToken != "" {
				// Step 3 — access_token stale: do OIDC refresh, then retry exchange.
				newTok, newIDRaw, refreshErr := b.oidcClient.RefreshTokens(
					c.Request.Context(), session.RefreshToken)
				if refreshErr != nil {
					return nil, http.StatusUnauthorized,
						fmt.Errorf("session expired and token refresh failed — please log in again")
				}

				// Persist refreshed session so future requests don't re-refresh.
				updatedIDToken := newIDRaw
				if updatedIDToken == "" {
					updatedIDToken = session.IDToken
				}
				updatedRT := newTok.RefreshToken
				if updatedRT == "" {
					updatedRT = session.RefreshToken
				}
				updated := &auth.Session{
					Sub:          session.Sub,
					Username:     session.Username,
					Groups:       session.Groups,
					IDToken:      updatedIDToken,
					AccessToken:  newTok.AccessToken,
					RefreshToken: updatedRT,
					ExpiresAt:    newTok.Expiry,
				}
				auth.SetSession(c, updated)
				if encoded, encErr := b.sm.Encode(updated); encErr == nil {
					c.SetSameSite(http.SameSiteLaxMode)
					c.SetCookie(auth.SessionCookieName, encoded, 8*3600, "/", "", false, true)
				}
				session = updated

				// Retry exchange with the fresh access_token.
				clusterToken, exchangeErr = b.oidcClient.ExchangeForClusterToken(
					c.Request.Context(), newTok.AccessToken, cl.Audience)
			}
			if exchangeErr != nil {
				return nil, http.StatusBadGateway, fmt.Errorf("token exchange: %v", exchangeErr)
			}

			// Step 4 — TokenCredentialRequest → short-lived mTLS cert.
			freshCred, credErr := cluster.RequestConciergeCredential(
				c.Request.Context(), cl, clusterToken)
			if credErr != nil {
				return nil, http.StatusBadGateway, fmt.Errorf("concierge credential: %v", credErr)
			}

			// Step 5 — cache the cert.
			b.credCache.Store(cacheKey, cachedCred{cred: freshCred, expiresAt: freshCred.ExpirationTimestamp})
			cred = freshCred
		}

		spokeClient, err := cluster.NewSpokeClientWithCert(cl, cred.ClientCertificateData, cred.ClientKeyData)
		if err != nil {
			return nil, http.StatusInternalServerError, fmt.Errorf("build spoke client: %v", err)
		}
		return spokeClient, http.StatusOK, nil
	}

	// ── Fallback: direct Bearer token ────────────────────────────────────────
	spokeClient, err := cluster.NewSpokeClient(cl, session.IDToken)
	if err != nil {
		return nil, http.StatusInternalServerError, fmt.Errorf("failed to build cluster client")
	}
	return spokeClient, http.StatusOK, nil
}
