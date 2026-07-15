package commands

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/spf13/cobra"
	"github.com/wxops/wxops-cli/internal/client"
)

// maxFlushInterval caps how long the debounce can keep accumulating before
// a flush is forced — prevents a continuous burst from never flushing.
const maxFlushInterval = 2 * time.Second

// defaultExcludes are always skipped during sync regardless of user flags.
var defaultExcludes = []string{".git", "node_modules", "__pycache__", ".next", "vendor"}

// ANSI color codes — applied only when stdout is a real terminal.
const (
	ansiReset  = "\033[0m"
	ansiBold   = "\033[1m"
	ansiRed    = "\033[31m"
	ansiGreen  = "\033[32m"
	ansiYellow = "\033[33m"
	ansiGray   = "\033[90m"
)

func isTerminal(w io.Writer) bool {
	if os.Getenv("NO_COLOR") != "" || os.Getenv("TERM") == "dumb" {
		return false
	}
	f, ok := w.(*os.File)
	if !ok {
		return false
	}
	info, err := f.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

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
	cmd.AddCommand(newDarlanePushCmd())
	cmd.AddCommand(newDarlaneLogsCmd())
	cmd.AddCommand(newDarlaneRestartCmd())
	cmd.AddCommand(newDarlaneStatusCmd())
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
	var noInitialSync, tailLogs bool

	cmd := &cobra.Command{
		Use:   "sync <service>",
		Short: "Watch local files and stream changes into the Darlane pod",
		Args:  cobra.ExactArgs(1),
		Example: `  wxops darlane sync payment-api
  wxops darlane sync payment-api --local ./src --remote /app/src
  wxops darlane sync payment-api --exclude '*.log' --exclude 'tmp/'
  wxops darlane sync payment-api --no-initial-sync`,
		RunE: func(cmd *cobra.Command, args []string) error {
			out := cmd.OutOrStdout()
			errOut := cmd.ErrOrStderr()

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

			merged := make([]string, 0, len(defaultExcludes)+len(excludes))
			merged = append(merged, defaultExcludes...)
			merged = append(merged, excludes...)

			// Collect all pre-flight results then print the startup summary.
			pf := runPreflight(c, args[0], env, absLocal, ns, deploy)
			printStartupSummary(out, args[0], env, ns, deploy, localPath, remotePath, pf)

			// Hard fail: tar unavailable means sync cannot work at all.
			if !pf.hasTar {
				if pf.podName != "" {
					fmt.Fprintf(errOut,
						"  kubectl debug -it %s -n %s \\\n"+
							"    --image=busybox --target=%s\n\n",
						pf.podName, ns, args[0])
				} else {
					fmt.Fprintf(errOut,
						"  # Resolve the pod name first\n"+
							"  kubectl get pod -n %s\n\n"+
							"  kubectl debug -it <pod-name> -n %s \\\n"+
							"    --image=busybox --target=%s\n\n",
						ns, ns, args[0])
				}
				return fmt.Errorf("image does not support darlane sync")
			}

			// Persist settings so `darlane restart` can re-seed without flags.
			saveDarlaneSession(args[0], env, darlaneSession{
				Local:    absLocal,
				Remote:   remotePath,
				Excludes: excludes,
			})

			watcher, err := fsnotify.NewWatcher()
			if err != nil {
				return fmt.Errorf("could not create watcher: %w", err)
			}
			defer watcher.Close()

			if err := addRecursive(watcher, absLocal, merged); err != nil {
				return fmt.Errorf("could not watch %s: %w", absLocal, err)
			}

			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer stop()

			fmt.Fprintf(out, "watching  %s  →  %s/%s:%s\n", localPath, ns, deploy, remotePath)

			if tailLogs {
				go streamPodLogs(ctx, ns, deploy, out)
			}

			// Initial full sync unless suppressed.
			if !noInitialSync {
				allFiles := collectAllFiles(absLocal, merged)
				if len(allFiles) > 0 {
					fmt.Fprintf(out, "→  initial sync: %d file(s)\n", len(allFiles))
					if _, err := withRetry(func() error {
						_, e := syncFiles(ns, deploy, absLocal, remotePath, allFiles, errOut)
						return e
					}, 3, 2*time.Second, func(i int) {
						fmt.Fprintf(errOut, "⚠  pod not ready, retrying (%d/3)…\n", i)
					}); err != nil {
						fmt.Fprintf(errOut, "error: initial sync: %v\n", err)
					} else if pf.darlaneEnabled {
						// Hint: files are in place; pod needs restart if it doesn't hot-reload.
						fmt.Fprintf(out, "   tip: if the pod doesn't hot-reload, restart it:\n")
						fmt.Fprintf(out, "        wxops darlane restart %s --local %s --remote %s\n", args[0], localPath, remotePath)
					}
				}
			}

			var (
				mu            sync.Mutex
				changed       = map[string]struct{}{}
				deleted       = map[string]struct{}{}
				firstChangeAt time.Time
				timer         *time.Timer
			)

			flush := func() {
				mu.Lock()
				if len(changed) == 0 && len(deleted) == 0 {
					mu.Unlock()
					return
				}
				firstChangeAt = time.Time{} // reset max-debounce clock

				delPaths := make([]string, 0, len(deleted))
				for p := range deleted {
					delPaths = append(delPaths, p)
				}
				deleted = map[string]struct{}{}

				chPaths := make([]string, 0, len(changed))
				for p := range changed {
					chPaths = append(chPaths, p)
				}
				changed = map[string]struct{}{}
				mu.Unlock()

				// Delete first so a delete-then-recreate lands in the right order.
				podReplaced := false
				if len(delPaths) > 0 {
					var relPaths []string
					if recovered, err := withRetry(func() error {
						var e error
						relPaths, e = deleteFiles(ns, deploy, remotePath, absLocal, delPaths)
						return e
					}, 3, 2*time.Second, func(i int) {
						fmt.Fprintf(errOut, "⚠  pod not ready, retrying (%d/3)…\n", i)
					}); err != nil {
						fmt.Fprintf(errOut, "error: delete: %v\n", err)
					} else {
						printFiles(out, "✗  deleted", relPaths)
						podReplaced = podReplaced || recovered
					}
				}

				if len(chPaths) > 0 {
					var relPaths []string
					if recovered, err := withRetry(func() error {
						var e error
						relPaths, e = syncFiles(ns, deploy, absLocal, remotePath, chPaths, errOut)
						return e
					}, 3, 2*time.Second, func(i int) {
						fmt.Fprintf(errOut, "⚠  pod not ready, retrying (%d/3)…\n", i)
					}); err != nil {
						fmt.Fprintf(errOut, "error: sync: %v\n", err)
					} else {
						printFiles(out, "↑  synced", relPaths)
						podReplaced = podReplaced || recovered
					}
				}

				// Pod was replaced mid-session — re-seed all local files so the new pod
				// matches local state. --no-initial-sync is intentionally not checked here:
				// that flag controls startup behaviour only, not mid-session recovery.
				if podReplaced {
					allFiles := collectAllFiles(absLocal, merged)
					if len(allFiles) > 0 {
						fmt.Fprintf(out, "⟳  pod replaced — re-seeding: %d file(s)\n", len(allFiles))
						if _, rerr := withRetry(func() error {
							_, e := syncFiles(ns, deploy, absLocal, remotePath, allFiles, errOut)
							return e
						}, 3, 2*time.Second, func(i int) {
							fmt.Fprintf(errOut, "⚠  pod not ready, retrying (%d/3)…\n", i)
						}); rerr != nil {
							fmt.Fprintf(errOut, "error: re-seed: %v\n", rerr)
						}
					}
				}
			}

			// scheduleFlush either fires flush immediately (max-debounce exceeded)
			// or resets the debounce timer. Always called from the event-loop goroutine.
			scheduleFlush := func(forceNow bool) {
				if forceNow {
					if timer != nil {
						timer.Stop()
						timer = nil
					}
					go flush()
				} else {
					if timer != nil {
						timer.Stop()
					}
					timer = time.AfterFunc(time.Duration(debounceMs)*time.Millisecond, flush)
				}
			}

			for {
				select {
				case event, ok := <-watcher.Events:
					if !ok {
						return nil
					}
					if isExcluded(event.Name, merged) {
						continue
					}

					if event.Has(fsnotify.Write) || event.Has(fsnotify.Create) || event.Has(fsnotify.Rename) {
						// Recursively watch newly created sub-directories.
						if event.Has(fsnotify.Create) {
							if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
								_ = addRecursive(watcher, event.Name, merged)
							}
						}
						mu.Lock()
						changed[event.Name] = struct{}{}
						delete(deleted, event.Name) // recreated — remove from deletion set
						if firstChangeAt.IsZero() {
							firstChangeAt = time.Now()
						}
						forceNow := time.Since(firstChangeAt) >= maxFlushInterval
						mu.Unlock()
						scheduleFlush(forceNow)

					} else if event.Has(fsnotify.Remove) {
						mu.Lock()
						deleted[event.Name] = struct{}{}
						delete(changed, event.Name) // deleted — don't sync
						if firstChangeAt.IsZero() {
							firstChangeAt = time.Now()
						}
						forceNow := time.Since(firstChangeAt) >= maxFlushInterval
						mu.Unlock()
						scheduleFlush(forceNow)
					}

				case err, ok := <-watcher.Errors:
					if !ok {
						return nil
					}
					fmt.Fprintf(errOut, "error: watcher: %v\n", err)

				case <-ctx.Done():
					if timer != nil {
						timer.Stop()
					}
					flush() // drain any pending changes before exit
					fmt.Fprintln(out, "stopped.")
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
	cmd.Flags().BoolVar(&noInitialSync, "no-initial-sync", false, "Skip the initial full sync on startup")
	cmd.Flags().BoolVar(&tailLogs, "tail-logs", false, "Stream pod logs alongside file sync events")
	cmd.SilenceUsage = true
	return cmd
}

// syncFiles tars the changed files and pipes them into the pod via kubectl exec.
// Returns the relative (to localBase) paths that were included in the archive.
func syncFiles(ns, deploy, localBase, remotePath string, changedPaths []string, errOut io.Writer) ([]string, error) {
	var relPaths []string
	for _, p := range changedPaths {
		rel, err := filepath.Rel(localBase, p)
		if err != nil || strings.HasPrefix(rel, "..") {
			continue
		}
		relPaths = append(relPaths, rel)
	}
	if len(relPaths) == 0 {
		return nil, nil
	}

	tarArgs := append([]string{"cf", "-"}, relPaths...)
	tarCmd := exec.Command("tar", tarArgs...)
	tarCmd.Dir = localBase
	tarCmd.Stderr = errOut

	kubectlCmd := exec.Command(
		"kubectl", "exec", "-i",
		"-n", ns,
		"deployment/"+deploy,
		"--", "tar", "xf", "-", "-C", remotePath,
	)
	kubectlCmd.Stderr = errOut

	pipe, err := tarCmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	kubectlCmd.Stdin = pipe

	if err := kubectlCmd.Start(); err != nil {
		return nil, fmt.Errorf("kubectl exec: %w", err)
	}
	if err := tarCmd.Run(); err != nil {
		return nil, fmt.Errorf("tar: %w", err)
	}
	pipe.Close()
	if err := kubectlCmd.Wait(); err != nil {
		return nil, fmt.Errorf("kubectl exec tar: %w", err)
	}

	return relPaths, nil
}

// deleteFiles removes paths from the pod with a single kubectl exec rm -rf.
// Each path is a separate argv element — no shell parsing, no injection risk.
// Returns the relative (to localBase) paths that were removed.
func deleteFiles(ns, deploy, remotePath, localBase string, paths []string) ([]string, error) {
	var relPaths, rmArgs []string
	for _, p := range paths {
		rel, err := filepath.Rel(localBase, p)
		if err != nil || strings.HasPrefix(rel, "..") {
			continue
		}
		relPaths = append(relPaths, rel)
		rmArgs = append(rmArgs, filepath.Join(remotePath, rel))
	}
	if len(rmArgs) == 0 {
		return nil, nil
	}

	args := append([]string{"exec", "-n", ns, "deployment/" + deploy, "--", "rm", "-rf"}, rmArgs...)
	out, err := exec.Command("kubectl", args...).CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("kubectl exec rm: %s: %w", strings.TrimSpace(string(out)), err)
	}
	return relPaths, nil
}

// collectAllFiles returns absolute paths for all regular files under root,
// skipping excluded directories and files.
func collectAllFiles(root string, excludes []string) []string {
	var files []string
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if isExcluded(path, excludes) {
				return filepath.SkipDir
			}
			return nil
		}
		if !d.Type().IsRegular() {
			return nil
		}
		if !isExcluded(path, excludes) {
			files = append(files, path)
		}
		return nil
	})
	return files
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
		if strings.Contains(path, string(filepath.Separator)+ex+string(filepath.Separator)) ||
			strings.HasSuffix(path, string(filepath.Separator)+ex) {
			return true
		}
	}
	return false
}

