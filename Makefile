.PHONY: dev dev-frontend dev-backend up down build lint

# ── Local dev (no docker) ──────────────────────────────────────────────────────
dev-frontend:
	cd frontend && npm run dev

dev-backend:
	cd backend && go run ./cmd/main.go

# Run both in parallel (requires two terminals; use 'make dev' as shorthand)
dev:
	@echo "Start frontend: make dev-frontend"
	@echo "Start backend:  make dev-backend"
	@echo "Start dex:      docker run -p 5556:5556 -v \$$PWD/dex-config.yaml:/etc/dex/config.yaml ghcr.io/dexidp/dex:v2.44.0 dex serve /etc/dex/config.yaml"

# ── Docker Compose ─────────────────────────────────────────────────────────────
up:
	docker compose up --build

down:
	docker compose down

build:
	docker compose build

# ── Backend ────────────────────────────────────────────────────────────────────
backend-build:
	cd backend && go build -o bin/server ./cmd/main.go

backend-lint:
	cd backend && go vet ./...

backend-tidy:
	cd backend && go mod tidy

# ── Frontend ───────────────────────────────────────────────────────────────────
frontend-install:
	cd frontend && npm install

frontend-build:
	cd frontend && npm run build

frontend-lint:
	cd frontend && npm run lint
