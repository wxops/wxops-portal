# Release Workflow

Conventional commits → git-cliff calculates the version → tag triggers CI →
Docker image published. No manual version numbers, no manual changelog edits.

**Table of Contents**
- [Mental model](#mental-model)
- [1. Setup](#1-setup)
- [2. Commit format](#2-commit-format)
- [3. Semver bump rules](#3-semver-bump-rules)
- [4. Releasing](#4-releasing)
- [5. Release notes](#5-release-notes)
- [6. CI variables](#6-ci-variables)
- [7. New project checklist](#7-new-project-checklist)
- [Quick reference](#quick-reference)

---

## Mental model

```
branch → commits → PR → merge to main → (repeat)
                                              ↓
                                        make release
                                              ↓
                                        git push --tags
                                              ↓
                                  CI: quality gate → Docker build → Gitea release
```

Merging to `main` never triggers a release. The image only builds when a `v*`
tag is pushed.

---

## 1. Setup

| Tool | Install |
|---|---|
| `git-cliff` | `cargo install git-cliff` or [binary](https://github.com/orhun/git-cliff/releases) |
| `pre-commit` | `pip install pre-commit` |

```bash
make hooks   # run once after clone
```

---

## 2. Commit format

```
<type>(<scope>): <short description>

[body]

[BREAKING CHANGE: explanation]
```

| Type | Changelog section | Bumps version |
|---|---|---|
| `feat` | Features | **minor** |
| `fix` | Bug Fixes | patch |
| `perf` | Performance | patch |
| `refactor` | Refactoring | — |
| `docs` | Documentation | — |
| `test` | Testing | — |
| `chore` | Chores | — |
| `revert` | Reverts | — |

`scope` is optional but recommended — it renders as **bold** in the changelog.
`chore(release): prepare for vX.Y.Z` is skipped from the changelog entirely.

---

## 3. Semver bump rules

```
BREAKING CHANGE footer  or  ! after type  →  major
feat                                       →  minor
fix, perf                                  →  patch
```

Highest rule wins across all commits since the last tag.

**Patch** `v0.2.0 → v0.2.1`
```bash
git commit -m "fix(auth): handle expired tokens before redirect"
git commit -m "perf(catalog): reduce entity cache refresh with singleflight"
```

**Minor** `v0.2.0 → v0.3.0`
```bash
git commit -m "feat(catalog): add Resource kind to entity parser"
git commit -m "feat(cluster): add health-status field to list response"
```

**Major** `v0.3.0 → v1.0.0` — two equivalent syntaxes:
```bash
# Short form
git commit -m "feat(api)!: restructure cluster response — items array replaces flat list"

# Long form — use when migration steps need explanation
git commit -m "feat(auth): replace cookie session with signed JWT

BREAKING CHANGE: clients must re-authenticate after upgrading;
the wxops_session cookie format is no longer compatible."
```

---

## 4. Releasing

**Standard — `make release`** (updates CHANGELOG.md locally, then you push)

```bash
make release
# Current: v0.2.0   Next: v0.3.0   Tag as v0.3.0? [y/N] y
git push && git push --tags
```

**Direct tag push** (CI writes CHANGELOG.md back to main)

```bash
git tag -a v0.3.0 -m "Release v0.3.0"
git push --tags
```

Both paths produce the same result. Use `make release` when working locally;
use direct push in automated pipelines.

CHANGELOG.md update timing:

| Path | Updated by | When |
|---|---|---|
| `make release` | You, locally | Before the tag |
| Direct tag push | CI bot | After the tag (commit to main) |

---

## 5. Release notes

CI resolves the release body in this order:

```
release-notes/<tag>.md   →  hand-written, used as-is
release-notes/template.md →  auto-filled: {{CLIFF_NOTES}}, {{VERSION}}, {{IMAGE}}
(neither)                 →  raw git-cliff output
```

The **template is the quality floor** — it produces structured, consistent
release notes automatically. Hand-written notes are opt-in for releases that
need migration steps or extra context.

To write custom notes for a specific release, create the file before tagging:

```bash
# e.g. release-notes/v1.0.0.md
git add release-notes/v1.0.0.md
git commit -m "chore: add release notes for v1.0.0"
git tag -a v1.0.0 && git push --tags
```

When a hand-written file is used, CHANGELOG.md is not auto-synced — run
`make changelog` manually if needed.

---

## 6. CI variables

**Org-level** — Gitea: Organization → Settings → Actions → Variables

| Variable | Default | Change when |
|---|---|---|
| `GO_VERSION` | `1.23` | Bumping Go org-wide |
| `NODE_VERSION` | `20` | Moving to a new Node LTS |
| `REGISTRY` | `ghcr.io` | Switching OCI registry |
| `RUNNER_LABEL` | `ubuntu-latest` | Using self-hosted runners |

**Repo-level** — Gitea: Repository → Settings → Actions → Variables

| Variable | Default | Why repo-level |
|---|---|---|
| `GO_CACHE_PATH` | `backend/go.sum` | Monorepo: Go module in subdirectory |
| `NPM_CACHE_PATH` | `frontend/package-lock.json` | Monorepo: frontend in subdirectory |

**Auto-injected** — no setup needed: `secrets.GITHUB_TOKEN`, `github.repository`,
`github.ref_name`, `github.actor`.

**Not in CI** — injected via K8s Secrets at deploy time:
`OIDC_CLIENT_SECRET`, `SESSION_SECRET`, `GITEA_TOKEN`, `OIDC_ISSUER_URL`.

---

## 7. New project checklist

**Files to copy from this repo:**
```
.gitea/workflows/ci.yml
.gitea/scripts/check-go-mod-tidy.sh   # remove if not Go
.pre-commit-config.yaml
cliff.toml
release-notes/template.md
Makefile                               # changelog / release / version targets
```

**Sync types between the two files** — anything in `.pre-commit-config.yaml`
args must have a matching parser in `cliff.toml`, and vice versa.

**Configure Gitea variables:**
1. Org: `GO_VERSION`, `NODE_VERSION`, `REGISTRY`, `RUNNER_LABEL`
2. Repo: `GO_CACHE_PATH`, `NPM_CACHE_PATH` (monorepos only)

**First release:**
```bash
make version               # → v0.0.0 (no tags yet)
git cliff --bumped-version # → v0.1.0 (based on commits)
make release
git push && git push --tags
```

---

## Quick reference

```bash
make version                  # current version
git cliff --bumped-version    # next version (dry run)
make changelog                # regenerate CHANGELOG.md without releasing
make release                  # bump + changelog + commit + tag
make hooks                    # install pre-commit (run once)
pre-commit run --all-files    # run all hooks now
git cliff --current           # what changed since the last tag
```
