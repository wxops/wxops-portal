package cluster

import "context"

// Registry abstracts cluster discovery.
//
// Two implementations are available:
//   - Discovery  — reads cluster registrations from K8s Secrets in the hub
//     cluster (GitOps / production).
//   - StaticRegistry — reads a JSON config file or the CLUSTERS_CONFIG env
//     var (local dev / testing, no hub cluster required).
//
// Choose the implementation in server.go based on whether CLUSTERS_CONFIG_FILE
// or CLUSTERS_CONFIG is set.
type Registry interface {
	ListClusters(ctx context.Context) ([]ClusterInfo, error)
	GetCluster(ctx context.Context, id string) (*ClusterInfo, error)
}
