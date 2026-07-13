package commands

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wxops/wxops-cli/internal/client"
)

func NewLoginCmd() *cobra.Command {
	var portalURL string

	cmd := &cobra.Command{
		Use:   "login",
		Short: "Authenticate with the WxOps portal",
		Long: `Opens a browser to log in via the portal's OIDC flow.
The session token is saved to ~/.wxops/credentials.json.

If --portal is omitted and credentials already exist, the saved portal URL is reused.`,
		Example: `  wxops login --portal https://portal.wxops.cloud
  wxops login   # re-authenticate using the saved portal URL`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			// Fall back to saved portal URL when --portal is not supplied.
			if portalURL == "" {
				saved, err := client.LoadCredentials()
				if err != nil || saved.PortalURL == "" {
					return fmt.Errorf("--portal is required for first-time login")
				}
				portalURL = saved.PortalURL
			}
			portalURL = strings.TrimRight(portalURL, "/")

			// Start local callback server on a random port.
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				return fmt.Errorf("starting callback server: %w", err)
			}
			port := listener.Addr().(*net.TCPAddr).Port
			callbackURL := fmt.Sprintf("http://127.0.0.1:%d/callback", port)

			// The portal handles OIDC internally and redirects back with ?token=<session-value>.
			authURL := fmt.Sprintf(
				"%s/auth/login?redirect_uri=%s",
				portalURL,
				url.QueryEscape(callbackURL),
			)

			fmt.Fprintf(cmd.OutOrStdout(), "Opening browser...\n%s\n\n", authURL)
			openBrowser(authURL)

			tokenCh := make(chan string, 1)
			errCh := make(chan error, 1)

			srv := &http.Server{
				Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					token := r.URL.Query().Get("token")
					if token == "" {
						errCh <- fmt.Errorf("no token in callback — did the login succeed?")
						http.Error(w, "login failed", http.StatusBadRequest)
						return
					}
					fmt.Fprint(w, "<html><body><h2>Login successful!</h2><p>You can close this tab.</p></body></html>")
					tokenCh <- token
				}),
			}
			go func() {
				if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
					errCh <- err
				}
			}()

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			var token string
			select {
			case token = <-tokenCh:
			case err = <-errCh:
				return err
			case <-ctx.Done():
				return fmt.Errorf("login timed out after 5 minutes")
			}

			// Shut down with a short deadline so the browser's keep-alive
			// connection doesn't stall the CLI indefinitely.
			shutCtx, shutCancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
			defer shutCancel()
			_ = srv.Shutdown(shutCtx)

			creds := &client.Credentials{
				PortalURL: portalURL,
				Token:     token,
			}
			if err := client.SaveCredentials(creds); err != nil {
				return fmt.Errorf("saving credentials: %w", err)
			}

			fmt.Fprintf(cmd.OutOrStdout(), "Logged in to %s\n", portalURL)
			return nil
		},
	}

	cmd.Flags().StringVar(&portalURL, "portal", "", "Portal URL (e.g. https://portal.wxops.cloud)")
	return cmd
}

func openBrowser(rawURL string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", rawURL)
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", rawURL)
	default:
		cmd = exec.Command("xdg-open", rawURL)
	}
	_ = cmd.Start()
}
