# Cluster Registry Reference

The portal discovers spoke clusters from one of two sources, selected at startup:

| Source | When used | How |
|---|---|---|
| K8s Secrets | Production | Secrets labelled `wxops.io/kind=cluster` in `CLUSTER_NAMESPACE` |
| `clusters.json` | Development | Set `CLUSTERS_CONFIG_FILE` or `CLUSTERS_CONFIG` env var |

The portal caches the cluster list for 60 seconds. Adding a new Secret takes effect within one minute with no portal restart.

---

## K8s Secret Schema (production)

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: cluster-<id>
  namespace: wxops-system            # CLUSTER_NAMESPACE
  labels:
    wxops.io/kind: cluster           # required — discovery selector
  annotations:
    # Identity
    wxops.io/cluster-id: <id>                          # defaults to Secret name
    wxops.io/cluster-name: "Human-readable name"       # defaults to cluster-id

    # Pinniped — required for /token, /credentials, and mTLS spoke access
    wxops.io/jwt-authenticator-audience: <audience>    # JWTAuthenticator spec.audience (unique per cluster)
    wxops.io/jwt-authenticator-name: <name>            # JWTAuthenticator metadata.name

    # Pinniped — required for /kubeconfig (exec-credential kubeconfig)
    wxops.io/issuer-url: https://supervisor.example.com/providers/pinniped
    wxops.io/concierge-endpoint: ""                    # defaults to api-server when empty
    wxops.io/upstream-idp-name: dex                    # kubectl get oidcidentityproviders -n pinniped-supervisor
    wxops.io/upstream-idp-type: oidc                   # oidc | ldap | activedirectory | github
data:
  api-server: <base64(https://api.example.com:6443)>
  ca-bundle: <base64(PEM CA cert)>
```

### Pinniped CA bundle — two modes

Pinniped Concierge operates in one of two authentication modes. The correct CA bundle differs per mode.

**Mode A — Impersonation Proxy (most common)**

Concierge generates its own CA. The `api-server` value is the Concierge impersonation proxy endpoint (not the real Kubernetes API server).

```bash
# Get the CA from the Concierge-generated secret
kubectl get secret pinniped-concierge-impersonation-proxy-ca-certificate \
  -n pinniped-concierge \
  -o jsonpath='{.data.ca\.crt}' | base64 -d

# Check active mode
kubectl get credentialissuer -o json | jq '.items[].status.strategies[] | select(.status=="Success")'
```

**Mode B — KubeAPI Aggregation Layer**

Concierge uses the real Kubernetes API server endpoint and CA. The `api-server` and CA come from the kubeconfig.

```bash
kubectl config view --raw --minify \
  -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 -d
```

### CA bundle format options

The `ca-bundle` Secret key accepts a PEM-encoded certificate. You can also pass it as:

```json
// clusters.json
{
  "ca_bundle_base64": "<base64-encoded PEM>",  // from kubeconfig certificate-authority-data
  "ca_bundle_file":   "/path/to/ca.pem",        // file on disk
  "ca_bundle":        "-----BEGIN CERTIFICATE-----\n..."  // raw PEM with literal \n
}
```

Priority: `ca_bundle_file` > `ca_bundle_base64` > `ca_bundle`.

---

## clusters.json (development only)

Set `CLUSTERS_CONFIG_FILE=/path/to/clusters.json` or `CLUSTERS_CONFIG=<inline JSON>` in the backend environment. When either is set, K8s Secret discovery is disabled entirely.

> Do not use `clusters.json` in production. It is read once at startup — cluster changes require a pod restart and cannot be updated via GitOps.

See `backend/clusters.example.json` for a fully annotated example covering both Pinniped modes.
