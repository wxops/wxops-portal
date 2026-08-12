package handlers

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/wxops/wxops-portal-v2/internal/auth"
	"github.com/wxops/wxops-portal-v2/internal/config"
)

// AuthHandler handles the OIDC login flow and session lifecycle.
type AuthHandler struct {
	oidc *auth.OIDCClient
	sm   *auth.SessionManager
	cfg  *config.Config
}

// NewAuthHandler constructs an AuthHandler.
func NewAuthHandler(oidc *auth.OIDCClient, sm *auth.SessionManager, cfg *config.Config) *AuthHandler {
	return &AuthHandler{oidc: oidc, sm: sm, cfg: cfg}
}

// Login starts the OIDC Authorization Code + PKCE flow against the Pinniped Supervisor.
//
// @Summary      Start OIDC login
// @Description  Redirects the browser to the Pinniped Supervisor authorization endpoint to begin the PKCE flow.
// @Description  Both query parameters are optional and are stored server-side with the PKCE verifier, so neither can be altered between the authorization redirect and the callback.
// @Tags         auth
// @Param        redirect_uri  query  string  false  "CLI loopback callback; must target 127.0.0.1"
// @Param        return_to     query  string  false  "Same-origin path to land on after login; anything else falls back to /dashboard"
// @Success      302  {string}  string  "Redirect to OIDC provider"
// @Failure      400  {object}  map[string]string  "redirect_uri did not target 127.0.0.1 (CLI flow only)"
// @Router       /auth/login [get]
func (h *AuthHandler) Login(c *gin.Context) {
	// Optional CLI callback — must be localhost to prevent open redirect.
	cliRedirectURI := c.Query("redirect_uri")
	if cliRedirectURI != "" && !isCLIRedirect(cliRedirectURI) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "redirect_uri must target 127.0.0.1"})
		return
	}

	// Optional browser return path, used by the "Sign in again" affordance the UI
	// shows when a request 401s. Reduced to a same-origin path; anything
	// questionable is dropped and the user lands on the dashboard instead.
	returnTo := auth.SafeReturnPath(c.Query("return_to"))

	if h.cfg.DevBypassAuth {
		session := &auth.Session{
			Sub:      "dev-bypass",
			Username: "dev",
			Groups:   []string{"platform-team"},
		}
		encoded, err := h.sm.Encode(session)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create dev session"})
			return
		}
		secure := c.GetHeader("X-Forwarded-Proto") == "https"
		c.SetSameSite(http.SameSiteLaxMode)
		c.SetCookie(auth.SessionCookieName, encoded, 8*3600, "/", "", secure, true)
		if cliRedirectURI != "" {
			c.Redirect(http.StatusFound, cliRedirectURI+"?token="+url.QueryEscape(encoded))
			return
		}
		c.Redirect(http.StatusFound, h.cfg.FrontendURL+landingPath(returnTo))
		return
	}

	authURL, err := h.oidc.StartLogin(auth.LoginContext{
		CLIRedirectURI: cliRedirectURI,
		ReturnTo:       returnTo,
	})
	if err != nil {
		// The CLI parses JSON and has no login page to land on; only browsers
		// get redirected.
		if cliRedirectURI != "" {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to initiate login"})
			return
		}
		h.failLogin(c, loginErrServer)
		return
	}
	c.Redirect(http.StatusFound, authURL)
}

// Callback handles the OIDC redirect and writes the encrypted session cookie.
//
// @Summary      OIDC callback
// @Description  Exchanges the authorization code for tokens, validates the id_token, and writes an encrypted session cookie.
// @Description  Never returns a JSON error body: every failure redirects to /login?error=<code> where code is one of invalid_request, expired or server. The underlying OIDC error is deliberately not exposed.
// @Tags         auth
// @Param        code   query  string  true  "Authorization code"
// @Param        state  query  string  true  "CSRF state token"
// @Success      302    {string}  string  "Redirect to the return path, or /dashboard"
// @Failure      302    {string}  string  "Redirect to /login?error=<code> on any failure"
// @Router       /auth/callback [get]
func (h *AuthHandler) Callback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")

	if code == "" || state == "" {
		h.failLogin(c, loginErrInvalidRequest)
		return
	}

	token, idToken, loginCtx, err := h.oidc.ExchangeCode(c.Request.Context(), code, state)
	if err != nil {
		// Almost always an expired or unknown PKCE state (backend restarted
		// mid-login), or a code the Supervisor has already redeemed.
		h.failLogin(c, loginErrExpired)
		return
	}

	// Pinniped Supervisor id_token uses "username" and "groups".
	// Standard OIDC claims like "email", "name", "preferred_username" are NOT
	// present — see https://pinniped.dev/docs/howto/configure-auth-for-webapps/
	var claims struct {
		Sub      string   `json:"sub"`
		Username string   `json:"username"`
		Groups   []string `json:"groups"`
	}
	if err := idToken.Claims(&claims); err != nil {
		h.failLogin(c, loginErrServer)
		return
	}

	rawIDToken, _ := token.Extra("id_token").(string)

	session := &auth.Session{
		Sub:          claims.Sub,
		Username:     claims.Username,
		Groups:       claims.Groups,
		IDToken:      rawIDToken,
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		ExpiresAt:    token.Expiry,
	}

	encoded, err := h.sm.Encode(session)
	if err != nil {
		h.failLogin(c, loginErrServer)
		return
	}

	// Secure=true when the request arrived over HTTPS, detected from
	// X-Forwarded-Proto preserved by nginx from the Ingress controller.
	// Stays false for plain HTTP in local dev.
	secure := c.GetHeader("X-Forwarded-Proto") == "https"
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(auth.SessionCookieName, encoded, 8*3600, "/", "", secure, true)

	// CLI login: redirect back to the local callback server with the encoded session.
	if loginCtx.CLIRedirectURI != "" {
		c.Redirect(http.StatusFound, loginCtx.CLIRedirectURI+"?token="+url.QueryEscape(encoded))
		return
	}

	// Browser login: return the user to wherever they were when the session
	// expired, so a 401 mid-task does not cost them their place.
	c.Redirect(http.StatusFound, h.cfg.FrontendURL+landingPath(loginCtx.ReturnTo))
}

