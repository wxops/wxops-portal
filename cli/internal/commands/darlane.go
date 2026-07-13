package commands

import (
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/spf13/cobra"
	"github.com/wxops/wxops-cli/internal/client"
)

// defaultExcludes are always skipped during sync regardless of user flags.
var defaultExcludes = []string{".git", "node_modules", "__pycache__", ".next", "vendor"}

// NewDarlaneCmd returns the "darlane" command group.
func NewDarlaneCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "darlane",
		Short: "Interact with the Darlane parallel debug pod",
		Long: `Interact with the Darlane parallel in-cluster pod.

Darlane pods run alongside your service with zero traffic by default.
Use them for live debugging, feature-flag testing, or A/B experiments.`,
	}
	cmd.AddCommand(newDarlaneSyncCmd())
	cmd.AddCommand(newDarlaneExecCmd())
	cmd.AddCommand(newDarlanePortForwardCmd())
	return cmd
}

// resolveTarget derives the K8s namespace and deployment name from the entity.
func resolveTarget(c *client.Client, service, env, nsOverride, deployOverride string) (ns, deploy string, err error) {
	entity, err := c.GetEntity("Component", service)
	if err != nil {
		return "", "", fmt.Errorf("entity %q not found: %w", service, err)
	}

	rawOwner := strings.TrimPrefix(entity.Spec.Owner, "group:")
	org := strings.SplitN(rawOwner, ":", 2)[0]
	ns = "tenant-" + org
	if org == "platform-team" {
		ns = "platform"
	}
	if nsOverride != "" {
		ns = nsOverride
	}

	if env == "dev" || env == "" {
		deploy = fmt.Sprintf("%s-darlane", entity.Metadata.Name)
	} else {
		deploy = fmt.Sprintf("%s-%s-darlane", entity.Metadata.Name, env)
	}
	if deployOverride != "" {
		deploy = deployOverride
	}
	return ns, deploy, nil
}

// ── sync ─────────────────────────────────────────────────────────────────────

