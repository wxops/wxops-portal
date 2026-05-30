# ADR-003: Redis for Idempotency Key Storage in Payments Service

**Status:** Accepted  
**Date:** 2025-12-02  
**Jira:** PAY-67  
**Deciders:** payments-team

---

## Decision

Use **Redis** (provisioned via Crossplane `XCache` claim as `payments-cache`) to store short-lived idempotency keys for `payments-service` API endpoints.

## Context

Payment API clients must be able to safely retry failed requests without double-charging. The `Idempotency-Key` header value is stored with the response for a fixed window (24 hours). No RFC was opened — this is a narrowly scoped implementation choice with no architectural alternatives worth debating.

## Rationale

- Redis TTL-based key expiry handles the 24-hour idempotency window natively — no background job needed.
- Redis is already provisioned for `payments-cache`; the idempotency store shares the same cluster (separate key namespace `idem:`).
- In-memory storage is acceptable: if Redis restarts, clients retry with the same key and the payment is processed once (idempotency key miss → treat as new request → check for existing payment in Postgres by external reference before processing).

## Consequences

- Idempotency keys are stored as `idem:<key>` with a 24-hour TTL.
- On Redis failure, `payments-service` falls back to processing the request and relying on the Postgres unique constraint on `external_reference` to reject duplicates.
- The fallback means a Redis outage does not block payment processing — it only removes the fast-path idempotency check.
- Rate limiting (also in Redis, `rl:` namespace) is unaffected by idempotency key failures.