// probeTar checks whether the pod has a tar binary available.
func probeTar(ns, deploy string) bool {
	err := exec.Command(
		"kubectl", "exec", "-n", ns, "deployment/"+deploy,
		"--", "tar", "--version",
	).Run()
	return err == nil
}

// lookupPodName resolves a running pod name for the given deployment.
// Returns an empty string if no pod could be found.
func lookupPodName(ns, deploy string) string {
	for _, label := range []string{"app=" + deploy, "app.kubernetes.io/name=" + deploy} {
		out, err := exec.Command(
			"kubectl", "get", "pod", "-n", ns,
			"-l", label,
			"--field-selector=status.phase=Running",
			"-o", "jsonpath={.items[0].metadata.name}",
		).Output()
		if err == nil {
			if name := strings.TrimSpace(string(out)); name != "" {
				return name
			}
		}
	}
	return ""
}

// ── session state ─────────────────────────────────────────────────────────────

// darlaneSession persists the sync settings for a service+env so that
// `darlane restart` can re-seed using the same paths without requiring the
// user to re-specify --local / --remote / --exclude.
type darlaneSession struct {
	Local    string   `json:"local"`
	Remote   string   `json:"remote"`
	Excludes []string `json:"excludes,omitempty"`
}

func darlaneSessionPath(service, env string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".wxops", fmt.Sprintf("darlane-%s-%s.json", service, env)), nil
}

