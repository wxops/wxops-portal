# Security Policy

W'xOps Portal sits between developers and production clusters, so we take reports
seriously and try to make reporting worth your time.

## Reporting a vulnerability

**Please do not open a public issue, pull request, or discussion for a security
report.** Public disclosure before a fix exists puts every deployment at risk.

Email **security@wxops.cloud** with as much of the following as you have:

- What you found, and where — file path, API endpoint, or manifest
- How to reproduce it, ideally as concrete steps or a request
- What an attacker gains: the impact, not just the anomaly
- The version or commit SHA you tested against
- Any suggested fix, if you have one in mind

Reports in any language are welcome. A rough report you are unsure about is far
more useful to us than a polished one you never send.

## What to expect

This project is maintained by one person, so the commitments below are
deliberately modest — we would rather meet them than impress you and miss.

| Stage | Target |
|---|---|
| Acknowledgement that your report arrived | 5 business days |
| Initial assessment and severity call | 10 business days |
| Fix, or a documented mitigation | Depends on severity; we will tell you the plan |

If you have not heard anything within 10 business days, please resend — assume
the mail was lost rather than ignored.

We follow coordinated disclosure. We ask for up to 90 days before public
disclosure, and will usually move much faster. When a fix ships, we credit you
in the release notes by whatever name you choose, or omit you entirely if you
would rather stay anonymous.

We do not currently run a bug bounty and cannot offer payment.

## Supported versions

The project is pre-1.0, so only the latest minor line receives security fixes.

| Version | Supported |
|---|---|
| 0.5.x | ✅ |
| < 0.5.0 | ❌ — upgrade to 0.5.x |

## Before you report: the security model

The portal is built around a small set of structural constraints, not policies
layered on afterwards. They are documented — with the evidence and the commands
to verify each one yourself — in
[`docs/security/security-assurance.md`](docs/security/security-assurance.md).

In short, the portal:

- **Never writes to a Kubernetes cluster.** Every change is a reviewed Gitea
  commit reconciled by ArgoCD.
- **Never reads or deletes a secret.** The Vault client implements create and
  update only; no read or delete code path exists, and the bound Vault policy
  does not grant those verbs.
- **Holds no standing cluster credential** for tenant resources. It exchanges the
  logged-in user's token for a short-lived Pinniped mTLS credential per request,
  so it can never exceed that user's own RBAC.
- **Has no database.** Sessions are client-side encrypted cookies; the catalog
  lives in Git; caches are in-memory with a TTL.
- **Reaches only operator-configured hosts**, enforceable with the egress
  `NetworkPolicy` in §3 of the assurance doc.

This matters for reporting: a finding that assumes the portal holds cluster-admin,
can read a secret, or can deploy without a merged PR is usually describing
something with no code path behind it. §1 and §2 of the assurance doc, plus the
reviewer checklist in §8, will tell you in a few minutes whether the path you
have in mind exists. That is not a reason to stay quiet — if you believe you have
broken one of those claims, that is exactly the report we most want.

## Already known

**Catalog-declared spec fetch.** When an `API` catalog entity declares an
OpenAPI/AsyncAPI spec by absolute URL and no higher-priority resolution path
applies, the portal performs a plain `GET` on that URL. This is disclosed in §4
of the assurance doc, is constrained by catalog PR review and by the egress
policy, and hardening is tracked (a `CATALOG_SPEC_FETCH` mode flag). Reports of
this specific behaviour are welcome but are not new findings.

## Out of scope

These are known, documented, and not treated as vulnerabilities:

- **`DEV_BYPASS_AUTH=true`** skips OIDC and auto-logs in as `dev / platform-team`.
  It is documented as dev-only in
  [`environment-variables.md`](docs/getting-started/environment-variables.md).
  Enabling it in production is a misconfiguration, not a flaw.
- **`dex-config.yaml`** is a local development fixture. Its static client secret
  and the bcrypt hash of `password` are deliberately well-known and are not
  intended for any deployed environment.
- **Vulnerabilities in Gitea, Vault, ArgoCD, Crossplane, Pinniped, or Grafana
  themselves.** Please report those upstream. If the portal *misuses* one of
  them, that is in scope and we want to hear it.
- **Hardening you can enable yourself**, such as the egress `NetworkPolicy` in §3
  of the assurance doc.
- **Automated scanner output with no demonstrated impact.** A CVE in a transitive
  dependency on a code path the portal never reaches is a maintenance task, not a
  security report — please open a normal issue for it.

## Hardening a deployment

If you are standing the portal up rather than reporting against it, start with:

- [`docs/getting-started/deployment.md`](docs/getting-started/deployment.md) — RBAC and OIDC client setup
- [`docs/security/security-assurance.md`](docs/security/security-assurance.md) §3 — the egress `NetworkPolicy` to apply
- [`docs/security/permissions.md`](docs/security/permissions.md) — the role × action matrix
