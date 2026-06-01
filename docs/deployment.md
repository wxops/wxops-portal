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

## Step 4 — Register spoke clusters in the hub

Create one Secret per spoke in `wxops-system`:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: cluster-prod-east
  namespace: wxops-system
  labels:
    wxops.io/kind: cluster
  annotations:
    wxops.io/cluster-id:   prod-east
    wxops.io/cluster-name: "Production East"
    wxops.io/jwt-authenticator-audience: prod-east
    wxops.io/jwt-authenticator-name: wxops-jwt-authenticator
    wxops.io/issuer-url: https://supervisor.example.com/providers/pinniped
    wxops.io/upstream-idp-name: dex
    wxops.io/upstream-idp-type: oidc
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

## Step 6 — Supervisor CA (if self-signed)

If your Supervisor uses a private CA, pass it via env var:

```bash
# Inline PEM (base64-encode with literal \n)
OIDC_CA_BUNDLE="$(cat supervisor-ca.pem)"

# Or mount as a file and set:
OIDC_CA_BUNDLE_FILE=/etc/wxops/certs/ca.pem
```

See [environment-variables.md](./environment-variables.md) for full options.
