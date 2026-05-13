// Package auth implements the session management layer.
//
// Sessions are stored as AES-256-GCM encrypted JSON blobs inside an HttpOnly
// cookie.  The encrypted payload carries the user's Pinniped Supervisor
// id_token so the backend can forward it (as a Bearer token) to any spoke
// cluster without a second authentication step — the "One Token" model.
package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"
)

// SessionCookieName is the HttpOnly cookie that carries the encrypted session.
const SessionCookieName = "wxops_session"

// Session is the decrypted payload stored in the cookie.
type Session struct {
	// Identity claims extracted from the Supervisor id_token.
	// Pinniped Supervisor uses "username" and "groups" — not the standard
	// OIDC "email" / "preferred_username" claims.
	Sub      string   `json:"sub"`
	Username string   `json:"username"`
	Groups   []string `json:"groups"`

	// Tokens from the Supervisor — the id_token doubles as the cluster Bearer
	// token in the Hub-Spoke architecture (validated by Pinniped Concierge on
	// each spoke cluster against the Supervisor issuer).
	IDToken      string    `json:"id_token"`
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
}

// SessionManager encrypts and decrypts Session values using AES-256-GCM.
type SessionManager struct {
	key []byte // exactly 32 bytes
}

// NewSessionManager returns a SessionManager.
// secret must be 64 lowercase hex characters (32 bytes, e.g. from
// "openssl rand -hex 32").
func NewSessionManager(secret string) (*SessionManager, error) {
	key, err := hex.DecodeString(secret)
	if err != nil {
		return nil, fmt.Errorf("SESSION_SECRET is not valid hex: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("SESSION_SECRET must decode to exactly 32 bytes, got %d", len(key))
	}
	return &SessionManager{key: key}, nil
}

// Encode encrypts a Session into a URL-safe base64 string.
func (sm *SessionManager) Encode(s *Session) (string, error) {
	plaintext, err := json.Marshal(s)
	if err != nil {
		return "", fmt.Errorf("marshal session: %w", err)
	}

	block, err := aes.NewCipher(sm.key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("random nonce: %w", err)
	}

	// Seal appends ciphertext+tag to nonce so the nonce is stored prepended.
	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
	return base64.RawURLEncoding.EncodeToString(ciphertext), nil
}

// Decode decrypts an encoded session string.
func (sm *SessionManager) Decode(encoded string) (*Session, error) {
	ciphertext, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("base64 decode: %w", err)
	}

	block, err := aes.NewCipher(sm.key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, errors.New("ciphertext too short")
	}
	nonce, ct := ciphertext[:nonceSize], ciphertext[nonceSize:]

	plaintext, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt session (tampered or wrong key): %w", err)
	}

	var s Session
	if err := json.Unmarshal(plaintext, &s); err != nil {
		return nil, fmt.Errorf("unmarshal session: %w", err)
	}
	return &s, nil
}
