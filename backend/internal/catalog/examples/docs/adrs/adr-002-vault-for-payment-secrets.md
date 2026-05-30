# ADR-002: Vault with Per-System Namespace for Payment Secrets

**Status:** Accepted  
**Date:** 2025-11-24  
**RFC:** [RFC-002](../rfcs/rfc-002-vault-for-payment-secrets.md)  
**Jira:** PAY-51  
**Deciders:** payments-team, platform-team, security

---

## Decision

Use **HashiCorp Vault** with a dedicated `payments/` namespace for all payment gateway credentials, encryption keys, and webhook secrets. Kubernetes Secrets and Sealed Secrets are rejected.

## Rationale

- PCI-DSS audit requirements mandate per-request access logs — Vault provides this; Kubernetes Secrets do not.
- Per-namespace isolation ensures compromised identities in other systems cannot read payment credentials.
- Crossplane `provider-vault` already manages platform Vault namespaces; the `payments/` namespace is additive.
- Full alternatives analysis in RFC-002.

## Consequences

- `payments-service` authenticates to Vault via Kubernetes ServiceAccount JWT → Vault JWT auth method.
- Secret injection is via Vault SDK (direct call, 30s cache TTL) — no Vault Agent sidecar.
- Rotation is zero-downtime: write new KV-v2 version, service picks up on next cache refresh.
- No payment credential ever appears in Kubernetes etcd, `kubectl describe`, or CI logs.
- Crossplane `XVault` claim in `gitops-infra` owns namespace, policy, and AppRole lifecycle.
