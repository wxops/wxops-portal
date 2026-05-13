package auth

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// sessionContextKey is the gin context key for the decoded session.
const sessionContextKey = "wxops_session"

// RequireSession is a Gin middleware that decrypts the session cookie and
// stores the decoded Session in the request context.  Requests without a
// valid session are rejected with 401.
func RequireSession(sm *SessionManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		cookie, err := c.Cookie(SessionCookieName)
		if err != nil || cookie == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
			return
		}

		session, err := sm.Decode(cookie)
		if err != nil {
			// Cookie present but tampered or wrong key — clear it.
			c.SetCookie(SessionCookieName, "", -1, "/", "", false, true)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
			return
		}

		c.Set(sessionContextKey, session)
		c.Next()
	}
}

// GetSession retrieves the *Session stored by RequireSession.
// Returns nil if the middleware was not applied.
func GetSession(c *gin.Context) *Session {
	v, exists := c.Get(sessionContextKey)
	if !exists {
		return nil
	}
	s, _ := v.(*Session)
	return s
}

// SetSession replaces the *Session in the gin context so that the same
// request sees updated tokens after an inline refresh.
func SetSession(c *gin.Context, s *Session) {
	c.Set(sessionContextKey, s)
}
