# RFC-001: Kafka for Payments Events

| Field    | Value                         |
|----------|-------------------------------|
| Status   | Superseded by ADR-001         |
| Author   | rocket-team                   |
| Date     | 2024-11-10                    |
| Tags     | kafka, payments, messaging    |

---

## Summary

Replace the direct synchronous REST calls between `payments-service` and `payments-worker` with an Apache Kafka message queue. This decouples the two services, adds durability for in-flight events, and enables retry without client involvement.

## Problem

Currently `payments-service` calls `payments-worker` over HTTP after every successful charge. This creates two problems:

1. **Tight coupling** — if `payments-worker` is down, the charge still succeeds on Stripe but the downstream job never runs, leaving the order in a broken state.
2. **No retry** — failed HTTP calls are logged and dropped; there is no dead-letter mechanism.

This has caused three production incidents in the last quarter where workers missed events and orders had to be manually reconciled.

## Proposed Solution

Introduce a Kafka topic `payments.events` between the two services:

```
payments-service  ──produce──▶  payments.events  ──consume──▶  payments-worker
```

- `payments-service` publishes a `PaymentCharged` event after a successful Stripe call.
- `payments-worker` consumes from the topic and processes jobs idempotently using a Redis key (see RFC-002 for idempotency details).
- Kafka retains messages for **7 days**, giving the worker time to catch up after an outage.
- A dead-letter topic `payments.events.dlq` receives messages that fail after 3 retries.

### Event schema

```json
{
  "event": "PaymentCharged",
  "payment_id": "pay_abc123",
  "order_id": "ord_xyz789",
  "amount_cents": 4999,
  "currency": "USD",
  "charged_at": "2024-11-10T14:23:00Z"
}
```

## Alternatives Considered

| Option | Rejected because |
|--------|-----------------|
| Keep HTTP + retry loop in service | Still tightly coupled; backpressure unresolved |
| RabbitMQ | Team has no operational experience; Kafka already used for logs pipeline |
| Outbox pattern with Postgres | Higher latency; requires DB polling job |

## Open Questions

- [ ] Which Kafka cluster do we use — the existing logs cluster or a dedicated payments one?
- [ ] Who owns the DLQ consumer and alerting?
- [ ] Do we need schema registry for the event format?

## Outcome

This RFC was **accepted** and the decision was formalised in [ADR-001](../adrs/adr-001-kafka-for-payments.md).
