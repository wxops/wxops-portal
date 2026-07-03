package gitea

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// TemplateRepo represents a Gitea repository marked as a template.
type TemplateRepo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	FullName    string `json:"full_name"`
	HTMLURL     string `json:"html_url"`
}

// RepoInfo is returned after creating a repository.
type RepoInfo struct {
	Name     string `json:"name"`
	FullName string `json:"full_name"`
	HTMLURL  string `json:"html_url"`
	CloneURL string `json:"clone_url"`
}

// PullRequestInfo is returned after opening or listing a pull request.
type PullRequestInfo struct {
	Number    int    `json:"number"`
	HTMLURL   string `json:"html_url"`
	Title     string `json:"title"`
	State     string `json:"state"`
	Merged    bool   `json:"merged"`
	MergedAt  string `json:"merged_at"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
	User      *struct {
		Login string `json:"login"`
	} `json:"user,omitempty"`
}

// ListTemplateRepos returns all repositories marked as templates.
// When owner is non-empty, results are scoped to that organisation.
func (c *Client) ListTemplateRepos(ctx context.Context, owner string) ([]TemplateRepo, error) {
	path := "/api/v1/repos/search?template=true&limit=50"
	if owner != "" {
		path += "&owner=" + url.QueryEscape(owner)
	}

	body, err := c.doRaw(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("gitea: list templates: %w", err)
	}

	var result struct {
		Data []TemplateRepo `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("gitea: decode template list: %w", err)
	}
	return result.Data, nil
}

// CreateRepoFromTemplate creates a new repository from a template repository.
func (c *Client) CreateRepoFromTemplate(ctx context.Context, templateOwner, templateRepo, newOwner, newName, description string) (*RepoInfo, error) {
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/generate",
		c.baseURL, templateOwner, templateRepo)

	payload := map[string]any{
		"owner":       newOwner,
		"name":        newName,
		"description": description,
		"git_content": true,
		"topics":      true,
		"private":     true,
	}

	body, err := c.doRaw(ctx, http.MethodPost, apiURL, payload)
	if err != nil {
		return nil, fmt.Errorf("gitea: create repo from template: %w", err)
	}

	var info RepoInfo
	if err := json.Unmarshal(body, &info); err != nil {
		return nil, fmt.Errorf("gitea: decode repo info: %w", err)
	}
	return &info, nil
}

// CreateBranch creates a new branch from an existing ref.
func (c *Client) CreateBranch(ctx context.Context, owner, repo, branchName, fromRef string) error {
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/branches",
		c.baseURL, owner, repo)

	payload := map[string]string{
		"new_branch_name": branchName,
		"old_branch_name": fromRef,
	}

	_, err := c.doRaw(ctx, http.MethodPost, apiURL, payload)
	if err != nil {
		return fmt.Errorf("gitea: create branch %q: %w", branchName, err)
	}
	return nil
}

// ProtectBranch creates a branch protection rule that prevents deletion and
// force-pushes. For develop, direct pushes are allowed (CI uses it). For
// staging and main, all changes must arrive via PR with at least 1 approval.
//
// pushWhitelist lists Gitea usernames that may push directly even when
// requirePR is true — use this to allow a CI bot to push changelog commits
// (e.g. chore(release): [skip ci]) to main without a PR.
//
// Gitea API: POST /repos/{owner}/{repo}/branch_protections
// Having any protection rule also blocks branch deletion by non-admins.
func (c *Client) ProtectBranch(ctx context.Context, owner, repo, branch string, requirePR bool, pushWhitelist ...string) error {
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/branch_protections",
		c.baseURL, owner, repo)

	requiredApprovals := 0
	if requirePR {
		requiredApprovals = 1
	}

	// When a whitelist is provided with requirePR, enable push but restrict it
	// to whitelisted users only — everyone else must still go through a PR.
	enablePush := !requirePR
	enablePushWhitelist := false
	if requirePR && len(pushWhitelist) > 0 {
		enablePush = true
		enablePushWhitelist = true
	}

	payload := map[string]any{
		"branch_name":               branch,
		"enable_push":               enablePush,
		"enable_push_whitelist":     enablePushWhitelist,
		"required_approvals":        requiredApprovals,
		"block_on_rejected_reviews": requirePR,
	}
	if enablePushWhitelist {
		payload["push_whitelist_usernames"] = pushWhitelist
	}

	_, err := c.doRaw(ctx, http.MethodPost, apiURL, payload)
	if err != nil {
		return fmt.Errorf("gitea: protect branch %q: %w", branch, err)
	}
	return nil
}

