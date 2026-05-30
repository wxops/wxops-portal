# Release Workflow

This document explains the full lifecycle from a feature branch to a published
release: conventional commits, automatic version bumping with git-cliff,
CHANGELOG.md management, CI variable classification, and the release notes
system. It is written to be portable — apply the same pattern to any project
that uses this scaffolding template.

**Table of Contents**

- [Release Workflow](#release-workflow)
  - [Mental model](#mental-model)
  - [1. Prerequisites](#1-prerequisites)
  - [2. Conventional commits](#2-conventional-commits)
    - [Format](#format)
    - [Allowed types](#allowed-types)
  - [3. Semver bump rules](#3-semver-bump-rules)
    - [Patch examples (`fix`, `perf`)](#patch-examples-fix-perf)
    - [Minor examples (`feat`)](#minor-examples-feat)
    - [Major examples (breaking change)](#major-examples-breaking-change)
  - [4. Development workflow](#4-development-workflow)
  - [5. Release workflow](#5-release-workflow)
    - [Standard path — `make release`](#standard-path--make-release)
    - [Alternative path — direct tag push](#alternative-path--direct-tag-push)
    - [Checking what the next version will be before committing](#checking-what-the-next-version-will-be-before-committing)
  - [6. CHANGELOG.md update paths](#6-changelogmd-update-paths)
  - [7. Release notes system](#7-release-notes-system)
    - [Writing version-specific notes](#writing-version-specific-notes)
  - [8. CI pipeline variable classification](#8-ci-pipeline-variable-classification)
    - [Org-level variables](#org-level-variables)
    - [Repo-level variables](#repo-level-variables)
    - [Auto-injected — no setup required](#auto-injected--no-setup-required)
    - [Not in CI — runtime app config](#not-in-ci--runtime-app-config)
  - [9. Applying to a new project (checklist)](#9-applying-to-a-new-project-checklist)
    - [Files to copy](#files-to-copy)
    - [Adjust cliff.toml](#adjust-clifftoml)
    - [Adjust `.pre-commit-config.yaml`](#adjust-pre-commit-configyaml)
    - [Configure Gitea variables](#configure-gitea-variables)
    - [First release](#first-release)
  - [Quick reference](#quick-reference)

---

## Mental model

```
feature branch
  └─ commits (conventional format, validated by pre-commit)
       └─ PR → merge to main
                └─ CI: quality gate only (no image build)
                     └─ (repeat — accumulate commits)
                          └─ make release
                               └─ git push --tags
                                    └─ CI: Docker build + push + Gitea release
```

There is no automatic tag on merge. The version bump happens when **you decide
a release is ready**. git-cliff reads commits since the last tag and calculates
the correct version from them — you never type a version number by hand.

---

## 1. Prerequisites

| Tool | Install | Purpose |
|---|---|---|
| `git-cliff` | `cargo install git-cliff` or [binary release](https://github.com/orhun/git-cliff/releases) | Changelog generation + version bumping |
| `pre-commit` | `pip install pre-commit` | Local commit-msg + code quality hooks |

After cloning:

```bash
make hooks   # installs commit-msg and pre-commit hook types
```

Run once. Every subsequent `git commit` is validated automatically.

---

## 2. Conventional commits

### Format

```
<type>(<scope>): <short description>

[optional body]

[optional footer — BREAKING CHANGE: … or Refs: #123]
```

- **type** — required, must be one of the allowed types below
- **scope** — optional but recommended; appears as **bold** in the changelog
- **short description** — imperative mood, lowercase, no period
- **body** — free text, separated from subject by a blank line
- **footer** — `BREAKING CHANGE:` here triggers a major bump (see §3)

### Allowed types

| Type | Changelog section | Triggers version bump |
|---|---|---|
| `feat` | Features | **minor** |
| `fix` | Bug Fixes | patch |
| `perf` | Performance | patch |
| `refactor` | Refactoring | — |
| `docs` | Documentation | — |
| `test` | Testing | — |
| `chore` | Chores | — |
| `revert` | Reverts | — |

`refactor`, `docs`, `test`, `chore` appear in the changelog but do not drive a
semver bump on their own. If the same release also has a `feat`, the minor bump
wins.

> `chore(release): prepare for vX.Y.Z` is the only commit type that is
> **skipped entirely** from the changelog — it is the commit that `make release`
> creates and would otherwise pollute the history.

---

## 3. Semver bump rules

git-cliff reads your `cliff.toml` to decide the bump:

```
BREAKING CHANGE footer  or  ! after type   →  major  (x.0.0)
feat                                        →  minor  (0.x.0)
fix, perf                                   →  patch  (0.0.x)
```

The **highest** rule wins across all commits since the last tag. One `feat` in a
batch of ten `fix` commits → minor bump, not ten patch bumps.

### Patch examples (`fix`, `perf`)

`v0.2.0 → v0.2.1`

```bash
git commit -m "fix(auth): handle expired tokens before redirect"
git commit -m "fix(catalog): correct Mermaid edge direction for dependencies"
git commit -m "perf(catalog): reduce entity cache refresh with singleflight"
git commit -m "fix: correct typo in cluster error response"
```

Changelog output:

```markdown
## [0.2.1] - 2026-05-30

### Bug Fixes
- **auth**: Handle expired tokens before redirect
- **catalog**: Correct Mermaid edge direction for dependencies

### Performance
- **catalog**: Reduce entity cache refresh with singleflight
```

### Minor examples (`feat`)

`v0.2.0 → v0.3.0`

```bash
git commit -m "feat(catalog): add Resource kind to entity parser"
git commit -m "feat(cluster): add health-status field to cluster list response"
git commit -m "feat(ui): add Mermaid relationship graph to system detail page"
```

Changelog output:

```markdown
## [0.3.0] - 2026-05-30

### Features
- **catalog**: Add Resource kind to entity parser
- **cluster**: Add health-status field to cluster list response
- **ui**: Add Mermaid relationship graph to system detail page
```

### Major examples (breaking change)

`v0.3.0 → v1.0.0`

Two syntaxes — both produce a major bump:

```bash
# Syntax A: ! after type (or after scope) — short and clear
git commit -m "feat(api)!: restructure cluster response — items array replaces flat list"

# Syntax B: BREAKING CHANGE footer — use when you need to explain the migration
git commit -m "feat(auth): replace cookie session with signed JWT

Switches session storage from AES-GCM cookie to RS256 JWT.
All existing sessions are invalidated on upgrade.

BREAKING CHANGE: clients must re-authenticate after upgrading;
the wxops_session cookie format is no longer compatible."
```

Changelog output:

```markdown
## [1.0.0] - 2026-05-30

### Features
- **api**: Restructure cluster response — items array replaces flat list (**BREAKING**)
- **auth**: Replace cookie session with signed JWT (**BREAKING**)
```

---

## 4. Development workflow

```bash
# 1. Create a branch from main
git checkout -b feat/catalog-resource-kind

# 2. Write code, then commit — pre-commit validates message + code quality
git add backend/internal/catalog/entity.go
git commit -m "feat(catalog): add Resource kind to entity parser"
# → commit-msg hook checks the format
# → backend-vet + backend-build run on changed .go files

# 3. Open PR → CI runs backend + frontend quality checks
# 4. Merge to main → CI runs again, no Docker build
# 5. Repeat steps 1–4 for more features
```

At this point, `main` has accumulated commits but no new tag. The image in the
registry is still the previous release. That is correct — merging to main does
not release.

---

## 5. Release workflow

### Standard path — `make release`

```bash
# On main, after merging all features for this release
make release

#   Current : v0.2.0
#   Next    : v0.3.0    ← git-cliff calculated this from commits since v0.2.0
#
#   Tag as v0.3.0 and push? [y/N] y

# make release does:
#   git cliff -o CHANGELOG.md        → updates CHANGELOG.md
#   git add CHANGELOG.md
#   git commit -m "chore(release): prepare for v0.3.0"
#   git tag -a v0.3.0 -m "Release v0.3.0"

git push && git push --tags
# → CI picks up the tag → Docker build + push → Gitea release published
```

### Alternative path — direct tag push

```bash
git tag -a v0.3.0 -m "Release v0.3.0"
git push --tags
# → CI generates cliff notes → fills release template
# → commits updated CHANGELOG.md to main automatically
# → Docker build + push → Gitea release published
```

Use the direct path when you want CI to be the sole author of CHANGELOG.md (for
example, in a fully automated GitOps pipeline).

### Checking what the next version will be before committing

```bash
make version          # current:  v0.2.0
git cliff --bumped-version   # next:     v0.3.0
```

---

## 6. CHANGELOG.md update paths

Two sources of truth, same content, different timing:

| Path | When CHANGELOG.md is updated | Who updates it |
|---|---|---|
| `make release` | Before the tag is pushed | You, locally |
| Direct tag push | After CI runs on the tag | CI bot, commit to main |

When `make release` is used, the CI CHANGELOG sync step still runs but produces
no diff — `git diff --staged --quiet` detects nothing changed and skips the
commit.

---

## 7. Release notes system

Release body is resolved in this priority order:

```
release-notes/<tag>.md        →  hand-written, used as-is, CHANGELOG not synced
release-notes/template.md     →  auto-filled with {{CLIFF_NOTES}}, {{VERSION}}, {{IMAGE}}
(neither exists)              →  raw git-cliff output
```

### Writing version-specific notes

Create the file **before** pushing the tag:

```bash
cat > release-notes/v1.0.0.md << 'EOF'
## v1.0.0 — First stable release

This release stabilises the authentication layer and service catalog.
All APIs are considered stable from this point.

## Migration from v0.x

- Re-authenticate after upgrade (sessions are not forward-compatible)
- Update kubeconfig: run `wxops kubeconfig download` to get the new format

## What's Changed

- **auth**: Replaced cookie session with signed JWT
- **catalog**: Resource kind now fully supported
- **cluster**: Health-status field added to list response
EOF

git add release-notes/v1.0.0.md
git commit -m "chore: add release notes for v1.0.0"
git tag -a v1.0.0 -m "Release v1.0.0"
git push && git push --tags
```

When a hand-written file exists, CHANGELOG.md is **not** auto-synced by CI —
you manage it with `make changelog` or `make release`.

---

## 8. CI pipeline variable classification

Variables are split by scope so a single change propagates to all repos that
inherit from the org.

### Org-level variables
**Gitea:** Organization → Settings → Actions → Variables

Set once. Every repo in the org inherits them.

| Variable | Default | Change when |
|---|---|---|
| `GO_VERSION` | `1.23` | Org standardises on a new Go release |
| `NODE_VERSION` | `20` | Moving to a new Node LTS |
| `REGISTRY` | `ghcr.io` | Switching to a different OCI registry |
| `RUNNER_LABEL` | `ubuntu-latest` | Using self-hosted Act runners |

### Repo-level variables
**Gitea:** Repository → Settings → Actions → Variables

Override per repo. Required here because this is a monorepo with subfolders.

| Variable | Value | Why repo-level |
|---|---|---|
| `GO_CACHE_PATH` | `backend/go.sum` | Go module is in `backend/`, not repo root |
| `NPM_CACHE_PATH` | `frontend/package-lock.json` | Frontend is in `frontend/`, not repo root |

### Auto-injected — no setup required

| Reference | Value |
|---|---|
| `secrets.GITHUB_TOKEN` | Injected per run by Gitea |
| `github.repository` | `org/repo-name` |
| `github.ref_name` | Tag or branch name |
| `github.actor` | User who triggered the run |

### Not in CI — runtime app config

These belong in **Kubernetes Secrets** mounted into the running pod, not in the
CI pipeline. Putting them in CI would be both unnecessary and a security risk.

```
OIDC_CLIENT_SECRET   SESSION_SECRET   GITEA_TOKEN
OIDC_ISSUER_URL      OIDC_CLIENT_ID   OIDC_REDIRECT_URI
```

---

## 9. Applying to a new project (checklist)

Copy the scaffolding files and work through this list top to bottom.

### Files to copy

```
.gitea/
  workflows/
    ci.yml                    # combined CI + Release pipeline
  scripts/
    check-go-mod-tidy.sh      # adjust or remove if not a Go project
.pre-commit-config.yaml       # adjust allowed types to match your cliff.toml
cliff.toml                    # adjust commit_parsers if needed
release-notes/
  template.md                 # edit the Docker image line and links
Makefile                      # changelog / release / version targets
```

### Adjust cliff.toml

If you add or rename commit types in `.pre-commit-config.yaml`, add matching
parsers to `cliff.toml`:

```toml
commit_parsers = [
  { message = "^feat",     group = "Features" },
  { message = "^fix",      group = "Bug Fixes" },
  # add your type here:
  { message = "^infra",    group = "Infrastructure" },
]
```

### Adjust `.pre-commit-config.yaml`

Keep the allowed `args` list in sync with `cliff.toml` commit_parsers. Any type
not listed here will be rejected at commit time.

### Configure Gitea variables

1. Org-level: `GO_VERSION`, `NODE_VERSION`, `REGISTRY`, `RUNNER_LABEL`
2. Repo-level: `GO_CACHE_PATH`, `NPM_CACHE_PATH` (only needed for monorepos)

### First release

```bash
# Verify no tags exist yet
make version        # → v0.0.0 (no tags yet)

# Check what version cliff would calculate
git cliff --bumped-version   # → v0.1.0 (if you have feat commits)

# Release
make release
git push && git push --tags
```

---

## Quick reference

```bash
make version                 # current version from last tag
git cliff --bumped-version   # next version from commits since last tag
make changelog               # regenerate CHANGELOG.md locally (no tag, no release)
make release                 # bump, update CHANGELOG, commit, tag — then push manually
make hooks                   # install pre-commit hooks (run once after clone)
pre-commit run --all-files   # run all hooks against every file right now
```

| Scenario | Command |
|---|---|
| I want to see what changed since the last release | `git cliff --current` |
| I want to preview the next CHANGELOG without committing | `git cliff` (stdout only) |
| I made a breaking change and want to verify the bump | `git cliff --bumped-version` |
| I want to write custom notes for the next release | Create `release-notes/vX.Y.Z.md` before tagging |
| I want CI to handle everything automatically | Push the tag directly without `make release` |
