# Payments Service Runbook

**System:** payments
**Owner:** rocket-team
**Last reviewed:** 2026-06-05

---

## Overview

The payments pipeline consists of three layers:

| Layer | Component | Tech |
|-------|-----------|------|
| API | `payments-service` | Go + Gin |
| Events | Kafka (via ADR-001) | Apache Kafka |
| Persistence | `payments-db` | PostgreSQL |

---

## Health Checks

### Quick status
```bash
# Service liveness
curl -s http://payments-service:8080/healthz

# Readiness (includes DB connectivity)
curl -s http://payments-service:8080/readyz
```

Expected response: `{"status":"ok"}`

### Grafana dashboard
Open the [Payments Dashboard](https://grafana.wxops.cloud/d/payments-overview) and check:
- **Request rate** — baseline ~500 rps during business hours
- **Error rate** — alert fires above 1%
- **P99 latency** — SLO is < 200 ms
- **Kafka consumer lag** — should be < 1 000 messages

---

## Deployment

Deployments are triggered by merging to `main` in the `wxops-gitops-infrastructure` repo. ArgoCD syncs automatically within 2 minutes.

```bash
# Check rollout status
kubectl rollout status deployment/payments-service -n payments

# Roll back if needed
kubectl rollout undo deployment/payments-service -n payments
```

---

## Common Incidents

### High error rate (> 1%)

1. Check recent deployments: `kubectl rollout history deployment/payments-service -n payments`
2. Tail logs: `kubectl logs -l app=payments-service -n payments --since=5m`
3. Look for `FATAL` or `connection refused` — usually a DB or Kafka connectivity issue.
4. If a bad deploy: roll back immediately, then page the rocket-team lead.

### Database connection exhaustion

```bash
# Check active connections
kubectl exec -it payments-db-0 -n payments -- psql -U payments \
  -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"
```

Max connections is 100. If `active` > 80, restart the service pods to clear stale connections.

### Kafka consumer lag spiking

1. Verify the `payments-worker` pods are running: `kubectl get pods -n payments -l app=payments-worker`
2. Check worker logs for deserialization errors — usually means a schema change was not backwards-compatible.
3. Escalate to rocket-team if lag exceeds 10 000 messages for more than 5 minutes.

---

## On-Call Contacts

| Role | Contact |
|------|---------|
| Primary on-call | rocket-team rotation (PagerDuty) |
| Database (DBA) | platform-team |
| Kafka infra | platform-team |

---

## Related Decisions

- [ADR-001: Adopt Kafka for Payments Events](/dashboard/catalog/Doc/adr-001-kafka-for-payments) — why we use Kafka
- [RFC-001: Kafka for Payments Events](/dashboard/catalog/Doc/rfc-001-kafka-for-payments) — original proposal
