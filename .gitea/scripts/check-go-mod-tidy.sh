#!/usr/bin/env bash
# Fails if 'go mod tidy' would modify go.mod or go.sum.
# Restores the originals regardless of outcome so the working tree is clean.

set -euo pipefail

cd backend

cp go.mod go.mod.bak
cp go.sum go.sum.bak

cleanup() {
  mv go.mod.bak go.mod
  mv go.sum.bak go.sum
}
trap cleanup EXIT

go mod tidy

DIRTY=0
diff -q go.mod go.mod.bak > /dev/null 2>&1 || DIRTY=1
diff -q go.sum go.sum.bak > /dev/null 2>&1 || DIRTY=1

if [ "$DIRTY" -eq 1 ]; then
  cat >&2 <<EOF

  ERROR: go.mod or go.sum would change after 'go mod tidy'.
  Run: cd backend && go mod tidy

EOF
  exit 1
fi
