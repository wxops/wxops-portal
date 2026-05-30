# RFC-001: Async Event Stream for Payments — Kafka vs NATS JetStream

**Status:** Accepted  
**Author:** payments-team  
**Jira:** PAY-42  
**Date:** 2025-11-10  
**ADR:** [ADR-001](../adrs/adr-001-kafka-for-payments-events.md)

---

## Context

`payments-service` needs to publish payment lifecycle events (`payment.created`, `payment.succeeded`, `payment.failed`, `refund.initiated`) so that `payments-worker` can perform async reconciliation (ledger updates, notification dispatch, retry logic) without blocking the synchronous API path.

We need a message broker that can guarantee:
- **At-least-once delivery** — a failed worker restart must not silently drop events
- **Ordered processing per payment ID** — retries must not overtake the original event for the same payment
- **Persistent storage** — events must survive a broker restart; workers may lag during incidents
- **Audit trail** — finance and compliance require a replayable event log

---

## Options

### Option A — NATS JetStream

| Dimension | Assessment |
|-----------|-----------|
| Ops burden | Low — single binary, embedded in Kubernetes via Helm |
| Go SDK | First-class (`nats.go`) |
| Ordering guarantee | Per-subject ordering only; cross-subject requires careful design |
| Retention | Configurable (time or size); replayable from offset |
| Ecosystem | Limited — no standard connectors to data warehouse |
| Platform alignment | Not currently used anywhere in the platform |

### Option B — Kafka (Strimzi operator on Kubernetes)

| Dimension | Assessment |
|-----------|-----------|
| Ops burden | Higher — ZooKeeper/KRaft, partition rebalancing |
| Go SDK | `confluent-kafka-go`, `sarama` — both mature |
| Ordering guarantee | Strict ordering within partition; route by `payment_id` key → guaranteed per-payment order |
| Retention | Log compaction + configurable retention period; full replay |
| Ecosystem | Kafka Connect, Schema Registry, ksqlDB — data team already uses these |
| Platform alignment | Data team runs a shared Kafka cluster; payments can use a dedicated topic group |

---

## Decision

**Kafka.**

The deciding factors:
1. The data team's existing Kafka cluster reduces cold-start ops cost — the payments topics can be provisioned via Crossplane `XQueue` claim without standing up a new broker.
2. Partition-key routing on `payment_id` gives strict per-payment ordering without application-level locking.
3. Kafka Connect and Schema Registry are already available on the platform; payments event schemas can evolve with Avro compatibility checks without re-deploying consumers.
4. NATS JetStream's lighter footprint is a benefit for new deployments, but the platform already incurs Kafka ops cost — there is no savings to capture.

---

## Consequences

- `payments-service` produces to Kafka; `payments-worker` consumes from Kafka.
- The `XQueue` Crossplane claim provisions the Kafka topic group; topic names follow the pattern `payments.<event-type>`.
- Consumer group ID is `payments-worker-cg`; offset is committed after successful processing.
- Schema Registry enforces Avro schema evolution rules — breaking schema changes require a new topic version.
- Ops: Crossplane manages topic provisioning; Strimzi manages broker lifecycle. No manual `kafka-topics.sh` calls.
