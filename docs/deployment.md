# Production Deployment

## Step 1 — Hub cluster: namespace and portal RBAC

The portal reads cluster registrations by listing Secrets in a single namespace (`CLUSTER_NAMESPACE`, default `wxops-system`). That is the **only** K8s permission it needs — `get` and `list` on Secrets in that namespace, nothing else.

The `ServiceAccount` is attached to the portal `Deployment`. When the pod runs inside the hub cluster, Kubernetes automatically mounts the SA token — no `KUBECONFIG` env var is required.

> **If the portal and cluster Secrets live in different namespaces**, the `Role` and `RoleBinding` must both be in the Secrets namespace while the `RoleBinding` subject references the SA from the portal namespace. A namespaced `Role` + `RoleBinding` is sufficient — no `ClusterRole` needed.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: wxops-system
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: wxops-portal
  namespace: wxops-system
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: wxops-portal-cluster-reader
  namespace: wxops-system
rules:
- apiGroups: [""]
  resources: ["secrets"]
  verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: wxops-portal-cluster-reader
  namespace: wxops-system
subjects:
- kind: ServiceAccount
  name: wxops-portal
  namespace: wxops-system
roleRef:
  kind: Role
  name: wxops-portal-cluster-reader
  apiGroup: rbac.authorization.k8s.io
```

---

## Step 2 — Pinniped Supervisor: register the portal as an OIDC client

### 2a — Create the OIDCClient CR

The CR name **must** start with `client.oauth.pinniped.dev-`. This full name is the `OIDC_CLIENT_ID` the portal uses.

```yaml
apiVersion: config.supervisor.pinniped.dev/v1alpha1
kind: OIDCClient
metadata:
  name: client.oauth.pinniped.dev-wxops-portal
  namespace: pinniped-supervisor
spec:
  allowedRedirectURIs:
  - https://portal.example.com/auth/callback
  - http://127.0.0.1:3000/auth/callback         # local dev only — remove in production
  allowedGrantTypes:
  - authorization_code
  - refresh_token
  - urn:ietf:params:oauth:grant-type:token-exchange
  allowedScopes:
  - openid
  - offline_access
  - username
  - groups
  - pinniped:request-audience
```

```bash
kubectl apply -f oidcclient-wxops-portal.yaml

# Verify — phase should be "Ready"
kubectl get oidcclient client.oauth.pinniped.dev-wxops-portal \
  -n pinniped-supervisor \
  -o jsonpath='{.status.conditions}' | jq .
```

### 2b — Generate the client secret (first time)

> **Important:** Pinniped stores only a bcrypt hash — the plaintext is returned **once**. Copy it immediately.
> `OIDCClientSecretRequest` only supports the `create` verb.

```bash
cat <<EOF | kubectl create -o yaml -f -
apiVersion: clientsecret.supervisor.pinniped.dev/v1alpha1
kind: OIDCClientSecretRequest
metadata:
  name: client.oauth.pinniped.dev-wxops-portal
  namespace: pinniped-supervisor
spec:
  generateNewSecret: true
EOF
```

Copy `status.generatedSecret` — this is your `OIDC_CLIENT_SECRET`. Store it immediately:

```bash
kubectl create secret generic wxops-portal-secrets \
  -n wxops-system \
  --from-literal=oidc-client-secret='<paste generatedSecret here>' \
  --from-literal=session-secret="$(openssl rand -hex 32)"
```

### 2c — Rotate the client secret

Pinniped allows up to **5 active secrets** per client — generate a new one, update the portal, then revoke the old.

```bash
# Step 1 — generate new secret (same command as 2b)
# Step 2 — update portal
kubectl patch secret wxops-portal-secrets -n wxops-system \
  --type='json' \
  -p='[{"op":"replace","path":"/data/oidc-client-secret","value":"'$(echo -n '<new-secret>' | base64)'"}]'
kubectl rollout restart deployment/wxops-portal -n wxops-system

# Step 3 — revoke old secrets
cat <<EOF | kubectl create -o yaml -f -
apiVersion: clientsecret.supervisor.pinniped.dev/v1alpha1
kind: OIDCClientSecretRequest
metadata:
  name: client.oauth.pinniped.dev-wxops-portal
  namespace: pinniped-supervisor
spec:
  generateNewSecret: false
  revokeOldSecrets: true
EOF
```

Emergency rotation (generate + revoke in one request):

```bash
cat <<EOF | kubectl create -o yaml -f -
apiVersion: clientsecret.supervisor.pinniped.dev/v1alpha1
kind: OIDCClientSecretRequest
metadata:
  name: client.oauth.pinniped.dev-wxops-portal
  namespace: pinniped-supervisor
spec:
  generateNewSecret: true
  revokeOldSecrets: true
EOF
```

---

## Step 3 — Each spoke cluster: install Concierge and JWTAuthenticator

```yaml
apiVersion: authentication.concierge.pinniped.dev/v1alpha1
kind: JWTAuthenticator
metadata:
  name: wxops-jwt-authenticator
spec:
  issuer: https://supervisor.example.com/providers/pinniped
  audience: my-spoke-cluster          # must be unique per cluster
  tls:
    certificateAuthorityData: <base64-encoded Supervisor CA PEM>
