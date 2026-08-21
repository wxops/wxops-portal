.PHONY: help dev dev-frontend dev-backend up down build \
        backend-build backend-lint backend-tidy \
        frontend-install frontend-build frontend-lint \
        cli-build cli-install cli-run cli-lint cli-tidy cli-build-all cli-clean \
        hooks \
        openapi-sync \
        changelog changelog-preview release version

# ── Help ───────────────────────────────────────────────────────────────────────
help: ## Show available commands
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} \
	     /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 } \
	     /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)

##@ Local Development

dev-backend: ## Run Go backend with hot config reload (reads backend/.env)
	cd backend && go run ./cmd/main.go

dev-frontend: ## Run Next.js dev server with hot reload
	cd frontend && npm run dev

dev: ## Print commands to start all three services in separate terminals
	@echo ""
	@echo "  Terminal 1 — Dex (upstream IDP):"
	@echo "    docker run -p 5556:5556 -v \$$PWD/dex-config.yaml:/etc/dex/config.yaml ghcr.io/dexidp/dex:v2.44.0 dex serve /etc/dex/config.yaml"
	@echo ""
	@echo "  Terminal 2 — Go backend:"
	@echo "    make dev-backend"
	@echo ""
	@echo "  Terminal 3 — Next.js:"
	@echo "    make dev-frontend"
	@echo ""

##@ Docker

up: ## Build and start all services with Docker Compose
	docker compose up --build

down: ## Stop Docker Compose services
	docker compose down

build: ## Build the combined Docker image
	docker compose build

##@ Backend

backend-build: ## Compile Go backend binary to backend/bin/server
	cd backend && go build -o bin/server ./cmd/main.go

backend-lint: ## Run go vet on the backend
	cd backend && go vet ./...

backend-tidy: ## Tidy Go module dependencies
	cd backend && go mod tidy

##@ Frontend

frontend-install: ## Install frontend npm dependencies
	cd frontend && npm install

frontend-build: ## Build Next.js for production (standalone output)
	cd frontend && npm run build

frontend-lint: ## Run ESLint on the frontend
	cd frontend && npm run lint

##@ CLI

cli-build: ## Build wxops CLI for the current platform → cli/bin/wxops
	$(MAKE) -C cli build

cli-install: ## Build and install wxops CLI to GOPATH/bin
	$(MAKE) -C cli install

cli-run: ## Run wxops CLI without installing  (usage: make cli-run ARGS="catalog list")
	$(MAKE) -C cli run ARGS="$(ARGS)"

cli-lint: ## go vet the CLI
	$(MAKE) -C cli lint

cli-tidy: ## Tidy CLI Go module dependencies
	$(MAKE) -C cli tidy

cli-build-all: ## Cross-compile wxops for all platforms → cli/dist/
	$(MAKE) -C cli build-all

cli-clean: ## Remove CLI build artefacts (cli/bin/ and cli/dist/)
	$(MAKE) -C cli clean

##@ Git Hooks

hooks: ## Install pre-commit hooks (requires: pip install pre-commit)
	pre-commit install --hook-type pre-commit --hook-type commit-msg
	@echo "pre-commit hooks installed."

##@ OpenAPI

openapi-sync: ## Regenerate backend/docs/ from current handler annotations (run after editing handlers without committing)
	@.gitea/scripts/swag-sync.sh

##@ Release

version: ## Show current version from latest git tag
	@git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0 (no tags yet)"

changelog: ## Generate CHANGELOG.md from conventional commits using git-cliff
	@which git-cliff > /dev/null || (echo "git-cliff not installed — see https://git-cliff.org/docs/installation" && exit 1)
	git cliff -o CHANGELOG.md
	@echo "CHANGELOG.md updated."

changelog-preview: ## Preview unreleased changelog without writing
	@which git-cliff > /dev/null || (echo "git-cliff not installed — see https://git-cliff.org/docs/installation" && exit 1)
	git-cliff --unreleased --strip all

release: ## Bump version, update changelog + release notes, commit and tag  [VERSION=vX.Y.Z overrides auto-bump]
	@which git-cliff > /dev/null || (echo "git-cliff not installed — see https://git-cliff.org/docs/installation" && exit 1)
	$(eval NEXT := $(if $(VERSION),$(VERSION),$(shell git cliff --bumped-version 2>/dev/null)))
	@if [ -z "$(NEXT)" ]; then \
	    echo "  ERROR: could not determine next version — run 'git cliff --bumped-version' to debug."; \
	    exit 1; \
	fi
	@if ! echo "$(NEXT)" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+'; then \
	    echo "  ERROR: '$(NEXT)' must match vX.Y.Z (e.g. VERSION=v1.2.0)"; \
	    exit 1; \
	fi
	@if [ ! -f "release-notes/$(NEXT).md" ]; then \
	    echo ""; \
	    echo "  ERROR: release-notes/$(NEXT).md doesn't exist yet."; \
	    echo "  CHANGELOG.md is the commit list — this is the human narrative of"; \
	    echo "  what $(NEXT) is and why it matters. Write it first, then re-run:"; \
	    echo "    cp release-notes/template.md release-notes/$(NEXT).md"; \
	    echo ""; \
	    exit 1; \
	fi
	@echo ""
	@echo "  Current : $(shell git describe --tags --abbrev=0 2>/dev/null || echo v0.0.0)"
	@echo "  Next    : $(NEXT)$(if $(VERSION), [manual override],)"
	@echo ""
	@echo "  Before confirming, go update whatever's drifted — these all get"
	@echo "  staged and committed together with CHANGELOG.md below, so this is"
	@echo "  the one pass that catches it instead of piecemeal mid-development:"
	@echo "    - ROADMAP.md      (flip landed features from Planned → Landed)"
	@echo "    - README.md       (feature list, version references)"
	@echo "    - docs/           (anything the release note points readers to)"
	@echo ""
	@read -p "  Tag as $(NEXT) and push? [y/N] " c && [ "$$c" = "y" ]
	git cliff --tag $(NEXT) -o CHANGELOG.md
	git add CHANGELOG.md release-notes/$(NEXT).md ROADMAP.md README.md docs/
	@if git diff --cached --quiet; then \
	    echo "→ Nothing to commit for $(NEXT) — CHANGELOG.md, release notes, and docs already up to date"; \
	else \
	    echo "→ Staged for $(NEXT):"; \
	    git diff --cached --name-only | sed 's/^/    /'; \
	    SKIP=no-commit-to-branch git commit -m "chore(release): prepare for $(NEXT)"; \
	fi
	git tag -a $(NEXT) -m "Release $(NEXT)"
	@echo ""
	@echo "  Created tag $(NEXT). Push with:"
	@echo "    git push && git push --tags"
	@echo ""
