#!/usr/bin/env bash
# Regenerates backend/docs/ when handler annotations or main.go change.
# Called automatically by the pre-commit hook — no manual invocation needed.
# Auto-stages backend/docs/ so the spec is always committed alongside the code.

set -euo pipefail

SWAG=$(command -v swag 2>/dev/null || echo "$(go env GOPATH)/bin/swag")

if [ ! -x "$SWAG" ]; then
    cat >&2 <<'EOF'

  ERROR: swag not found.
  Install with:
    go install github.com/swaggo/swag/cmd/swag@v1.16.4

  This hook runs automatically when handler files change to keep
  backend/docs/ in sync with the code.

EOF
    exit 1
fi

(cd backend && "$SWAG" init -g cmd/main.go -o docs/ -q)

echo "  OpenAPI spec regenerated."
