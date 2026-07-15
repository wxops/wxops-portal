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
// @Tags         auth
// @Success      302  {string}  string  "Redirect to OIDC provider"
// @Router       /auth/login [get]
func (h *AuthHandler) Login(c *gin.Context) {
	// Optional CLI callback — must be localhost to prevent open redirect.
	cliRedirectURI := c.Query("redirect_uri")
	if cliRedirectURI != "" && !isCLIRedirect(cliRedirectURI) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "redirect_uri must target 127.0.0.1"})
		return
	}

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
		c.Redirect(http.StatusFound, h.cfg.FrontendURL+"/dashboard")
		return
	}

	authURL, err := h.oidc.StartLogin(cliRedirectURI)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to initiate login"})
		return
	}
	c.Redirect(http.StatusFound, authURL)
}

// Callback handles the OIDC redirect and writes the encrypted session cookie.
//
// @Summary      OIDC callback
// @Description  Exchanges the authorization code for tokens, validates the id_token, and writes an encrypted session cookie.
// @Tags         auth
// @Param        code   query  string  true  "Authorization code"
// @Param        state  query  string  true  "CSRF state token"
// @Success      302    {string}  string  "Redirect to dashboard"
// @Failure      400    {object}  map[string]string
// @Router       /auth/callback [get]
func (h *AuthHandler) Callback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")

	if code == "" || state == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing code or state in callback"})
		return
	}

	token, idToken, cliRedirectURI, err := h.oidc.ExchangeCode(c.Request.Context(), code, state)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse id_token claims"})
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create session"})
		return
	}

	// Secure=true when the request arrived over HTTPS, detected from
	// X-Forwarded-Proto preserved by nginx from the Ingress controller.
	// Stays false for plain HTTP in local dev.
	secure := c.GetHeader("X-Forwarded-Proto") == "https"
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(auth.SessionCookieName, encoded, 8*3600, "/", "", secure, true)

	// CLI login: redirect back to the local callback server with the encoded session.
	if cliRedirectURI != "" {
		c.Redirect(http.StatusFound, cliRedirectURI+"?token="+url.QueryEscape(encoded))
		return
	}

	c.Redirect(http.StatusFound, h.cfg.FrontendURL+"/dashboard")
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