// GetBranchSHA returns the HEAD commit SHA of a branch.
func (c *Client) GetBranchSHA(ctx context.Context, owner, repo, branch string) (string, error) {
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/branches/%s",
		c.baseURL, owner, repo, url.QueryEscape(branch))

	body, err := c.doRaw(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return "", fmt.Errorf("gitea: get branch %q: %w", branch, err)
	}

	var result struct {
		Commit struct {
			ID string `json:"id"`
		} `json:"commit"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("gitea: decode branch info: %w", err)
	}
	return result.Commit.ID, nil
}

// CreateTag creates a git tag on a repo pointing at the given target (branch or SHA).
func (c *Client) CreateTag(ctx context.Context, owner, repo, tagName, target string) error {
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/tags",
		c.baseURL, owner, repo)

	payload := map[string]string{
		"tag_name": tagName,
		"target":   target,
	}

	_, err := c.doRaw(ctx, http.MethodPost, apiURL, payload)
	if err != nil {
		return fmt.Errorf("gitea: create tag %q: %w", tagName, err)
	}
	return nil
}

// RepoExists returns true if a repository exists and is accessible.
func (c *Client) RepoExists(ctx context.Context, owner, repo string) bool {
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s",
		c.baseURL, owner, repo)
	_, err := c.doRaw(ctx, http.MethodGet, apiURL, nil)
	return err == nil
}

// ChangeFileOp represents a single file operation in a batch commit.
type ChangeFileOp struct {
	Operation string `json:"operation"` // "create", "update", "delete"
	Path      string `json:"path"`
	Content   string `json:"content"` // base64-encoded
}

// CommitFiles creates or updates multiple files in a single commit.
// Uses Gitea's ChangeFiles API (POST /repos/{owner}/{repo}/contents).
// Files that already exist in the repo are updated rather than created.
func (c *Client) CommitFiles(ctx context.Context, owner, repo, branch, commitMsg string, files map[string][]byte) error {
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/contents",
		c.baseURL, owner, repo)

	existing := c.listExistingFiles(ctx, owner, repo, branch)

	var ops []ChangeFileOp
	for path, content := range files {
		op := "create"
		if existing[path] {
			op = "update"
		}
		ops = append(ops, ChangeFileOp{
			Operation: op,
			Path:      path,
			Content:   base64.StdEncoding.EncodeToString(content),
		})
	}

	payload := map[string]any{
		"branch":  branch,
		"message": commitMsg,
		"files":   ops,
	}

	_, err := c.doRaw(ctx, http.MethodPost, apiURL, payload)
	if err != nil {
		return fmt.Errorf("gitea: commit %d files: %w", len(files), err)
	}
	return nil
}

// listExistingFiles returns a set of file paths that already exist at the repo root.
func (c *Client) listExistingFiles(ctx context.Context, owner, repo, ref string) map[string]bool {
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/git/trees/%s?recursive=true",
		c.baseURL, owner, repo, url.QueryEscape(ref))

	body, err := c.doRaw(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil
	}

	var result struct {
		Tree []struct {
			Path string `json:"path"`
			Type string `json:"type"`
		} `json:"tree"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil
	}

	files := make(map[string]bool, len(result.Tree))
	for _, e := range result.Tree {
		if e.Type == "blob" {
			files[e.Path] = true
		}
	}
	return files
}



