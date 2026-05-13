package handlers

import (
	"net/http"
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

// Login starts the OIDC Authorization Code + PKCE flow against the Pinniped
// Supervisor.
//
//	GET /auth/login
func (h *AuthHandler) Login(c *gin.Context) {
	authURL, err := h.oidc.StartLogin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to initiate login"})
		return
	}
	c.Redirect(http.StatusFound, authURL)
}

// Callback handles the redirect from the Pinniped Supervisor after the user
// authenticates via Dex/Gitea.  It exchanges the code for tokens, validates
// the id_token, and writes an encrypted session cookie.
//
//	GET /auth/callback
func (h *AuthHandler) Callback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")

	if code == "" || state == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing code or state in callback"})
		return
	}

	token, idToken, err := h.oidc.ExchangeCode(c.Request.Context(), code, state)
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

	// 8-hour session; SameSite=Lax works for same-origin redirects.
	// Set Secure=true when serving over HTTPS in production.
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(auth.SessionCookieName, encoded, 8*3600, "/", "", false, true)

	c.Redirect(http.StatusFound, h.cfg.FrontendURL+"/dashboard")
}

// Me returns the authenticated user's identity from the session.
//
//	GET /auth/me   (no auth middleware — reads cookie directly for Next.js SSR)
//	GET /api/v1/me (protected by RequireSession middleware)
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
//	POST /auth/logout
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
