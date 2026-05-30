# release-notes

Release body for Gitea/GitHub releases is resolved in this priority order:

1. **`release-notes/<tag>.md`** — hand-written notes for a specific version (e.g. `v1.2.0.md`).
   Create this file before pushing the tag to override the template entirely.

2. **`release-notes/template.md`** — default template.
   The CI pipeline fills in three placeholders at release time:
   - `{{CLIFF_NOTES}}` — git-cliff changelog for this tag's commits
   - `{{VERSION}}` — the tag name (e.g. `v1.2.0`)
   - `{{IMAGE}}` — full GHCR image path (e.g. `ghcr.io/org/wxops-portal`)
   When the template path is used, `CHANGELOG.md` is also regenerated and committed automatically.

3. **Raw git-cliff output** — fallback if neither file exists.

## Writing version-specific notes

```
release-notes/
  v1.2.0.md   ← create this before tagging
  template.md ← default for all other releases
```

The `v1.2.0.md` file is free-form Markdown — no placeholders are required.
It will be used exactly as written.