// CreateOrUpdateFile creates or updates a file in a repository on a given branch.
// If the file already exists, it performs a PUT with the current SHA (update).
// If the file does not exist, it performs a POST (create).
func (c *Client) CreateOrUpdateFile(ctx context.Context, owner, repo, filePath string, content []byte, commitMsg, branch string) (string, error) {
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/contents/%s",
		c.baseURL, owner, repo, filePath)

	payload := map[string]string{
		"content": base64.StdEncoding.EncodeToString(content),
		"message": commitMsg,
		"branch":  branch,
	}

	method := http.MethodPost
	if sha, err := c.getFileSHA(ctx, owner, repo, filePath, branch); err == nil && sha != "" {
		method = http.MethodPut
		payload["sha"] = sha
	}

	body, err := c.doRaw(ctx, method, apiURL, payload)
	if err != nil {
		return "", fmt.Errorf("gitea: write file %q: %w", filePath, err)
	}

	var result struct {
		Content struct {
			SHA string `json:"sha"`
		} `json:"content"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("gitea: decode file response: %w", err)
	}
	return result.Content.SHA, nil
}

// getFileSHA returns the SHA of a file on a given branch. Returns "" if the file does not exist.
func (c *Client) getFileSHA(ctx context.Context, owner, repo, filePath, ref string) (string, error) {
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/contents/%s?ref=%s",
		c.baseURL, owner, repo, filePath, url.QueryEscape(ref))

	body, err := c.doRaw(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return "", err
	}

	var meta struct {
		SHA string `json:"sha"`
	}
	if err := json.Unmarshal(body, &meta); err != nil {
		return "", err
	}
	return meta.SHA, nil
}

// FileExistsOnMain returns true if the given path exists on the main branch
// of the repo. Returns false (not an error) on 404.
func (c *Client) FileExistsOnMain(ctx context.Context, owner, repo, filePath string) (bool, error) {
	_, err := c.getFileSHA(ctx, owner, repo, filePath, "main")
	if err != nil {
		if strings.Contains(err.Error(), "404") {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// EnsureLabel creates a label in a repo if it doesn't already exist and
// returns its ID. Safe to call repeatedly — idempotent.
func (c *Client) EnsureLabel(ctx context.Context, owner, repo, name, color string) (int64, error) {
	listURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/labels?limit=50",
		c.baseURL, owner, repo)

	body, err := c.doRaw(ctx, http.MethodGet, listURL, nil)
	if err != nil {
		return 0, fmt.Errorf("gitea: list labels: %w", err)
	}

	var labels []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(body, &labels); err != nil {
		return 0, fmt.Errorf("gitea: decode labels: %w", err)
	}
	for _, l := range labels {
		if l.Name == name {
			return l.ID, nil
		}
	}

	createURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/labels",
		c.baseURL, owner, repo)
	payload := map[string]string{"name": name, "color": color}
	body, err = c.doRaw(ctx, http.MethodPost, createURL, payload)
	if err != nil {
		return 0, fmt.Errorf("gitea: create label %q: %w", name, err)
	}

	var created struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(body, &created); err != nil {
		return 0, fmt.Errorf("gitea: decode created label: %w", err)
	}
	return created.ID, nil
}

// CreatePullRequest opens a pull request in a repository.
// Optional labelIDs are attached to the PR for filtering.
func (c *Client) CreatePullRequest(ctx context.Context, owner, repo, title, body, head, base string, labelIDs ...int64) (*PullRequestInfo, error) {
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/pulls",
		c.baseURL, owner, repo)

	payload := map[string]any{
		"title": title,
		"body":  body,
		"head":  head,
		"base":  base,
	}
	if len(labelIDs) > 0 {
		payload["labels"] = labelIDs
	}

	respBody, err := c.doRaw(ctx, http.MethodPost, apiURL, payload)
	if err != nil {
		return nil, fmt.Errorf("gitea: create PR: %w", err)
	}

	var info PullRequestInfo
	if err := json.Unmarshal(respBody, &info); err != nil {
		return nil, fmt.Errorf("gitea: decode PR info: %w", err)
	}
	return &info, nil
}

// ListPullRequests returns pull requests for a repository with pagination.
// state can be "open", "closed", or "all".
// Optional labelIDs filters to PRs that have ALL specified labels.
func (c *Client) ListPullRequests(ctx context.Context, owner, repo, state string, page, limit int, labelIDs ...int64) ([]PullRequestInfo, int, error) {
	if limit <= 0 {
		limit = 20
	}
	if page < 1 {
		page = 1
	}
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/pulls?state=%s&sort=newest&limit=%d&page=%d",
		c.baseURL, owner, repo, url.QueryEscape(state), limit, page)
	if len(labelIDs) > 0 {
		var ids []string
		for _, id := range labelIDs {
			ids = append(ids, fmt.Sprintf("%d", id))
		}
		apiURL += "&labels=" + strings.Join(ids, ",")
	}

	body, headers, err := c.doRawWithHeaders(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, 0, fmt.Errorf("gitea: list PRs: %w", err)
	}

	var prs []PullRequestInfo
	if err := json.Unmarshal(body, &prs); err != nil {
		return nil, 0, fmt.Errorf("gitea: decode PR list: %w", err)
	}

	total := 0
	if tc := headers.Get("X-Total-Count"); tc != "" {
		fmt.Sscanf(tc, "%d", &total)
	}
	if total == 0 {
		total = len(prs)
	}

	return prs, total, nil
}

// PRComment represents a comment on a pull request.
type PRComment struct {
	ID        int64  `json:"id"`
	Body      string `json:"body"`
	CreatedAt string `json:"created_at"`
	User      *struct {
		Login string `json:"login"`
	} `json:"user,omitempty"`
}

// GetLastPRComment returns the last comment on a pull request, or nil if none.
func (c *Client) GetLastPRComment(ctx context.Context, owner, repo string, number int) (*PRComment, error) {
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/issues/%d/comments?limit=50",
		c.baseURL, owner, repo, number)

	body, err := c.doRaw(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("gitea: list PR comments: %w", err)
	}

	var comments []PRComment
	if err := json.Unmarshal(body, &comments); err != nil {
		return nil, fmt.Errorf("gitea: decode PR comments: %w", err)
	}
	if len(comments) == 0 {
		return nil, nil
	}
	return &comments[len(comments)-1], nil
}

// ListOrgRepos returns non-template source repos for an organisation.
func (c *Client) ListOrgRepos(ctx context.Context, owner string, page, limit int) ([]RepoInfo, int, error) {
	if page < 1 {
		page = 1
	}
	if limit <= 0 || limit > 50 {
		limit = 50
	}
	path := fmt.Sprintf("/api/v1/repos/search?template=false&limit=%d&page=%d&sort=updated", limit, page)
	if owner != "" {
		path += "&owner=" + url.QueryEscape(owner)
	}

	body, err := c.doRaw(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, 0, fmt.Errorf("gitea: list repos: %w", err)
	}

	var result struct {
		Data []RepoInfo `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, 0, fmt.Errorf("gitea: decode repo list: %w", err)
	}
	return result.Data, len(result.Data), nil
}

