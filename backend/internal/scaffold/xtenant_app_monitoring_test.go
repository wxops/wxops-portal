package scaffold

import (
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// Monitoring moved from prometheus.io/* pod annotations to
// spec.parameters.monitoring in v0.5.1. The annotations were never scraped on
// this platform, so any reappearance is a silent regression — nothing fails,
// the metrics just never arrive.
func TestXTenantAppBaseMonitoring(t *testing.T) {
	port := int32(9090)

	tests := []struct {
		name      string
		req       *CreateProjectRequest
		wantBlock bool
		wantPath  string
	}{
		{
			name:      "disabled emits no block",
			req:       &CreateProjectRequest{AppName: "api", Team: "rocket-team"},
			wantBlock: false,
		},
		{
			name:      "enabled defaults the path to the XRD default",
			req:       &CreateProjectRequest{AppName: "api", Team: "rocket-team", MonitorEnabled: true},
			wantBlock: true,
			wantPath:  "",
		},
		{
			name: "enabled carries an explicit path",
			req: &CreateProjectRequest{
				AppName: "api", Team: "rocket-team",
				MonitorEnabled: true, MetricsPath: "/internal/metrics",
				ContainerPort: &port,
			},
			wantBlock: true,
			wantPath:  "/internal/metrics",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			app := NewXTenantAppBase(tt.req, "https://gitea.example.com")

			out, err := yaml.Marshal(app)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			if strings.Contains(string(out), "prometheus.io/") {
				t.Errorf("legacy prometheus.io/* annotation emitted:\n%s", out)
			}

			mon := app.Spec.Parameters.Monitoring
			if !tt.wantBlock {
				if mon != nil {
					t.Fatalf("monitoring block emitted while disabled: %+v", mon)
				}
				return
			}
			if mon == nil {
				t.Fatal("monitoring block missing while enabled")
			}
			if !mon.Enabled {
				t.Error("monitoring.enabled is false in an emitted block")
			}
			if mon.Path != tt.wantPath {
				t.Errorf("path = %q, want %q", mon.Path, tt.wantPath)
			}
			// port is the composition's job — it falls back to containerPort.
			if mon.Port != nil {
				t.Errorf("port = %v, want nil so the composition can default it", *mon.Port)
			}
		})
	}
}
