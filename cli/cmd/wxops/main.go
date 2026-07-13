package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/wxops/wxops-cli/internal/commands"
)

var version = "dev" // overridden at build time via -ldflags

func main() {
	root := &cobra.Command{
		Use:   "wxops",
		Short: "WxOps CLI — terminal access to the developer portal",
		Long: `wxops is a thin CLI for the WxOps Internal Developer Portal.

Authenticate with 'wxops login', then use the catalog and debug commands
to explore services and generate Darlane debug commands.`,
		SilenceUsage: true,
	}

	root.AddCommand(commands.NewLoginCmd())
	root.AddCommand(commands.NewCatalogCmd())
	root.AddCommand(commands.NewDebugCmd())
	root.AddCommand(commands.NewDarlaneCmd())
	root.AddCommand(&cobra.Command{
		Use:   "version",
		Short: "Print the CLI version",
		Run: func(_ *cobra.Command, _ []string) {
			fmt.Println("wxops version", version)
		},
	})

	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
}