// DeleteFile removes a file from a repository on a given branch.
// It first fetches the file SHA, then sends the delete request.
func (c *Client) DeleteFile(ctx context.Context, owner, repo, filePath, commitMsg, branch string) error {
	contentsURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/contents/%s?ref=%s",
		c.baseURL, owner, repo, filePath, url.QueryEscape(branch))

	metaBody, err := c.doRaw(ctx, http.MethodGet, contentsURL, nil)
	if err != nil {
		return fmt.Errorf("gitea: get file meta %q: %w", filePath, err)
	}

	var meta struct {
		SHA string `json:"sha"`
	}
	if err := json.Unmarshal(metaBody, &meta); err != nil {
		return fmt.Errorf("gitea: decode file meta %q: %w", filePath, err)
	}

	deleteURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/contents/%s",
		c.baseURL, owner, repo, filePath)

	payload := map[string]string{
		"message": commitMsg,
		"branch":  branch,
		"sha":     meta.SHA,
	}

	_, err = c.doRaw(ctx, http.MethodDelete, deleteURL, payload)
	if err != nil {
		return fmt.Errorf("gitea: delete file %q: %w", filePath, err)
	}
	return nil
}

// ── CI/CD, Releases, Packages (read-only) ────────────────────────────────────

// WorkflowRun represents a single Gitea Actions workflow run.
type WorkflowRun struct {
	ID           int64  `json:"id"`
	DisplayTitle string `json:"display_title"`
	Status       string `json:"status"`
	Conclusion   string `json:"conclusion"`
	Event        string `json:"event"`
	HTMLURL      string `json:"html_url"`
	HeadBranch   string `json:"head_branch"`
	HeadSHA      string `json:"head_sha"`
	Path         string `json:"path"`
	RunNumber    int64  `json:"run_number"`
	StartedAt    string `json:"started_at"`
	CompletedAt  string `json:"completed_at"`
}

// Release represents a Gitea release.
type Release struct {
	ID         int64          `json:"id"`
	TagName    string         `json:"tag_name"`
	Name       string         `json:"name"`
	Body       string         `json:"body"`
	HTMLURL    string         `json:"html_url"`
	CreatedAt  string         `json:"created_at"`
	Prerelease bool           `json:"prerelease"`
	Assets     []ReleaseAsset `json:"assets"`
}