func newDarlaneSyncCmd() *cobra.Command {
	var env, ns, deploy, localPath, remotePath string
	var debounceMs int
	var excludes []string

	cmd := &cobra.Command{
		Use:   "sync <service>",
		Short: "Watch local files and stream changes into the Darlane pod",
		Args:  cobra.ExactArgs(1),
		Example: `  wxops darlane sync payment-api
  wxops darlane sync payment-api --local ./src --remote /app/src
  wxops darlane sync payment-api --exclude '*.log' --exclude 'tmp/'`,
		RunE: func(cmd *cobra.Command, args []string) error {
			creds, err := client.LoadCredentials()
			if err != nil {
				return err
			}
			c := client.New(creds)

			ns, deploy, err := resolveTarget(c, args[0], env, ns, deploy)
			if err != nil {
				return err
			}

			absLocal, err := filepath.Abs(localPath)
			if err != nil {
				return fmt.Errorf("invalid --local path: %w", err)
			}

			allExcludes := append(defaultExcludes, excludes...)

			watcher, err := fsnotify.NewWatcher()
			if err != nil {
				return fmt.Errorf("could not create watcher: %w", err)
			}
			defer watcher.Close()

			if err := addRecursive(watcher, absLocal, allExcludes); err != nil {
				return fmt.Errorf("could not watch %s: %w", absLocal, err)
			}

			fmt.Printf("Darlane sync\n")
			fmt.Printf("  Local   %s\n", absLocal)
			fmt.Printf("  Pod     %s/%s\n", ns, deploy)
			fmt.Printf("  Remote  %s\n", remotePath)
			fmt.Printf("  Press Ctrl-C to stop.\n\n")

			var (
				mu      sync.Mutex
				changed = map[string]struct{}{}
				timer   *time.Timer
			)

			flush := func() {
				mu.Lock()
				if len(changed) == 0 {
					mu.Unlock()
					return
				}
				paths := make([]string, 0, len(changed))
				for p := range changed {
					paths = append(paths, p)
				}
				changed = map[string]struct{}{}
				mu.Unlock()

				if err := syncFiles(ns, deploy, absLocal, remotePath, paths); err != nil {
					fmt.Fprintf(os.Stderr, "sync error: %v\n", err)
				}
			}

			ctx := cmd.Context()
			for {
				select {
				case event, ok := <-watcher.Events:
					if !ok {
						return nil
					}
					if event.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Rename) == 0 {
						continue
					}
					if isExcluded(event.Name, allExcludes) {
						continue
					}
					// Watch newly created directories recursively.
					if event.Op&fsnotify.Create != 0 {
						if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
							_ = addRecursive(watcher, event.Name, allExcludes)
						}
					}
					mu.Lock()
					changed[event.Name] = struct{}{}
					mu.Unlock()

					if timer != nil {
						timer.Stop()
					}
					timer = time.AfterFunc(time.Duration(debounceMs)*time.Millisecond, flush)

				case err, ok := <-watcher.Errors:
					if !ok {
						return nil
					}
					fmt.Fprintf(os.Stderr, "watcher error: %v\n", err)

				case <-ctx.Done():
					if timer != nil {
						timer.Stop()
					}
					return nil
				}
			}
		},
	}

	cmd.Flags().StringVarP(&env, "env", "e", "dev", "Target environment: dev, staging, production")
	cmd.Flags().StringVarP(&ns, "namespace", "n", "", "Override K8s namespace (derived from entity owner by default)")
	cmd.Flags().StringVar(&deploy, "deployment", "", "Override deployment name (default: {app}-darlane)")
	cmd.Flags().StringVar(&localPath, "local", ".", "Local directory to watch")
	cmd.Flags().StringVar(&remotePath, "remote", "/app", "Remote path inside the container")
	cmd.Flags().IntVar(&debounceMs, "debounce", 100, "Debounce interval in milliseconds")
	cmd.Flags().StringArrayVar(&excludes, "exclude", nil, "Glob pattern to exclude (repeatable)")
	return cmd
}

// syncFiles tars the changed files and pipes them into the pod via kubectl exec.
func syncFiles(ns, deploy, localBase, remotePath string, changedPaths []string) error {
	var relPaths []string
	for _, p := range changedPaths {
		rel, err := filepath.Rel(localBase, p)
		if err != nil || strings.HasPrefix(rel, "..") {
			continue
		}
		relPaths = append(relPaths, rel)
	}
	if len(relPaths) == 0 {
		return nil
	}

	tarArgs := append([]string{"cf", "-", "--"}, relPaths...)
	tarCmd := exec.Command("tar", tarArgs...)
	tarCmd.Dir = localBase
	tarCmd.Stderr = os.Stderr

	kubectlCmd := exec.Command(
		"kubectl", "exec", "-i",
		"-n", ns,
		"deployment/"+deploy,
		"--", "tar", "xf", "-", "-C", remotePath,
	)
	kubectlCmd.Stderr = os.Stderr

	pipe, err := tarCmd.StdoutPipe()
	if err != nil {
		return err
	}
	kubectlCmd.Stdin = pipe

	if err := kubectlCmd.Start(); err != nil {
		return fmt.Errorf("kubectl exec: %w", err)
	}
	if err := tarCmd.Run(); err != nil {
		return fmt.Errorf("tar: %w", err)
	}
	pipe.Close()
	if err := kubectlCmd.Wait(); err != nil {
		return fmt.Errorf("kubectl exec tar: %w", err)
	}

	fmt.Printf("  synced %d file(s): %s\n", len(relPaths), strings.Join(relPaths, ", "))
	return nil
}

// addRecursive adds a directory and all its subdirectories to the watcher,
// skipping paths that match any of the exclude patterns.
func addRecursive(w *fsnotify.Watcher, root string, excludes []string) error {
	return filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() {
			return nil
		}
		if isExcluded(path, excludes) {
			return filepath.SkipDir
		}
		return w.Add(path)
	})
}

