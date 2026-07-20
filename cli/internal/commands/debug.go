package commands

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wxops/wxops-cli/internal/client"
)

func NewDebugCmd() *cobra.Command {
	var targetEnv string

	cmd := &cobra.Command{
		Use:   "debug <service-name>",
		Short: "Print Darlane debug commands for a catalog service",
		Args:  cobra.ExactArgs(1),
		Example: `  wxops debug payment-api
  wxops debug payment-api --env staging`,
		RunE: func(cmd *cobra.Command, args []string) error {
			creds, err := client.LoadCredentials()
			if err != nil {
				return err
			}
			c := client.New(creds)

			entity, err := c.GetEntity("Component", args[0])
			if err != nil {
				return fmt.Errorf("entity %q not found: %w", args[0], err)
			}

			// Derive K8s namespace from owner group (org:team → tenant-{org}).
			rawOwner := strings.TrimPrefix(entity.Spec.Owner, "group:")
			org := strings.SplitN(rawOwner, ":", 2)[0]
			namespace := "tenant-" + org
			if org == "platform-team" {
				namespace = "platform"
			}

			appName := entity.Metadata.Name
			port := entity.Metadata.Annotations["wxops.cloud/container-port"]
			if port == "" {
				port = "8080"
			}

			env := targetEnv
			if env == "" {
				env = "dev"
			}
			if env != "dev" && env != "staging" && env != "production" {
				return fmt.Errorf("--env must be one of: dev, staging, production")
			}
			// Darlane deployments follow the same naming as darlane.go:
			// dev → {app}-darlane  |  staging/production → {app}-{env}-darlane
			var deployName string
			if env == "dev" {
				deployName = appName + "-darlane"
			} else {
				deployName = appName + "-" + env + "-darlane"
			}

			out := cmd.OutOrStdout()

			// ── Header ──────────────────────────────────────────────────────
			fmt.Fprintf(out, "\nDarlane debug  %s\n", appName)
			fmt.Fprintf(out, "Namespace       %s\n", namespace)
			fmt.Fprintf(out, "Deployment      %s\n", deployName)
			fmt.Fprintf(out, "Lifecycle       %s\n\n", entity.Spec.Lifecycle)

			// ── Darlane status per env (best-effort — never blocks the output) ──
			promo, perr := c.GetPromoStatus("Component", appName)
			if perr == nil {
				type envRow struct {
					name    string
					overlay client.PromoStatusOverlay
				}
				rows := []envRow{
					{"dev        ", promo.Overlays.Dev},
					{"staging    ", promo.Overlays.Staging},
					{"production ", promo.Overlays.Production},
				}
				fmt.Fprintln(out, "Darlane status")
				for _, r := range rows {
					var badge string
					switch {
					case r.overlay.DarlaneEnabled:
						badge = "✓  enabled"
					case r.overlay.Exists:
						badge = "·  overlay exists — Darlane not enabled"
					default:
						badge = "—  no overlay"
					}
					fmt.Fprintf(out, "  %s  %s\n", r.name, badge)
				}
				fmt.Fprintln(out)
				if env == "dev" && !promo.Overlays.Dev.DarlaneEnabled {
					fmt.Fprintln(out, "  Tip: open the Promotion panel in the portal and click \"Darlane\" to enable it for dev.")
					fmt.Fprintln(out)
				}
			}

			// ── kubectl + mirrord commands ───────────────────────────────────
			fmt.Fprintf(out, "Commands (%s)\n\n", env)

			fmt.Fprintln(out, "  # Exec (bash)")
			fmt.Fprintf(out, "  kubectl -n %s exec -it deployment/%s -- bash\n\n", namespace, deployName)

			fmt.Fprintln(out, "  # Port-forward")
			fmt.Fprintf(out, "  kubectl -n %s port-forward deployment/%s %s:%s\n\n", namespace, deployName, port, port)

			fmt.Fprintln(out, "  # Traffic mirror (mirrord)")
			fmt.Fprintf(out, "  mirrord exec \\\n")
			fmt.Fprintf(out, "    --target deployment/%s \\\n", deployName)
			fmt.Fprintf(out, "    --target-namespace %s \\\n", namespace)
			fmt.Fprintln(out, "    -- <your-start-command>")
			fmt.Fprintln(out)

			fmt.Fprintln(out, "  # File sync — watch local files and stream changes into the pod")
			fmt.Fprintf(out, "  wxops darlane sync %s", appName)
			if env != "dev" {
				fmt.Fprintf(out, " --env %s", env)
			}
			fmt.Fprintln(out)
			fmt.Fprintln(out, "  # Customise paths:")
			fmt.Fprintf(out, "  wxops darlane sync %s --local ./src --remote /app/src", appName)
			if env != "dev" {
				fmt.Fprintf(out, " --env %s", env)
			}
			fmt.Fprintln(out)
			fmt.Fprintln(out)

			return nil
		},
	}

	cmd.Flags().StringVarP(&targetEnv, "env", "e", "", "Target environment: dev (default), staging, production")
	return cmd
}
