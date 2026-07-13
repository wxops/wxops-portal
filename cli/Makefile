.PHONY: help build install run lint tidy build-all clean

# Derive version from the nearest git tag (falls back to "dev" when no tag exists).
VERSION := $(shell git -C .. describe --tags --abbrev=0 2>/dev/null || echo dev)
LDFLAGS := -ldflags="-X main.version=$(VERSION)"
BIN     := bin/wxops

# ── Help ───────────────────────────────────────────────────────────────────────
help: ## Show available targets
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n\n"} \
	     /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 }' \
	     $(MAKEFILE_LIST)
	@echo ""

# ── Build ──────────────────────────────────────────────────────────────────────
build: ## Build for the current platform → ./bin/wxops
	@mkdir -p bin
	go build $(LDFLAGS) -o $(BIN) ./cmd/wxops
	@echo "  built: $(BIN)  (version $(VERSION))"

install: build ## Install to GOPATH/bin (adds wxops to your PATH if GOPATH/bin is in PATH)
	cp $(BIN) $(shell go env GOPATH)/bin/wxops
	@echo "  installed: $(shell go env GOPATH)/bin/wxops"

run: ## Run without installing  (usage: make run ARGS="catalog list")
	go run $(LDFLAGS) ./cmd/wxops $(ARGS)

# ── Quality ────────────────────────────────────────────────────────────────────
lint: ## Run go vet
	go vet ./...

tidy: ## Tidy module dependencies
	go mod tidy

# ── Cross-compile ─────────────────────────────────────────────────────────────
build-all: ## Cross-compile all platforms → ./dist/
	@mkdir -p dist
	@for GOOS in linux darwin; do \
	    for GOARCH in amd64 arm64; do \
	        out="dist/wxops-$$GOOS-$$GOARCH"; \
	        printf "  %-36s" "$$GOOS/$$GOARCH → $$out"; \
	        GOOS=$$GOOS GOARCH=$$GOARCH go build \
	            $(LDFLAGS) \
	            -o "$$out" \
	            ./cmd/wxops && echo "ok" || echo "FAILED"; \
	    done; \
	done
	@echo ""
	@ls -lh dist/

# ── Housekeeping ───────────────────────────────────────────────────────────────
clean: ## Remove build artefacts (bin/ and dist/)
	rm -rf bin/ dist/
