# Local Development

## Docker Compose (quickest)

Starts Dex (upstream IDP) and the combined portal image together. Requires Docker.

```bash
cp backend/.env.example backend/.env
# Edit backend/.env — at minimum set:
#   OIDC_ISSUER_URL, SESSION_SECRET, OIDC_CLIENT_SECRET

make up
# portal: http://localhost
# dex:    http://localhost:5556
```

To test the catalog without a live Gitea connection, add to `backend/.env`:

```bash
CATALOG_LOCAL_DIR=./internal/catalog/examples
```

The examples directory (`backend/internal/catalog/examples/`) contains a complete multi-system catalog — payments, identity, platform, observability — with components, APIs, resources, groups, and example RFCs/ADRs under `docs/`.

---

## Manual Setup (three terminals)

Use this when you want hot-reload for both frontend and backend independently.

```bash
# Terminal 1 — Dex (upstream OIDC identity provider)
docker run -p 5556:5556 \
  -v $PWD/dex-config.yaml:/etc/dex/config.yaml \
  ghcr.io/dexidp/dex:v2.44.0 dex serve /etc/dex/config.yaml

# Terminal 2 — Go backend (reads backend/.env automatically)
cp backend/.env.example backend/.env
# edit backend/.env
make dev-backend

# Terminal 3 — Next.js dev server (hot reload)
make dev-frontend
# http://localhost:3000
```

The Go backend reads `backend/.env` on startup via `godotenv.Load()`. Real environment variables always take precedence over `.env` values.

---

## Static Cluster Config (no hub cluster needed)

When running locally without a Kubernetes hub cluster, use `clusters.json` to register spoke clusters:

```bash
# backend/.env
CLUSTERS_CONFIG_FILE=./clusters.json
```

See `backend/clusters.example.json` for the full field reference including both Pinniped authentication modes (Impersonation Proxy and KubeAPI Aggregation Layer).

---

## Makefile Reference

```
make up              docker compose up --build
make down            docker compose down
make dev-backend     go run ./cmd/main.go  (from backend/)
make dev-frontend    npm run dev           (from frontend/)
make backend-build   go build -o bin/server
make backend-lint    go vet ./...
make backend-tidy    go mod tidy
make frontend-build  npm run build
make frontend-lint   npm run lint
```