// ReleaseAsset represents a file attached to a release.
type ReleaseAsset struct {
	Name        string `json:"name"`
	Size        int64  `json:"size"`
	DownloadURL string `json:"browser_download_url"`
}

// ContainerPackage represents a container image from the Gitea Package Registry.
type ContainerPackage struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	HTMLURL string `json:"html_url"`
	Created string `json:"created_at"`
}

// ListWorkflowRuns returns recent Gitea Actions workflow runs for a repo.
func (c *Client) ListWorkflowRuns(ctx context.Context, owner, repo string, limit int) ([]WorkflowRun, error) {
	if limit <= 0 {
		limit = 5
	}
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/actions/runs?limit=%d",
		c.baseURL, owner, repo, limit)

	body, err := c.doRaw(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, nil
		}
		return nil, fmt.Errorf("gitea: list workflow runs: %w", err)
	}

	var result struct {
		WorkflowRuns []WorkflowRun `json:"workflow_runs"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("gitea: decode workflow runs: %w", err)
	}
	return result.WorkflowRuns, nil
}

// Tag represents a git tag with its creation timestamp.
type Tag struct {
	Name   string `json:"name"`
	Commit struct {
		SHA     string `json:"sha"`
		Created string `json:"created"`
	} `json:"commit"`
}

// ListRepoTags returns the most recent tags for a repo, newest first.
func (c *Client) ListRepoTags(ctx context.Context, owner, repo string, limit int) ([]Tag, error) {
	if limit <= 0 {
		limit = 50
	}
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/tags?limit=%d",
		c.baseURL, owner, repo, limit)

	body, err := c.doRaw(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, nil
		}
		return nil, fmt.Errorf("gitea: list tags: %w", err)
	}

	var tags []Tag
	if err := json.Unmarshal(body, &tags); err != nil {
		return nil, fmt.Errorf("gitea: decode tags: %w", err)
	}
	return tags, nil
}

// ListReleases returns releases for a repo.
func (c *Client) ListReleases(ctx context.Context, owner, repo string, limit int) ([]Release, error) {
	if limit <= 0 {
		limit = 10
	}
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/releases?limit=%d",
		c.baseURL, owner, repo, limit)

	body, err := c.doRaw(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("gitea: list releases: %w", err)
	}

	var releases []Release
	if err := json.Unmarshal(body, &releases); err != nil {
		return nil, fmt.Errorf("gitea: decode releases: %w", err)
	}
	return releases, nil
}

// ListContainerPackages returns container images from the Gitea Package Registry for an owner.
func (c *Client) ListContainerPackages(ctx context.Context, owner string, limit int) ([]ContainerPackage, error) {
	if limit <= 0 {
		limit = 20
	}
	apiURL := fmt.Sprintf("%s/api/v1/packages/%s?type=container&limit=%d",
		c.baseURL, url.QueryEscape(owner), limit)

	body, err := c.doRaw(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, nil
		}
		return nil, fmt.Errorf("gitea: list packages: %w", err)
	}

	var packages []ContainerPackage
	if err := json.Unmarshal(body, &packages); err != nil {
		return nil, fmt.Errorf("gitea: decode packages: %w", err)
	}
	return packages, nil
}

// ListRepoDirs returns subdirectory names under a path in any repo.
// Returns nil without error when the directory does not exist.
func (c *Client) ListRepoDirs(ctx context.Context, owner, repo, dirPath string) ([]string, error) {
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/contents/%s",
		c.baseURL, owner, repo, dirPath)

	body, err := c.doRaw(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, nil
		}
		return nil, err
	}

	var entries []struct {
		Type string `json:"type"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(body, &entries); err != nil {
		return nil, err
	}

	var dirs []string
	for _, e := range entries {
		if e.Type == "dir" {
			dirs = append(dirs, e.Name)
		}
	}
	return dirs, nil
}

// RepoEntry represents a file or directory in a Gitea repo listing.
type RepoEntry struct {
	Name string `json:"name"`
	Type string `json:"type"` // "file" or "dir"
	Path string `json:"path"`
}

// ListRepoContents returns files and directories under a path in any repo.
func (c *Client) ListRepoContents(ctx context.Context, owner, repo, dirPath string) ([]RepoEntry, error) {
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/contents/%s",
		c.baseURL, owner, repo, dirPath)

	body, err := c.doRaw(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, nil
		}
		return nil, err
	}

	var entries []RepoEntry
	if err := json.Unmarshal(body, &entries); err != nil {
		return nil, err
	}
	return entries, nil
}