// saveDarlaneSession writes session state silently — errors are non-fatal.
func saveDarlaneSession(service, env string, s darlaneSession) {
	path, err := darlaneSessionPath(service, env)
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o700)
	data, _ := json.MarshalIndent(s, "", "  ")
	_ = os.WriteFile(path, data, 0o600)
}

// loadDarlaneSession returns nil when no session file exists or it cannot be parsed.
func loadDarlaneSession(service, env string) *darlaneSession {
	path, err := darlaneSessionPath(service, env)
	if err != nil {
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var s darlaneSession
	if json.Unmarshal(data, &s) != nil {
		return nil
	}
	return &s
}

// ── retry ─────────────────────────────────────────────────────────────────────

// withRetry calls op up to attempts times. Between failures it calls warn with
// the 1-indexed attempt number and sleeps for delay before the next try.
// recovered is true when op succeeded after one or more failures (pod replaced mid-session).
func withRetry(op func() error, attempts int, delay time.Duration, warn func(int)) (recovered bool, err error) {
	for i := 0; i < attempts; i++ {
		if err = op(); err == nil {
			return i > 0, nil
		}
		if i < attempts-1 {
			if warn != nil {
				warn(i + 1)
			}
			time.Sleep(delay)
		}
	}
	return false, err
}

// ── pre-flight ────────────────────────────────────────────────────────────────

type preflightResult struct {
	// catalog entity
	entityFound bool
	entityErr   error
	// overlay / darlane
	catalogChecked    bool
	overlayExists     bool
	darlaneEnabled    bool
	mountPathConfigured string // fileSync.mountPath from overlay, empty if not set
	// project language
	langDetected bool
	localLang    string
	catalogLangs []string
	langMatch    bool
	// tar probe
	hasTar  bool
	podName string // resolved when hasTar=false, for the kubectl debug hint
}

// langMarkers maps sentinel files to language identifiers that match catalog tags.
var langMarkers = []struct{ file, lang string }{
	{"go.mod", "go"},
	{"pyproject.toml", "python"},
	{"requirements.txt", "python"},
	{"package.json", "node"},
	{"Cargo.toml", "rust"},
	{"pom.xml", "java"},
	{"build.gradle", "java"},
	{"build.gradle.kts", "java"},
}

var knownLangs = map[string]bool{
	"go": true, "python": true, "node": true, "nodejs": true,
	"rust": true, "java": true,
}

func runPreflight(c *client.Client, service, env, localDir, ns, deploy string) preflightResult {
	var p preflightResult

	entity, err := c.GetEntity("Component", service)
	if err != nil {
		p.entityErr = err
	} else {
		p.entityFound = true

		// Overlay / darlane status from portal.
		if status, serr := c.GetPromoStatus("Component", service); serr == nil {
			p.catalogChecked = true
			var overlay client.PromoStatusOverlay
			switch env {
			case "staging":
				overlay = status.Overlays.Staging
			case "production":
				overlay = status.Overlays.Production
			default:
				overlay = status.Overlays.Dev
			}
			p.overlayExists = overlay.Exists
			p.darlaneEnabled = overlay.DarlaneEnabled
			p.mountPathConfigured = overlay.FileSyncMountPath
		}

		// Detect local project language and compare against catalog tags.
		for _, m := range langMarkers {
			if _, serr := os.Stat(filepath.Join(localDir, m.file)); serr == nil {
				p.langDetected = true
				p.localLang = m.lang
				break
			}
		}
		if p.langDetected {
			for _, tag := range entity.Metadata.Tags {
				if strings.EqualFold(tag, p.localLang) ||
					(p.localLang == "node" && strings.EqualFold(tag, "nodejs")) {
					p.langMatch = true
					break
				}
			}
			for _, tag := range entity.Metadata.Tags {
				if knownLangs[strings.ToLower(tag)] {
					p.catalogLangs = append(p.catalogLangs, tag)
				}
			}
		}
	}

	// Tar probe — independent of catalog, always runs.
	p.hasTar = probeTar(ns, deploy)
	if !p.hasTar {
		p.podName = lookupPodName(ns, deploy)
	}

	return p
}

func printStartupSummary(w io.Writer, service, env, ns, deploy, localPath, remotePath string, p preflightResult) {
	useColor := isTerminal(w)
	paint := func(code, s string) string {
		if !useColor {
			return s
		}
		return code + s + ansiReset
	}

	div := paint(ansiGray, "  "+strings.Repeat("─", 50))
	symOK   := paint(ansiGreen,  "✓")
	symWarn := paint(ansiYellow, "⚠")
	symFail := paint(ansiRed,    "✗")

	rowOK   := func(msg string) { fmt.Fprintf(w, "  %s  %s\n", symOK, msg) }
	rowWarn := func(msg string) { fmt.Fprintf(w, "  %s  %s\n", symWarn, msg) }
	rowFail := func(msg string) { fmt.Fprintf(w, "  %s  %s\n", symFail, msg) }
	rowHint := func(msg string) { fmt.Fprintf(w, "     %s\n", paint(ansiGray, msg)) }

	// ── header ──
	fmt.Fprintln(w)
	fmt.Fprintln(w, paint(ansiBold, "  darlane sync"))
	fmt.Fprintln(w, div)

	// ── info fields ──
	// Compute padding from raw label length — %-*s counts ANSI bytes as width.
	const labelW = 13
	field := func(label, value string) {
		pad := labelW - len(label)
		if pad < 0 {
			pad = 0
		}
		fmt.Fprintf(w, "  %s%s %s\n",
			paint(ansiYellow, label),
			strings.Repeat(" ", pad),
			paint(ansiBold, value),
		)
	}
	field("component", service)
	field("env", env)
	field("namespace", ns)
	field("deployment", deploy)
	field("sync", fmt.Sprintf("%s  →  %s", localPath, remotePath))

	// ── pre-flight ──
	fmt.Fprintln(w)
	fmt.Fprintln(w, paint(ansiYellow, "  pre-flight"))

	// Entity
	if p.entityFound {
		rowOK("catalog entity found")
	} else {
		rowWarn(fmt.Sprintf("catalog entity: %v — skipping catalog checks", p.entityErr))
	}

	// Overlay / darlane (only when entity was found)
	if p.entityFound {
		if !p.catalogChecked {
			rowWarn("could not verify darlane config from portal")
		} else if !p.overlayExists {
			rowWarn(fmt.Sprintf("no overlay for %q — create via portal Promotion panel", env))
			rowHint("synced files will not survive pod restart")
		} else if !p.darlaneEnabled {
			rowWarn(fmt.Sprintf("darlane not enabled for %q — enable via portal", env))
			rowHint("synced files will not survive pod restart")
		} else {
			rowOK(fmt.Sprintf("darlane enabled for %q", env))
		}
	}

	// Mount path mismatch (only when darlane is enabled and a path is configured)
	if p.darlaneEnabled && p.mountPathConfigured != "" && p.mountPathConfigured != remotePath {
		rowWarn(fmt.Sprintf("mount path mismatch: configured as %s, got --remote %s", p.mountPathConfigured, remotePath))
		rowHint(fmt.Sprintf("use: --remote %s", p.mountPathConfigured))
	}

	// Project language
	if p.langDetected {
		if p.langMatch {
			rowOK(fmt.Sprintf("project: %s", p.localLang))
		} else if len(p.catalogLangs) > 0 {
			rowWarn(fmt.Sprintf("project: %s (catalog: %s) — verify --local path",
				p.localLang, strings.Join(p.catalogLangs, ", ")))
		} else {
			rowOK(fmt.Sprintf("project: %s", p.localLang))
		}
	}

	// Tar
	if p.hasTar {
		rowOK("tar available in pod")
	} else {
		rowFail("tar not found in pod — use kubectl debug (see below)")
	}

	fmt.Fprintln(w, div)
	fmt.Fprintln(w)
}

// printFiles writes a one-line sync/delete summary. Lists up to 5 file names;
// truncates the rest with "… and N more".
func printFiles(w io.Writer, prefix string, relPaths []string) {
	const maxShow = 5
	n := len(relPaths)
	if n == 0 {
		return
	}
	if n <= maxShow {
		fmt.Fprintf(w, "%s %d file(s): %s\n", prefix, n, strings.Join(relPaths, ", "))
	} else {
		fmt.Fprintf(w, "%s %d file(s): %s … and %d more\n",
			prefix, n, strings.Join(relPaths[:maxShow], ", "), n-maxShow)
	}
}

// ── push ─────────────────────────────────────────────────────────────────────

func newDarlanePushCmd() *cobra.Command {
	var env, ns, deploy, localPath, remotePath string
	var excludes []string

	cmd := &cobra.Command{
		Use:   "push <service>",
		Short: "One-shot sync of local files into the Darlane pod (no watcher)",
		Args:  cobra.ExactArgs(1),
		Example: `  wxops darlane push payment-api
  wxops darlane push payment-api --local ./src --remote /app/src`,
		RunE: func(cmd *cobra.Command, args []string) error {
			out    := cmd.OutOrStdout()
			errOut := cmd.ErrOrStderr()

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

			merged := append(append([]string{}, defaultExcludes...), excludes...)

			pf := runPreflight(c, args[0], env, absLocal, ns, deploy)
			printStartupSummary(out, args[0], env, ns, deploy, localPath, remotePath, pf)

			if !pf.hasTar {
				if pf.podName != "" {
					fmt.Fprintf(errOut, "  kubectl debug -it %s -n %s \\\n    --image=busybox --target=%s\n\n", pf.podName, ns, args[0])
				} else {
					fmt.Fprintf(errOut, "  kubectl get pod -n %s\n  kubectl debug -it <pod-name> -n %s \\\n    --image=busybox --target=%s\n\n", ns, ns, args[0])
				}
				return fmt.Errorf("image does not support darlane sync")
			}

			// Persist settings so `darlane restart` can re-seed without flags.
			saveDarlaneSession(args[0], env, darlaneSession{
				Local:    absLocal,
				Remote:   remotePath,
				Excludes: excludes,
			})

			allFiles := collectAllFiles(absLocal, merged)
			if len(allFiles) == 0 {
				fmt.Fprintln(out, "nothing to sync")
				return nil
			}
			fmt.Fprintf(out, "→  syncing %d file(s)…\n", len(allFiles))
			if _, err := withRetry(func() error {
				_, e := syncFiles(ns, deploy, absLocal, remotePath, allFiles, errOut)
				return e
			}, 3, 2*time.Second, func(i int) {
				fmt.Fprintf(errOut, "⚠  pod not ready, retrying (%d/3)…\n", i)
			}); err != nil {
				return fmt.Errorf("sync: %w", err)
			}
			fmt.Fprintln(out, "✓  done")
			if pf.darlaneEnabled {
				fmt.Fprintf(out, "   tip: if the pod doesn't hot-reload, restart it:\n")
				fmt.Fprintf(out, "        wxops darlane restart %s\n", args[0])
			}
			return nil
		},
	}
	cmd.Flags().StringVarP(&env, "env", "e", "dev", "Target environment: dev, staging, production")
	cmd.Flags().StringVarP(&ns, "namespace", "n", "", "Override K8s namespace")
	cmd.Flags().StringVar(&deploy, "deployment", "", "Override deployment name")
	cmd.Flags().StringVar(&localPath, "local", ".", "Local directory to sync")
	cmd.Flags().StringVar(&remotePath, "remote", "/app", "Remote path inside the container")
	cmd.Flags().StringArrayVar(&excludes, "exclude", nil, "Glob pattern to exclude (repeatable)")
	cmd.SilenceUsage = true
	return cmd
}

// ── logs ──────────────────────────────────────────────────────────────────────

func newDarlaneLogsCmd() *cobra.Command {
	var env, ns, deploy string
	var follow bool
	var tail int

	cmd := &cobra.Command{
		Use:   "logs <service>",
		Short: "Stream logs from the Darlane pod",
		Args:  cobra.ExactArgs(1),
		Example: `  wxops darlane logs payment-api
  wxops darlane logs payment-api --no-follow --tail 50`,
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

			kubectlArgs := []string{
				"logs", "-n", ns, "deployment/" + deploy,
				fmt.Sprintf("--tail=%d", tail),
			}
			if follow {
				kubectlArgs = append(kubectlArgs, "-f")
			}
			kubectl := exec.Command("kubectl", kubectlArgs...)
			kubectl.Stdout = cmd.OutOrStdout()
			kubectl.Stderr = cmd.ErrOrStderr()
			return kubectl.Run()
		},
	}
	cmd.Flags().StringVarP(&env, "env", "e", "dev", "Target environment: dev, staging, production")
	cmd.Flags().StringVarP(&ns, "namespace", "n", "", "Override K8s namespace")
	cmd.Flags().StringVar(&deploy, "deployment", "", "Override deployment name")
	cmd.Flags().BoolVarP(&follow, "follow", "f", true, "Stream logs in follow mode")
	cmd.Flags().IntVar(&tail, "tail", 100, "Number of recent lines to show on start")
	cmd.SilenceUsage = true
	return cmd
}