```

> Each spoke must have a unique `audience`. If two clusters share one, a token for one is valid on the other.

---

## Step 3b — Each spoke cluster: tenant user RBAC

Pinniped handles **authentication** (who the user is). Kubernetes RBAC handles **authorization** (what they can do). Once Concierge validates the user's token, every portal cluster API call — listing pods, services, deployments, quotas — is made with the user's own identity. If that identity has no RoleBinding on the spoke, every call returns 403.

Gitea OIDC emits groups in exactly the format `orgName:teamName` (e.g. `wxops:rocket-team`). These strings are the RBAC subjects on the spoke cluster.

### One-time per spoke: create the shared ClusterRole

Apply this once when you first set up a spoke cluster. It defines the read-only permissions the portal cluster tabs require.

```yaml
# Apply once per spoke cluster
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: wxops-portal-tenant-viewer
  labels:
    app.kubernetes.io/managed-by: wxops-portal
rules:
# Core resources — pods, services, resource quotas
- apiGroups: [""]
  resources: ["pods", "services", "resourcequotas"]
  verbs: ["get", "list"]
# Apps resources — deployments
- apiGroups: ["apps"]
  resources: ["deployments"]
  verbs: ["get", "list"]
---
# Platform-team additionally needs to list all namespaces
# (regular tenants derive namespaces from their Pinniped groups — no K8s call needed)
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: wxops-portal-platform-viewer
  labels:
    app.kubernetes.io/managed-by: wxops-portal
rules:
- apiGroups: [""]
  resources: ["pods", "services", "resourcequotas", "namespaces"]
  verbs: ["get", "list"]
- apiGroups: ["apps"]
  resources: ["deployments"]
  verbs: ["get", "list"]
---
# platform-team ClusterRoleBinding (cluster-wide, all namespaces)
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: wxops-portal-platform-team
  labels:
    app.kubernetes.io/managed-by: wxops-portal
subjects:
- kind: Group
  name: platform-team        # exact string Pinniped resolves from Gitea OIDC
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: wxops-portal-platform-viewer
  apiGroup: rbac.authorization.k8s.io
```

### Per tenant namespace: RoleBinding

Apply this when a new tenant org is onboarded (i.e. when their namespace is first created).
The namespace is `tenant-{orgName}`. The subjects list every group under that org — both developer teams and Managers share the same viewer role; any elevated permissions beyond this can be added as separate RoleBindings directly in the namespace.

```yaml
# Template — substitute <org> and list all team groups under that org.
# The portal treats developers and managers identically for cluster read access;
# role-specific restrictions are handled by the portal itself, not RBAC.
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: wxops-portal-viewer
  namespace: tenant-<org>             # e.g. tenant-wxops
  labels:
    app.kubernetes.io/managed-by: wxops-portal
subjects:
# Add one entry per team group in this org (orgName:teamName format from Gitea OIDC).
# Update when new teams are added to the org.
- kind: Group
  name: <org>:rocket-team             # e.g. wxops:rocket-team
  apiGroup: rbac.authorization.k8s.io
- kind: Group
  name: <org>:Managers
  apiGroup: rbac.authorization.k8s.io
# - kind: Group
#   name: <org>:<another-team>
#   apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: wxops-portal-tenant-viewer
  apiGroup: rbac.authorization.k8s.io
```

### What each permission covers

| ClusterRole rule | Portal feature |
|---|---|
| `pods: get, list` | Pods tab + Pod detail drawer (containers, env vars, volume mounts) |
| `deployments: get, list` | Deployments tab |
| `services: list` | Services tab + in-cluster DNS names |
| `resourcequotas: list` | Quota strip above the resource tabs |
| `namespaces: list` | Platform-team only — `ListNamespaces` handler calls K8s directly |

> **If RBAC is missing:** the portal surfaces the 403 response as an error message in the relevant tab — it does not crash or hide the tab. Configure the binding and reload; no portal restart required.

### When to update

| Event | Action |
|---|---|
| New spoke cluster added | Apply both ClusterRoles + `ClusterRoleBinding` for `platform-team` |
| New tenant org onboarded | Apply the `RoleBinding` template in `tenant-{org}` |
| New team added to existing org | Add the new `orgName:teamName` group to the existing `RoleBinding` |
| Team removed from org | Remove the group from the `RoleBinding` |

---

## Step 4 — Register spoke clusters in the hub

Create one Secret per spoke in `wxops-system`:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: cluster-prod-east
  namespace: wxops-system
  labels:
    wxops.cloud/kind: cluster
  annotations:
    wxops.cloud/cluster-id:   prod-east
    wxops.cloud/cluster-name: "Production East"
    wxops.cloud/jwt-authenticator-audience: prod-east
    wxops.cloud/jwt-authenticator-name: wxops-jwt-authenticator
    wxops.cloud/issuer-url: https://supervisor.example.com/providers/pinniped
    wxops.cloud/upstream-idp-name: "Dex OIDC Authenticator"  # spec.identityProviders[].displayName in the FederationDomain
    wxops.cloud/upstream-idp-type: oidc
stringData:
  api-server: "https://api.prod-east.example.com:6443"
  ca-bundle: |
    -----BEGIN CERTIFICATE-----
    <spoke cluster CA PEM>
    -----END CERTIFICATE-----
```

