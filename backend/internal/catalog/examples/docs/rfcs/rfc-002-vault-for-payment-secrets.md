# RFC-002: Secret Management for Payment Gateway Credentials

**Status:** Accepted  
**Author:** payments-team, platform-team  
**Jira:** PAY-51, WXOPS-88  
**Date:** 2025-11-18  
**ADR:** [ADR-002](../adrs/adr-002-vault-for-payment-secrets.md)

---

## Context

`payments-service` handles Stripe API keys, webhook signing secrets, and encryption keys for PAN tokenisation. These credentials:
- Must be rotated without a pod restart
- Must have access audited per-request (PCI-DSS requirement)
- Must not appear in `git history`, Kubernetes Secret YAML, or CI logs
- Must be accessible to the service at runtime under least-privilege (only payments-service gets payment gateway creds; no other service can read them)

---

## Options

### Option A — Kubernetes Secrets (base)

Store credentials as Kubernetes Secrets, mount as environment variables.

**Problems:**
- Secrets are base64, not encrypted at rest by default (requires etcd encryption config)
- No per-request audit log — `kubectl get secret` gives full access to any cluster admin
- Rotation requires pod restart (env vars are baked at pod start unless using projected volumes + reloader)
- No least-privilege isolation — any workload in the namespace with a `ServiceAccount` that has `get secret` can read all secrets

### Option B — Sealed Secrets (Bitnami)

Encrypt secrets client-side, commit the SealedSecret CRD to git, the controller decrypts into a standard K8s Secret.

**Problems:**
- Still materialises as a Kubernetes Secret at runtime — same audit and isolation issues as Option A
- Encryption is per-cluster; rotating the controller key requires re-sealing all secrets
- No dynamic secrets (short-lived, auto-rotated credentials)

### Option C — Vault with per-system namespace (Recommended)

HashiCorp Vault with:
- A dedicated `payments/` namespace (Vault namespace, not K8s namespace)
- AppRole authentication for `payments-service` — role bound to K8s ServiceAccount via JWT auth
- KV-v2 for static secrets (API keys, webhook signing secrets)
- Transit engine for encryption key management (PAN tokenisation)
- Vault Agent Sidecar or direct SDK calls for secret injection

**Benefits:**
- Fine-grained policy: `payments-service` AppRole can only read `payments/kv/*` — no other path
- Full audit log in Vault: every secret read is recorded with AppRole ID and timestamp
- Dynamic rotation: KV-v2 allows version-aware rotation; old versions remain readable for in-flight requests during rotation window
- No secret ever appears in Kubernetes etcd — Vault Agent injects into memory-backed `tmpfs` only
- Crossplane `provider-vault` manages namespace, policy, and AppRole lifecycle declaratively

---

## Decision

**Vault with per-system namespace (Option C).**

The deciding factors:
1. PCI-DSS audit requirements — per-request audit trail is non-negotiable for payment gateway credentials.
2. Crossplane `provider-vault` already manages the `platform-vault` for ArgoCD and portal credentials; extending it to a `payments-vault` namespace is additive, not new infrastructure.
3. Dynamic rotation without pod restarts is necessary for zero-downtime credential rotation under PCI guidelines.
4. Per-system namespace isolation means a compromised identity in another system (e.g., observability) cannot read payment gateway keys even with broad cluster admin permissions.

---

## Consequences

- Crossplane `XVault` claim provisions `payments/` namespace, AppRole, and KV-v2 mount.
- `payments-service` authenticates via Kubernetes ServiceAccount JWT → Vault JWT auth method.
- Secrets are injected via Vault SDK (direct call on startup) rather than Vault Agent sidecar — avoids sidecar overhead, keeps the pod spec clean.
- Rotation procedure: write new secret version to Vault KV-v2 → service reads latest version on next cache refresh (30s TTL) → old version expires after rotation window.
- Secret never appears in `kubectl describe pod` output or CI pipeline logs.
