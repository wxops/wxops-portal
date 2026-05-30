# Container Design

The portal ships as a **single Docker image** built from the `Dockerfile` at the repo root. Three processes run inside one container managed by supervisord.

---

## Process Layout

```
supervisord (root)
├── nginx          :80   — public entry point, reverse proxy
├── wxops-backend  :8080 — Go binary, loopback only
└── next.js        :3000 — Node.js SSR server, loopback only
```

nginx is the only process that accepts external connections. The Go backend and Next.js are bound to loopback and never reached directly from outside the container.

---

## Why nginx Inside the Container

The Kubernetes Ingress handles external TLS and load balancing. nginx inside the container is not redundant — it provides three things neither Go nor Node.js should own:

**1. Static asset serving from disk**

`/_next/static/*` and `/public/*` are immutable, content-hashed files. nginx serves them with kernel-level `sendfile()` — zero userspace copy, zero Node.js involvement. Without nginx, every static asset request occupies a Node.js event loop slot that should be doing SSR.

The current config proxies all paths through Node.js for simplicity. When the portal grows and static asset load becomes measurable, uncomment the `/_next/static/` and `/public/` location blocks in `deploy/nginx.conf` — no application code changes needed.

**2. Response buffering for slow clients**

Without nginx, a Go goroutine or Node.js event loop slot is held open until the client finishes receiving the full response — even if that client is on a slow mobile connection. nginx buffers the complete upstream response immediately, releases the upstream process, then delivers to the client at the client's pace.

**3. Upstream connection pooling**

nginx maintains persistent keep-alive pools to both the Go backend and Next.js, eliminating TCP handshake overhead from every request on the hot path.

### Future extensions nginx enables without application changes

- Per-route rate limiting (`limit_req_zone`) for `/auth/` and `/api/` endpoints
- Fine-grained cache headers per path
- Health check endpoint (`/healthz`) returning 200 without touching application processes

---

## Multi-Stage Dockerfile

```
Stage 1 (go-builder)    golang:1.23-alpine
  └── CGO_ENABLED=0 go build -ldflags="-s -w"
      → /usr/local/bin/wxops-backend (~7MB static binary)

Stage 2 (node-builder)  node:20-alpine
  └── npm ci && npm run build
      → .next/standalone/ (self-contained Node.js server)

Stage 3 (final)         node:20-alpine + nginx + supervisor
  ├── Go binary from stage 1
  ├── Next.js standalone + static assets from stage 2
  ├── deploy/nginx.conf
  └── deploy/supervisord.conf
```

Static assets (`.next/static/`, `public/`) are copied separately — they are not included in the standalone output.

---

## Privilege Model

| Process | User | Why |
|---|---|---|
| supervisord | root | nginx must bind port 80 (privileged); supervisord needs root to fork processes under different UIDs |
| wxops-backend | `node` (UID 1000) | no privileged port, no system writes |
| next.js | `node` (UID 1000) | `/app` is `chown`-ed to `node` in the Dockerfile |
| nginx master | root | holds the port 80 socket |
| nginx workers | `nginx` | dropped via `user nginx;` in nginx.conf |

**Future — full non-root operation:**
Move nginx to port 8080. Then supervisord, nginx, Go backend, and Next.js can all run as the `node` user. Steps:
1. `listen 80;` → `listen 8080;` in `deploy/nginx.conf`, add `/tmp/nginx-*` temp paths
2. `user=node` in `[supervisord]` block of `deploy/supervisord.conf`
3. `user=node` on `[program:nginx]`
4. `EXPOSE 80` → `EXPOSE 8080` in `Dockerfile`
5. Update port mapping in `docker-compose.yml` and Kubernetes Service

The Kubernetes Service maps the external port — nothing visible to users changes.

See: [Starting supervisord as root or not?](https://stackoverflow.com/questions/19918177/starting-supervisord-as-root-or-not)

---

## Logging

All three processes write to stdout with a distinguishable prefix so Docker's single log stream is readable:

```
[29/May/2026 12:00:00] [nginx] GET /dashboard 200 4521b 0.012s
[backend] 2026/05/29 12:00:01 | 200 |     1.23ms | GET     /api/v1/clusters
[frontend] GET /dashboard 200 in 45ms
```

- `[nginx]` — set via `log_format portal` in `deploy/nginx.conf`
- `[backend]` — set via `log.SetPrefix("[backend] ")` in `backend/cmd/main.go` + custom Gin formatter in `backend/internal/server/server.go`
- `[frontend]` — supervisord wraps `node server.js` with `sed -e 's/^/[frontend] /'`

---

## Secret Injection

The Go binary reads all configuration from `os.Getenv()`. In Docker Compose, use `env_file: ./backend/.env` — Docker Compose injects each line as a real process environment variable. In Kubernetes, use ESO (External Secrets Operator) to sync secrets from Vault into a K8s Secret, then reference with `envFrom: secretRef`.

Vault Agent file injection (`.env` file at `/vault/secrets/`) would require changing `godotenv.Load()` in `config.go` to accept an explicit path. ESO is preferred because it requires zero code changes and the K8s Secret cache survives a Vault outage.