// streamPodLogs tails pod logs in a goroutine, prefixing each line with [pod].
// Retries automatically when the pod restarts. Exits when ctx is cancelled.
func streamPodLogs(ctx context.Context, ns, deploy string, out io.Writer) {
	useColor := isTerminal(out)
	prefix := "[pod] "
	if useColor {
		prefix = ansiGray + "[pod]" + ansiReset + " "
	}
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		kubectl := exec.CommandContext(ctx, "kubectl", "logs", "-f", "--tail=50",
			"-n", ns, "deployment/"+deploy)
		stdout, err := kubectl.StdoutPipe()
		if err != nil {
			return
		}
		kubectl.Stderr = io.Discard
		if err := kubectl.Start(); err != nil {
			select {
			case <-ctx.Done():
				return
			case <-time.After(3 * time.Second):
				continue
			}
		}
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			fmt.Fprintf(out, "%s%s\n", prefix, scanner.Text())
		}
		kubectl.Wait()
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

// ── restart ───────────────────────────────────────────────────────────────────

func newDarlaneRestartCmd() *cobra.Command {
	var env, ns, deploy, localPath, remotePath string
	var excludes []string

	cmd := &cobra.Command{
		Use:   "restart <service>",
		Short: "Rollout restart the Darlane pod and re-seed local files",
		Args:  cobra.ExactArgs(1),
		Example: `  wxops darlane restart payment-api
  wxops darlane restart payment-api --env staging
  wxops darlane restart payment-api --local ./app --remote /app`,
		RunE: func(cmd *cobra.Command, args []string) error {
			out    := cmd.OutOrStdout()
			errOut := cmd.ErrOrStderr()

			creds, err := client.LoadCredentials()
			if err != nil {
				return err
			}
			c := client.New(creds)

			ns, deploy, err = resolveTarget(c, args[0], env, ns, deploy)
			if err != nil {
				return err
			}

			// Apply saved session settings where the user did not pass explicit flags.
			if sess := loadDarlaneSession(args[0], env); sess != nil {
				if !cmd.Flags().Changed("local") {
					localPath = sess.Local
				}
				if !cmd.Flags().Changed("remote") {
					remotePath = sess.Remote
				}
				if !cmd.Flags().Changed("exclude") && len(sess.Excludes) > 0 {
					excludes = sess.Excludes
				}
			}

			fmt.Fprintf(out, "↻  restarting %s/%s…\n", ns, deploy)
			restart := exec.Command("kubectl", "rollout", "restart",
				"-n", ns, "deployment/"+deploy)
			restart.Stdout = out
			restart.Stderr = errOut
			if err := restart.Run(); err != nil {
				return fmt.Errorf("rollout restart: %w", err)
			}
			status := exec.Command("kubectl", "rollout", "status",
				"-n", ns, "deployment/"+deploy, "--timeout=120s")
			status.Stdout = out
			status.Stderr = errOut
			if err := status.Run(); err != nil {
				return err
			}

			// Re-seed local files into the new pod so it starts with local state,
			// not bare image state.
			absLocal, err := filepath.Abs(localPath)
			if err != nil {
				return fmt.Errorf("resolving --local: %w", err)
			}
			merged := append(append([]string{}, defaultExcludes...), excludes...)
			allFiles := collectAllFiles(absLocal, merged)
			if len(allFiles) == 0 {
				return nil
			}
			fmt.Fprintf(out, "⟳  re-seeding: %d file(s)…\n", len(allFiles))
			if _, rerr := withRetry(func() error {
				_, e := syncFiles(ns, deploy, absLocal, remotePath, allFiles, errOut)
				return e
			}, 3, 2*time.Second, func(i int) {
				fmt.Fprintf(errOut, "⚠  pod not ready, retrying (%d/3)…\n", i)
			}); rerr != nil {
				return fmt.Errorf("re-seed: %w", rerr)
			}
			fmt.Fprintln(out, "✓  done")
			return nil
		},
	}
	cmd.Flags().StringVarP(&env, "env", "e", "dev", "Target environment: dev, staging, production")
	cmd.Flags().StringVarP(&ns, "namespace", "n", "", "Override K8s namespace")
	cmd.Flags().StringVar(&deploy, "deployment", "", "Override deployment name")
	cmd.Flags().StringVar(&localPath, "local", ".", "Override local directory (default: from last sync/push session)")
	cmd.Flags().StringVar(&remotePath, "remote", "/app", "Override remote path (default: from last sync/push session)")
	cmd.Flags().StringArrayVar(&excludes, "exclude", nil, "Override exclude patterns (default: from last sync/push session)")
	cmd.SilenceUsage = true
	return cmd
}