// TreeFile represents a file with its path and content fetched from a repo tree.
type TreeFile struct {
	Path    string
	Content []byte
}

// FetchRepoTree recursively fetches all files under a directory in a repo.
func (c *Client) FetchRepoTree(ctx context.Context, owner, repo, basePath string) ([]TreeFile, error) {
	var files []TreeFile
	return files, c.walkTree(ctx, owner, repo, basePath, "", &files)
}

func (c *Client) walkTree(ctx context.Context, owner, repo, basePath, relPath string, files *[]TreeFile) error {
	fullPath := basePath
	if relPath != "" {
		fullPath = basePath + "/" + relPath
	}

	entries, err := c.ListRepoContents(ctx, owner, repo, fullPath)
	if err != nil {
		return err
	}

	for _, e := range entries {
		entryRel := e.Name
		if relPath != "" {
			entryRel = relPath + "/" + e.Name
		}

		if e.Type == "dir" {
			if err := c.walkTree(ctx, owner, repo, basePath, entryRel, files); err != nil {
				return err
			}
		} else {
			content, err := c.GetRepoFile(ctx, owner, repo, fullPath+"/"+e.Name)
			if err != nil {
				continue
			}
			*files = append(*files, TreeFile{Path: entryRel, Content: content})
		}
	}
	return nil
}

// CreateEmptyRepo creates a new empty private repository under the given owner.
func (c *Client) CreateEmptyRepo(ctx context.Context, owner, name, description string) (*RepoInfo, error) {
	apiURL := fmt.Sprintf("%s/api/v1/orgs/%s/repos", c.baseURL, owner)

	payload := map[string]any{
		"name":            name,
		"description":     description,
		"private":         true,
		"auto_init":       true,
		"default_branch":  "develop",
	}

	body, err := c.doRaw(ctx, http.MethodPost, apiURL, payload)
	if err != nil {
		return nil, fmt.Errorf("gitea: create repo: %w", err)
	}

	var info RepoInfo
	if err := json.Unmarshal(body, &info); err != nil {
		return nil, fmt.Errorf("gitea: decode repo info: %w", err)
	}
	return &info, nil
}

// GetRepoFile fetches a file from any repo (not just the client's default repo).
func (c *Client) GetRepoFile(ctx context.Context, owner, repo, path string) ([]byte, error) {
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/contents/%s",
		c.baseURL, owner, repo, path)

	body, err := c.doRaw(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, err
	}

	var entry struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal(body, &entry); err != nil {
		return nil, fmt.Errorf("gitea: decode file %s/%s/%s: %w", owner, repo, path, err)
	}

	decoded, err := base64.StdEncoding.DecodeString(
		strings.ReplaceAll(entry.Content, "\n", ""),
	)
	if err != nil {
		return nil, fmt.Errorf("gitea: base64 decode: %w", err)
	}
	return decoded, nil
}

// doRawWithHeaders is like doRaw but also returns the response headers.
func (c *Client) doRawWithHeaders(ctx context.Context, method, apiURL string, payload any) ([]byte, http.Header, error) {
	var bodyReader io.Reader
	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			return nil, nil, fmt.Errorf("gitea: marshal payload: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(ctx, method, apiURL, bodyReader)
	if err != nil {
		return nil, nil, fmt.Errorf("gitea: build request: %w", err)
	}
	if c.token != "" {
		req.Header.Set("Authorization", "token "+c.token)
	}
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("gitea: %s %s: %w", method, apiURL, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("gitea: read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, nil, fmt.Errorf("gitea: %s %s returned %d: %s", method, apiURL, resp.StatusCode, body)
	}
	return body, resp.Header, nil
}

// doRaw executes an HTTP request against the Gitea API with an optional JSON body.
func (c *Client) doRaw(ctx context.Context, method, apiURL string, payload any) ([]byte, error) {
	var bodyReader io.Reader
	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("gitea: marshal payload: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(ctx, method, apiURL, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("gitea: build request: %w", err)
	}
	if c.token != "" {
		req.Header.Set("Authorization", "token "+c.token)
	}
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gitea: %s %s: %w", method, apiURL, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("gitea: read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("gitea: %s %s returned %d: %s", method, apiURL, resp.StatusCode, body)
	}
	return body, nil
}
