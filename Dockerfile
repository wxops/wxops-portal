# ── Stage 1: Build Go backend ──────────────────────────────────────────────
FROM golang:1.23-alpine AS go-builder
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ .
RUN CGO_ENABLED=0 GOOS=linux go build \
      -ldflags="-s -w" \
      -o /usr/local/bin/wxops-backend \
      ./cmd

# ── Stage 2: Build Next.js frontend ────────────────────────────────────────
FROM node:22-alpine AS node-builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
# Rewrites in next.config.ts proxy /auth/* and /api/v1/* to the Go backend.
# At runtime inside the combined image, nginx handles this routing instead,
# but BACKEND_URL is still read by SSR page code for direct server→backend calls.
ARG BACKEND_URL=http://127.0.0.1:8080
ENV BACKEND_URL=$BACKEND_URL

# ── Build-time public vars (baked into the JS bundle by next build) ��───────
# CI passes these via --build-arg at release time.
# ArgoCD's URL is deliberately NOT here: it is a runtime backend variable
# (ARGOCD_URL) served inside API responses, so operators repoint it with a
# Deployment env edit instead of rebuilding the image.
# APP_VERSION:            stripped git tag (e.g. 0.3.0) set by the stamp step
ARG APP_VERSION="0.0.0"
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION

RUN npm run build

# ── Stage 3: Combined runtime image ────────────────────────────────────────
FROM node:22-alpine
RUN apk add --no-cache nginx supervisor

# Go binary
COPY --from=go-builder /usr/local/bin/wxops-backend /usr/local/bin/wxops-backend

# Next.js standalone server + static assets + public.
# Owned by 'node' (UID 1000) so the frontend program in supervisord.conf
# can run as that user without needing root access to /app.
# Static assets are NOT included in standalone — copy separately.
COPY --chown=node:node --from=node-builder /app/.next/standalone /app
COPY --chown=node:node --from=node-builder /app/.next/static     /app/.next/static
COPY --chown=node:node --from=node-builder /app/public           /app/public

# nginx and supervisord configuration
COPY deploy/nginx.conf       /etc/nginx/nginx.conf
COPY deploy/supervisord.conf /etc/supervisord.conf

# Port exposed by nginx (public entry point).
# Go backend (8080) and Next.js (3000) are internal — not published.
EXPOSE 80

CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisord.conf"]
