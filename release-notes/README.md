# release-notes

Release body for Gitea/GitHub releases is resolved in this priority order:

1. **`release-notes/<tag>.md`** — hand-written notes for a specific version (e.g. `v1.2.0.md`).
   Create this file before pushing the tag to take priority over the template.

2. **`release-notes/template.md`** — default template used when no version-specific file exists.

3. **Raw git-cliff output** — fallback if neither file exists.

## Placeholder substitution

Both version-specific files **and** `template.md` support the same placeholders.
The CI pipeline fills them in at release time:

| Placeholder | Replaced with |
|---|---|
| `{{CLIFF_NOTES}}` | Auto-generated commit list for this tag (from git-cliff). It opens with its own `## [x.y.z](release link) — date` heading followed by `###` groups, so don't put a heading above it |
| `{{VERSION}}` | Tag name, e.g. `v1.2.0` |
| `{{IMAGE}}` | Full registry image path, e.g. `ghcr.io/org/wxops-portal-v2` |

Including `{{CLIFF_NOTES}}` in a version-specific file **merges** your hand-written
notes with the auto-generated commit list. Omit it to keep the file purely hand-written.

## Writing version-specific notes

```
release-notes/
  v1.2.0.md   ← create this before tagging
  template.md ← default for all other releases
```

### Example: hand-written notes only

```markdown
## v1.2.0 — My release

Custom narrative here — no commit list injected.
```

### Example: hand-written notes + auto commit list

```markdown
## v1.2.0 — My release

Custom narrative here.

{{CLIFF_NOTES}}

## Container image

```sh
docker pull {{IMAGE}}:{{VERSION}}
```
```

## Link format

**Always use absolute URLs** in release note files — relative paths like `../docs/foo.md`
do not resolve on a Gitea/GitHub release page. Use the `{{VERSION}}` placeholder to keep
links pinned to the correct tag:

```markdown
[Architecture](https://github.com/wxops/wxops-portal/blob/{{VERSION}}/docs/concepts/architecture.md)
```