See [cluster-registry.md](./cluster-registry.md) for the full annotation schema and CA bundle options.

---

## Step 5 — Deploy the portal

The portal ships as a single Docker image (`Dockerfile` at repo root) combining nginx, the Go backend, and the Next.js SSR server under supervisord. See [container.md](./container.md) for the internal design.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: wxops-portal
  namespace: wxops-system
spec:
  replicas: 2
  selector:
    matchLabels:
      app: wxops-portal
  template:
    metadata:
      labels:
        app: wxops-portal
    spec:
      serviceAccountName: wxops-portal
      containers:
      - name: portal
        image: ghcr.io/yourorg/wxops-portal:latest
        ports:
        - containerPort: 80
        startupProbe:
          httpGet:
            path: /healthz
            port: 80
          periodSeconds: 5
          failureThreshold: 12    # 12 × 5s = 60s grace period for all three processes to start
        livenessProbe:
          httpGet:
            path: /healthz
            port: 80
          initialDelaySeconds: 0
          periodSeconds: 15
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /readyz
            port: 80
          initialDelaySeconds: 0
          periodSeconds: 10
          failureThreshold: 3
        envFrom:
        - secretRef:
            name: wxops-portal-secrets     # SESSION_SECRET, OIDC_CLIENT_SECRET
        env:
        - name: FRONTEND_URL
          value: "https://portal.example.com"
        - name: OIDC_ISSUER_URL
          value: "https://supervisor.example.com/providers/pinniped"
        - name: OIDC_CLIENT_ID
          value: "client.oauth.pinniped.dev-wxops-portal"
        - name: OIDC_REDIRECT_URI
          value: "https://portal.example.com/auth/callback"
        - name: CLUSTER_NAMESPACE
          value: "wxops-system"
        - name: GITEA_URL
          value: "https://gitea.example.com"
        - name: GITEA_CATALOG_OWNER
          value: "platform"
        - name: GITEA_CATALOG_REPO
          value: "gitops-infra"
        - name: GITEA_CATALOG_PATH
          value: "catalog"
---
apiVersion: v1
kind: Service
metadata:
  name: wxops-portal
  namespace: wxops-system
spec:
  selector:
    app: wxops-portal
  ports:
  - port: 80
    targetPort: 80
```

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: wxops-portal
  namespace: wxops-system
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
spec:
  rules:
  - host: portal.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: wxops-portal
            port:
              number: 80
  tls:
  - hosts:
    - portal.example.com
    secretName: wxops-portal-tls
```

---

## Step 6 — Supervisor TLS CA

The portal needs to verify the Pinniped Supervisor's TLS certificate when performing OIDC discovery and token exchange. The same CA is also embedded into every kubeconfig the portal generates, so `pinniped login oidc` can verify the Supervisor when the user runs `kubectl`.

### Which scenario applies to you?

| Supervisor certificate | Action |
|---|---|
| Issued by Let's Encrypt, DigiCert, or another public CA | **Nothing** — the system root pool is used automatically |
| Issued by your own internal / private CA | Set `OIDC_CA_BUNDLE` or `OIDC_CA_BUNDLE_FILE` (see below) |
| Self-signed, dev-only (no CA at all) | Set `OIDC_TLS_SKIP_VERIFY=true` — but read the warning below |

### Public CA (Let's Encrypt, etc.)

No configuration needed. When neither `OIDC_CA_BUNDLE` nor `OIDC_TLS_SKIP_VERIFY` is set, the portal uses Go's default transport (system root pool), and the generated kubeconfig omits `--ca-bundle-data` so `pinniped login oidc` also falls back to the system root pool. Let's Encrypt certificates work without any extra steps.

### Private / internal CA

Pass the Supervisor's CA PEM via environment variable:

```bash
# Inline PEM
OIDC_CA_BUNDLE="$(cat supervisor-ca.pem)"

# Or mount as a file and point to it
OIDC_CA_BUNDLE_FILE=/etc/wxops/certs/ca.pem
```

The portal uses this CA for its own OIDC calls **and** embeds it as `--ca-bundle-data` in the generated kubeconfig, so `pinniped login oidc` verifies the Supervisor with the correct CA.

> **Note:** `OIDC_CA_BUNDLE` is the Supervisor's TLS CA — a separate CA from the spoke cluster CA stored in the cluster Secret. Do not mix them up.

### `OIDC_TLS_SKIP_VERIFY` (dev only)

```bash
OIDC_TLS_SKIP_VERIFY=true
```

This disables TLS verification for the portal's own OIDC calls. **It does not propagate to the kubeconfig** — `pinniped login oidc` has no skip-verify flag, so any kubeconfig downloaded while this is set will fail when the user runs `kubectl`. Use `OIDC_CA_BUNDLE` instead for any environment where `kubectl` access needs to work.

See [environment-variables.md](./environment-variables.md) for full options.