// ── status ────────────────────────────────────────────────────────────────────

func newDarlaneStatusCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "status <service>",
		Short: "Show Darlane status across environments",
		Args:  cobra.ExactArgs(1),
		Example: `  wxops darlane status payment-api`,
		RunE: func(cmd *cobra.Command, args []string) error {
			out := cmd.OutOrStdout()

			creds, err := client.LoadCredentials()
			if err != nil {
				return err
			}
			c := client.New(creds)

			status, err := c.GetPromoStatus("Component", args[0])
			if err != nil {
				return fmt.Errorf("could not fetch status: %w", err)
			}

			useColor := isTerminal(out)
			paint := func(code, s string) string {
				if !useColor {
					return s
				}
				return code + s + ansiReset
			}
			div := paint(ansiGray, "  "+strings.Repeat("─", 50))

			symOK   := paint(ansiGreen,  "✓")
			symNone := paint(ansiGray,   "–")

			fmt.Fprintln(out)
			fmt.Fprintln(out, paint(ansiBold, "  darlane status  ")+paint(ansiBold, args[0]))
			fmt.Fprintln(out, div)

			type envRow struct {
				name    string
				overlay client.PromoStatusOverlay
				tag     *client.EnvTag
			}
			rows := []envRow{
				{"dev",        status.Overlays.Dev,        status.Tags.Dev},
				{"staging",    status.Overlays.Staging,    status.Tags.Staging},
				{"production", status.Overlays.Production, status.Tags.Production},
			}
			for _, row := range rows {
				fmt.Fprintln(out)
				fmt.Fprintln(out, "  "+paint(ansiYellow, row.name))

				if !row.overlay.Exists {
					fmt.Fprintf(out, "    %s  no overlay — create via portal Promotion panel\n", symNone)
				} else {
					overlayMark := symOK
					darlanePart := symNone + "  darlane not enabled"
					if row.overlay.DarlaneEnabled {
						darlanePart = symOK + "  darlane enabled"
						if row.overlay.FileSyncMountPath != "" {
							darlanePart += "  ·  filesync " + paint(ansiBold, row.overlay.FileSyncMountPath)
						}
					} else {
						overlayMark = symOK
					}
					fmt.Fprintf(out, "    %s  overlay  %s\n", overlayMark, darlanePart)
				}

				if row.tag != nil && row.tag.Tag != "" {
					label := "image"
					tag := row.tag.Tag
					if row.tag.Date != "" {
						tag += paint(ansiGray, "  ("+row.tag.Date+")")
					}
					pad := 9 - len(label)
					fmt.Fprintf(out, "    %s%s %s\n",
						paint(ansiGray, label),
						strings.Repeat(" ", pad),
						paint(ansiBold, tag),
					)
				}
			}

			fmt.Fprintln(out)
			if status.Lifecycle != "" {
				lpad := 9 - len("lifecycle")
				fmt.Fprintf(out, "  %s%s %s\n",
					paint(ansiGray, "lifecycle"),
					strings.Repeat(" ", lpad),
					paint(ansiBold, status.Lifecycle),
				)
			}
			fmt.Fprintln(out, div)
			fmt.Fprintln(out)
			return nil
		},
	}
	cmd.SilenceUsage = true
	return cmd
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

			fmt.Fprintf(cmd.OutOrStdout(), "Opening shell in %s/%s …\n", ns, deploy)
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

			if port == "" {
				containerPort := entity.Metadata.Annotations["wxops.cloud/container-port"]
				if containerPort == "" {
					containerPort = "8080"
				}
				port = containerPort + ":" + containerPort
			}

			fmt.Fprintf(cmd.OutOrStdout(), "Forwarding %s → %s/%s …\nPress Ctrl-C to stop.\n", port, ns, deploy)
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
