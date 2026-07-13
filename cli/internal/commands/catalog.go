package commands

import (
	"fmt"
	"strings"
	"text/tabwriter"

	"github.com/spf13/cobra"
	"github.com/wxops/wxops-cli/internal/client"
)

func NewCatalogCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "catalog",
		Short: "Interact with the service catalog",
	}
	cmd.AddCommand(newCatalogListCmd())
	cmd.AddCommand(newCatalogGetCmd())
	return cmd
}

func newCatalogListCmd() *cobra.Command {
	var kind, lifecycle string

	cmd := &cobra.Command{
		Use:   "list",
		Short: "List catalog entities",
		Example: `  wxops catalog list
  wxops catalog list --kind Component --lifecycle production`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			creds, err := client.LoadCredentials()
			if err != nil {
				return err
			}
			c := client.New(creds)
			entities, err := c.ListEntities(kind, lifecycle)
			if err != nil {
				return err
			}
			if len(entities) == 0 {
				fmt.Fprintln(cmd.OutOrStdout(), "No entities found.")
				return nil
			}

			w := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "KIND\tNAME\tLIFECYCLE\tOWNER\tDESCRIPTION")
			fmt.Fprintln(w, "----\t----\t---------\t-----\t-----------")
			for _, e := range entities {
				desc := e.Metadata.Description
				if len(desc) > 60 {
					desc = desc[:57] + "..."
				}
				owner := strings.TrimPrefix(e.Spec.Owner, "group:")
				fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n",
					e.Kind,
					e.Metadata.Name,
					e.Spec.Lifecycle,
					owner,
					desc,
				)
			}
			return w.Flush()
		},
	}
	cmd.Flags().StringVar(&kind, "kind", "", "Filter by entity kind (e.g. Component, API, Resource)")
	cmd.Flags().StringVar(&lifecycle, "lifecycle", "", "Filter by lifecycle (experimental, development, staging, production)")
	return cmd
}

func newCatalogGetCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "get <kind> <name>",
		Short:   "Get a catalog entity",
		Args:    cobra.ExactArgs(2),
		Example: `  wxops catalog get Component payment-api`,
		RunE: func(cmd *cobra.Command, args []string) error {
			creds, err := client.LoadCredentials()
			if err != nil {
				return err
			}
			c := client.New(creds)
			entity, err := c.GetEntity(args[0], args[1])
			if err != nil {
				return err
			}

			out := cmd.OutOrStdout()
			fmt.Fprintf(out, "Kind:       %s\n", entity.Kind)
			fmt.Fprintf(out, "Name:       %s\n", entity.Metadata.Name)
			if entity.Metadata.Title != "" && entity.Metadata.Title != entity.Metadata.Name {
				fmt.Fprintf(out, "Title:      %s\n", entity.Metadata.Title)
			}
			fmt.Fprintf(out, "Lifecycle:  %s\n", entity.Spec.Lifecycle)
			fmt.Fprintf(out, "Owner:      %s\n", strings.TrimPrefix(entity.Spec.Owner, "group:"))
			if entity.Spec.Type != "" {
				fmt.Fprintf(out, "Type:       %s\n", entity.Spec.Type)
			}
			if entity.Metadata.Description != "" {
				fmt.Fprintf(out, "Description: %s\n", entity.Metadata.Description)
			}
			if src := entity.Metadata.Annotations["gitea/source-location"]; src != "" {
				fmt.Fprintf(out, "Source:     %s\n", src)
			}
			return nil
		},
	}
}
