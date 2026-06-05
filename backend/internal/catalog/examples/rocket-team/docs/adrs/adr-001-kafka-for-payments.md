# ADR-001: Adopt Kafka for Payments Events

| Field    | Value                         |
|----------|-------------------------------|
| Status   | **Accepted**                  |
| Author   | rocket-team                   |
| Date     | 2024-12-03                    |
| RFC      | RFC-001                       |

---

## Context

`payments-service` previously called `payments-worker` synchronously over HTTP. Three production incidents in Q4 2024 were caused by the worker being unavailable during a charge, leaving orders in a broken state with no automatic recovery path.

RFC-001 proposed Apache Kafka as the decoupling layer. The RFC review concluded with consensus to adopt Kafka, with the open questions resolved as follows:

- **Cluster** — use the existing `logs-kafka` cluster in the `platform` namespace; a dedicated cluster was not justified at current volume (< 500 events/day).
- **DLQ ownership** — rocket-team owns the DLQ consumer; platform-team owns alerting via the existing alert pipeline.
- **Schema registry** — deferred; JSON with a version field is sufficient for now. Revisit when a second consumer is added.

## Decision

Adopt Kafka topic `payments.events` between `payments-service` (producer) and `payments-worker` (consumer).

### Topic configuration

| Parameter       | Value                   |
|-----------------|-------------------------|
| Topic name      | `payments.events`       |
| Partitions      | 6                       |
| Replication     | 3                       |
| Retention       | 7 days                  |
| DLQ topic       | `payments.events.dlq`   |
| Max retries     | 3                       |

### Idempotency

`payments-worker` deduplicates using `payment_id` as a Redis key with a 24-hour TTL. Duplicate events within the window are acknowledged and discarded without reprocessing.

### Rollout

1. Deploy Kafka topic and consumer group to staging — **done (2024-11-28)**
2. Shadow mode: service publishes to Kafka alongside HTTP calls — **done (2024-12-01)**
3. Cut over: remove HTTP call, worker reads from Kafka only — **done (2024-12-03)**
4. Monitor DLQ for 1 week, set alert on lag > 1000 messages

## Consequences

### Positive

- `payments-worker` outages no longer cause missed events.
- Events are durably stored for 7 days; manual reconciliation is eliminated.
- Producer and consumer can be deployed independently.

### Negative / Trade-offs

- Kafka adds operational complexity; on-call engineers must know basic Kafka tooling (`kafka-consumer-groups`, `kafka-topics`).
- Event delivery is now **at-least-once** — idempotency in the consumer is mandatory and must be tested.
- End-to-end latency increases from ~50 ms (HTTP) to ~200–400 ms (Kafka round-trip). Acceptable for async payment jobs.

## Status History

| Date       | Status       | Note                              |
|------------|--------------|-----------------------------------|
| 2024-11-10 | Proposed     | RFC-001 opened                    |
| 2024-11-20 | Under review | Team review session               |
| 2024-12-03 | Accepted     | Rollout complete, shadow mode off |
