package commands

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wxops/wxops-cli/internal/client"
)

// NewUpdateCmd returns the `wxops update` command.
// currentVersion should be the value injected by -ldflags at build time.
func NewUpdateCmd(currentVersion string) *cobra.Command {
	var yes bool

	cmd := &cobra.Command{
		Use:   "update",
		Short: "Update the wxops CLI to the latest version",
		Long: `Downloads the latest wxops CLI binary from the portal and replaces
the current executable in place. Requires an active portal session.

The binary is written to a temporary file alongside the current executable,
then atomically renamed to replace it.`,
		Example: `  wxops update
  wxops update --yes   # skip confirmation prompt`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			creds, err := client.LoadCredentials()
			if err != nil {
				return err
			}
			c := client.New(creds)

			fmt.Fprintln(cmd.OutOrStdout(), "Checking latest version...")
			latest, err := c.LatestVersion()
			if err != nil {
				return fmt.Errorf("fetching latest version: %w", err)
			}
			if latest == "unknown" {
				return fmt.Errorf("portal did not return a version — CLI downloads may not be configured on this instance")
			}

			if currentVersion != "dev" && currentVersion == latest {
				fmt.Fprintf(cmd.OutOrStdout(), "Already up to date (%s).\n", currentVersion)
				return nil
			}

			fmt.Fprintf(cmd.OutOrStdout(), "Current: %s\nLatest:  %s\n\n", currentVersion, latest)

			if !yes {
				fmt.Fprint(cmd.OutOrStdout(), "Download and replace current binary? [y/N] ")
				var answer string
				fmt.Fscan(cmd.InOrStdin(), &answer)
				if !strings.EqualFold(strings.TrimSpace(answer), "y") {
					fmt.Fprintln(cmd.OutOrStdout(), "Aborted.")
					return nil
				}
			}

			platform := runtime.GOOS + "-" + runtime.GOARCH
			fmt.Fprintf(cmd.OutOrStdout(), "Downloading %s for %s...\n", latest, platform)

			body, contentLength, err := c.DownloadCLI(platform)
			if err != nil {
				return fmt.Errorf("downloading binary: %w", err)
			}
			defer body.Close()

			// Find the path of the running binary so we can replace it.
			execPath, err := os.Executable()
			if err != nil {
				return fmt.Errorf("resolving executable path: %w", err)
			}
			// Follow symlinks so we replace the real file, not the link.
			execPath, err = filepath.EvalSymlinks(execPath)
			if err != nil {
				return fmt.Errorf("resolving symlinks: %w", err)
			}

			// Write to a temp file in the same directory to keep rename on the
			// same filesystem (cross-device rename fails on Linux).
			tmpFile, err := os.CreateTemp(filepath.Dir(execPath), ".wxops-update-*")
			if err != nil {
				return fmt.Errorf("creating temp file: %w", err)
			}
			tmpPath := tmpFile.Name()
			defer func() {
				tmpFile.Close()
				os.Remove(tmpPath) // no-op if rename succeeded
			}()

			written, err := io.Copy(tmpFile, body)
			if err != nil {
				return fmt.Errorf("writing binary: %w", err)
			}
			if written == 0 {
				return fmt.Errorf("downloaded binary is empty — portal may be misconfigured")
			}
			if contentLength > 0 && written != contentLength {
				return fmt.Errorf("incomplete download: got %d bytes, expected %d", written, contentLength)
			}
			tmpFile.Close()

			if err := os.Chmod(tmpPath, 0o755); err != nil {
				return fmt.Errorf("setting executable bit: %w", err)
			}

			if err := os.Rename(tmpPath, execPath); err != nil {
				return fmt.Errorf("replacing binary at %s: %w", execPath, err)
			}

			fmt.Fprintf(cmd.OutOrStdout(), "Updated to %s (%s).\n", latest, execPath)
			return nil
		},
	}

	cmd.Flags().BoolVarP(&yes, "yes", "y", false, "Skip confirmation prompt")
	return cmd
}