// Login failure codes sent to the frontend as ?error=<code>.
//
// These are a closed set of opaque tokens, never the underlying error text:
// OIDC failures can carry issuer URLs, client IDs and token-endpoint detail
// that must not reach the browser or a user's history. The login page maps each
// to human-readable copy.
const (
	loginErrInvalidRequest = "invalid_request" // callback arrived malformed
	loginErrExpired        = "expired"         // PKCE state gone or code rejected
	loginErrServer         = "server"          // portal-side failure
)

// failLogin returns the browser to the login page with a failure code.
//
// Prefer this over c.JSON for anything a browser can reach: the callback is a
// top-level navigation, so a JSON body renders as raw text in the address bar
// with no way for the user to recover. The most common trigger is a backend
// restart between /auth/login and /auth/callback, which drops the in-memory
// PKCE state — routine during a deploy, and not the user's fault.
func (h *AuthHandler) failLogin(c *gin.Context, code string) {
	c.Redirect(http.StatusFound, h.cfg.FrontendURL+"/login?error="+url.QueryEscape(code))
}

// landingPath resolves where a browser login should finish.
//
// returnTo has already been through auth.SafeReturnPath, so it is either a
// same-origin path or empty; empty falls back to the dashboard.
func landingPath(returnTo string) string {
	if returnTo == "" {
		return "/dashboard"
	}
	return returnTo
}

// Me returns the authenticated user's identity from the session cookie.
//
// @Summary      Current user identity
// @Description  Returns sub, username, and group memberships from the session. Available on both /auth/me (unauthenticated, for Next.js SSR) and /api/v1/me (protected).
// @Tags         auth
// @Produce      json
// @Success      200  {object}  handlers.userResponsePayload
// @Failure      401  {object}  map[string]string
// @Security     CookieAuth
// @Router       /auth/me [get]
func (h *AuthHandler) Me(c *gin.Context) {
	// Fast path: session already extracted by middleware.
	if s := auth.GetSession(c); s != nil {
		c.JSON(http.StatusOK, userResponse(s))
		return
	}

	// Fallback: read and decode the cookie directly (used by /auth/me without
	// the auth middleware so Next.js server components can fetch it).
	cookie, err := c.Cookie(auth.SessionCookieName)
	if err != nil || cookie == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	session, err := h.sm.Decode(cookie)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
		return
	}
	c.JSON(http.StatusOK, userResponse(session))
}

// Logout clears the session cookie.
//
// @Summary      Sign out
// @Description  Clears the session cookie, effectively logging the user out.
// @Tags         auth
// @Produce      json
// @Success      200  {object}  map[string]string  "message: logged out"
// @Router       /auth/logout [post]
func (h *AuthHandler) Logout(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(auth.SessionCookieName, "", -1, "/", "", false, true)
	c.JSON(http.StatusOK, gin.H{"message": "logged out"})
}

type userResponsePayload struct {
	Sub      string   `json:"sub"`
	Username string   `json:"username"`
	Groups   []string `json:"groups"`
}

func userResponse(s *auth.Session) userResponsePayload {
	groups := s.Groups
	if groups == nil {
		groups = []string{}
	}
	return userResponsePayload{
		Sub:      s.Sub,
		Username: s.Username,
		Groups:   groups,
	}
}

// isCLIRedirect returns true only when the redirect_uri targets the loopback
// interface, preventing open-redirect attacks against arbitrary hosts.
func isCLIRedirect(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	host := u.Hostname()
	return (u.Scheme == "http") && (host == "127.0.0.1" || host == "localhost") && strings.HasPrefix(u.Path, "/")
}