// isExcluded reports whether path matches any of the exclude patterns or
// contains any default-excluded directory name as a path component.
func isExcluded(path string, excludes []string) bool {
	base := filepath.Base(path)
	for _, ex := range excludes {
		if matched, _ := filepath.Match(ex, base); matched {
			return true
		}
		// Also match against the full path segment.
		if strings.Contains(path, string(filepath.Separator)+ex+string(filepath.Separator)) ||
			strings.HasSuffix(path, string(filepath.Separator)+ex) {
			return true
		}
	}
	return false
}

// ── exec ─────────────────────────────────────────────────────────────────────

func newDarlaneExecCmd() *cobra.Command {
	var env, ns, deploy string

	cmd := &cobra.Command{
		Use:   "exec <service>",
		Short: "Open an interactive shell in the Darlane pod",
		Args:  cobra.ExactArgs(1),
		Example: `  wxops darlane exec payment-api
  wxops darlane exec payment-api --env staging`,
		RunE: func(cmd *cobra.Command, args []string) error {
			creds, err := client.LoadCredentials()
			if err != nil {
				return err
			}
			c := client.New(creds)

			ns, deploy, err := resolveTarget(c, args[0], env, ns, deploy)
			if err != nil {
				return err
			}

			fmt.Printf("Opening shell in %s/%s …\n", ns, deploy)
			kubectl := exec.Command("kubectl", "exec", "-it",
				"-n", ns, "deployment/"+deploy, "--", "bash")
			kubectl.Stdin = os.Stdin
			kubectl.Stdout = os.Stdout
			kubectl.Stderr = os.Stderr
			return kubectl.Run()
		},
	}

	cmd.Flags().StringVarP(&env, "env", "e", "dev", "Target environment: dev, staging, production")
	cmd.Flags().StringVarP(&ns, "namespace", "n", "", "Override K8s namespace")
	cmd.Flags().StringVar(&deploy, "deployment", "", "Override deployment name")
	cmd.SilenceUsage = true
	return cmd
}

// ── port-forward ─────────────────────────────────────────────────────────────

func newDarlanePortForwardCmd() *cobra.Command {
	var env, ns, deploy, port string

	cmd := &cobra.Command{
		Use:   "port-forward <service>",
		Short: "Forward a local port to the Darlane pod",
		Args:  cobra.ExactArgs(1),
		Example: `  wxops darlane port-forward payment-api
  wxops darlane port-forward payment-api --port 3000:8080`,
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

			ns, deploy, err := resolveTarget(c, args[0], env, ns, deploy)
			if err != nil {
				return err
			}

			// Default port from entity annotation; fallback to 8080.
			if port == "" {
				containerPort := entity.Metadata.Annotations["wxops.cloud/container-port"]
				if containerPort == "" {
					containerPort = "8080"
				}
				port = containerPort + ":" + containerPort
			}

			fmt.Printf("Forwarding %s → %s/%s …\n", port, ns, deploy)
			fmt.Println("Press Ctrl-C to stop.")
			kubectl := exec.Command("kubectl", "port-forward",
				"-n", ns, "deployment/"+deploy, port)
			kubectl.Stdout = os.Stdout
			kubectl.Stderr = os.Stderr
			return kubectl.Run()
		},
	}

	cmd.Flags().StringVarP(&env, "env", "e", "dev", "Target environment: dev, staging, production")
	cmd.Flags().StringVarP(&ns, "namespace", "n", "", "Override K8s namespace")
	cmd.Flags().StringVar(&deploy, "deployment", "", "Override deployment name")
	cmd.Flags().StringVarP(&port, "port", "p", "", "Port mapping local:remote (default: container-port:container-port)")
	cmd.SilenceUsage = true
	return cmd
}
