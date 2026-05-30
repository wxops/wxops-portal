# ADR-001: Use Kafka for Payments Event Stream

**Status:** Accepted  
**Date:** 2025-11-24  
**RFC:** [RFC-001](../rfcs/rfc-001-kafka-for-payments-events.md)  
**Jira:** PAY-42  
**Deciders:** payments-team, platform-team

---

## Decision

Use **Kafka** (Strimzi operator, provisioned via Crossplane `XQueue` claim) as the async event stream for all `payments-service` → `payments-worker` communication.

## Rationale

- Partition routing on `payment_id` guarantees strict per-payment event ordering without application-level locking.
- The data team's existing Strimzi cluster absorbs payments topics with no new broker infrastructure.
- Schema Registry enforces Avro compatibility, preventing silent breaking changes to the event contract.
- Full alternatives analysis in RFC-001.

## Consequences

- `payments-service` is a Kafka producer; `payments-worker` is a Kafka consumer (`consumer-group: payments-worker-cg`).
- Topic provisioning is owned by the Crossplane `XQueue` claim in `gitops-infra`.
- Breaking event schema changes require a new topic version (`payments.v2.<event-type>`); both consumer versions must run in parallel during migration window.
- Operational dependency: Strimzi cluster availability directly affects payment async processing. Mitigation: synchronous payment confirmation is unaffected (Kafka is only the async path).
