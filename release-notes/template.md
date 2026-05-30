## What's Changed

### Features

- **auth**: Pinniped Supervisor OIDC with PKCE — one login covers all spoke clusters
- **auth**: AES-256-GCM encrypted session cookie; RFC 8693 cluster token exchange
- **cluster**: Pinniped Concierge TokenCredentialRequest → short-lived mTLS cert with 15-min cache
- **cluster**: Cluster registry — K8s Secrets (production) and clusters.json (dev)
- **cluster**: Kubeconfig download with Pinniped exec-credential plugin
- **catalog**: Backstage-compatible entity parser (Component, API, System, Group, Resource)
- **catalog**: Gitea read-only client + local filesystem reader for dev/testing
- **catalog**: 5-minute TTL cache with double-checked locking
- **catalog**: System-as-application UI with per-system Mermaid relationship graph
- **catalog**: Entity detail page with RFC/ADR/documentation link grouping
- **container**: Combined Docker image — nginx + Go backend + Next.js under supervisord
