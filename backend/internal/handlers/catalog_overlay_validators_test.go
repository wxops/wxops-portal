package handlers

import "testing"

func TestIsValidOverlayHostname(t *testing.T) {
	tests := []struct {
		name string
		h    string
		want bool
	}{
		{name: "simple valid hostname", h: "rocket-api.example.com", want: true},
		{name: "single label", h: "localhost", want: true},
		{name: "empty is invalid", h: "", want: false},
		{name: "leading hyphen in a label is invalid", h: "-rocket.example.com", want: false},
		{name: "trailing hyphen in a label is invalid", h: "rocket-.example.com", want: false},
		{name: "empty label (double dot) is invalid", h: "rocket..example.com", want: false},
		{name: "underscore is invalid", h: "rocket_api.example.com", want: false},
		{name: "label over 63 chars is invalid", h: string(make([]byte, 64)), want: false},
		{name: "hostname over 253 chars is invalid", h: longHostname(254), want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isValidOverlayHostname(tt.h); got != tt.want {
				t.Errorf("isValidOverlayHostname(%q) = %v, want %v", tt.h, got, tt.want)
			}
		})
	}
}

// longHostname builds a syntactically dotted hostname of approximately n
// total characters using valid 10-char labels, so the length check — not an
// incidental label-length or character-class failure — is what's exercised.
func longHostname(n int) string {
	label := "abcdefghij."
	var s string
	for len(s) < n {
		s += label
	}
	return s[:n]
}

func TestIsValidK8sQuantity(t *testing.T) {
	tests := []struct {
		name string
		s    string
		want bool
	}{
		{name: "plain integer", s: "100", want: true},
		{name: "decimal", s: "0.5", want: true},
		{name: "millicore suffix", s: "100m", want: true},
		{name: "binary mebibyte suffix", s: "512Mi", want: true},
		{name: "binary gibibyte suffix", s: "1Gi", want: true},
		{name: "decimal SI suffix", s: "10G", want: true},
		{name: "empty string is invalid", s: "", want: false},
		{name: "suffix with no digits is invalid", s: "Mi", want: false},
		{name: "letters that aren't a known suffix are invalid", s: "100xyz", want: false},
		// KNOWN GAP, characterized not fixed here: the digit loop only rejects
		// non-digit/non-'.' characters, so it never limits to a single decimal
		// point. "1.2.3" is not a valid Kubernetes resource.Quantity but this
		// function accepts it. Left as-is per "tests before fixes" — flag for a
		// follow-up correctness PR, not silently patched inside a test pass.
		{name: "multiple decimal points slip through (known validation gap)", s: "1.2.3", want: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isValidK8sQuantity(tt.s); got != tt.want {
				t.Errorf("isValidK8sQuantity(%q) = %v, want %v", tt.s, got, tt.want)
			}
		})
	}
}

func TestIsValidK8sName(t *testing.T) {
	tests := []struct {
		name string
		s    string
		want bool
	}{
		{name: "lowercase with hyphens", s: "rocket-db", want: true},
		{name: "lowercase alphanumeric", s: "db2", want: true},
		{name: "empty is invalid", s: "", want: false},
		{name: "leading hyphen is invalid", s: "-rocket-db", want: false},
		{name: "trailing hyphen is invalid", s: "rocket-db-", want: false},
		{name: "uppercase is invalid", s: "Rocket-DB", want: false},
		{name: "underscore is invalid", s: "rocket_db", want: false},
		{name: "over 63 chars is invalid", s: longHostname(64), want: false}, // contains dots too, but length alone already disqualifies
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isValidK8sName(tt.s); got != tt.want {
				t.Errorf("isValidK8sName(%q) = %v, want %v", tt.s, got, tt.want)
			}
		})
	}
}

// overlayReq is a local alias matching validateOverlayRequest's anonymous
// parameter struct field-for-field, so tests can build it as a named type.
type overlayReq = struct {
	IngressHost       string
	CertIssuer        string
	Replicas          *int32
	ResourcesCPUReq   string
	ResourcesCPULim   string
	ResourcesMemReq   string
	ResourcesMemLim   string
	DatabaseEnabled   bool
	DbTier            string
	DbName            string
	DbInstances       int32
	DbStorageSize     string
	DbPostgresVersion int
}

func int32ptr(v int32) *int32 { return &v }

func TestValidateOverlayRequest(t *testing.T) {
	tests := []struct {
		name    string
		req     overlayReq
		ctx     overlayValidationContext
		wantErr bool
	}{
		{
			name:    "empty request against a base with no ingress/db is valid",
			req:     overlayReq{},
			ctx:     overlayValidationContext{},
			wantErr: false,
		},
		{
			name:    "ingress enabled on base but no host supplied",
			req:     overlayReq{},
			ctx:     overlayValidationContext{ingressEnabled: true},
			wantErr: true,
		},
		{
			name:    "ingress host supplied satisfies the base requirement",
			req:     overlayReq{IngressHost: "rocket-api.example.com"},
			ctx:     overlayValidationContext{ingressEnabled: true},
			wantErr: false,
		},
		{
			name:    "malformed ingress host",
			req:     overlayReq{IngressHost: "-not-valid-"},
			ctx:     overlayValidationContext{ingressEnabled: true},
			wantErr: true,
		},
		{
			name:    "certIssuer without a host",
			req:     overlayReq{CertIssuer: "letsencrypt-prod"},
			ctx:     overlayValidationContext{},
			wantErr: true,
		},
		{
			name:    "replicas below one",
			req:     overlayReq{Replicas: int32ptr(0)},
			ctx:     overlayValidationContext{},
			wantErr: true,
		},
		{
			name:    "replicas at minimum is valid",
			req:     overlayReq{Replicas: int32ptr(1)},
			ctx:     overlayValidationContext{},
			wantErr: false,
		},
		{
			name:    "invalid cpu request quantity",
			req:     overlayReq{ResourcesCPUReq: "not-a-quantity"},
			ctx:     overlayValidationContext{},
			wantErr: true,
		},
		{
			name:    "database enabled with invalid tier",
			req:     overlayReq{DatabaseEnabled: true, DbTier: "premium"},
			ctx:     overlayValidationContext{},
			wantErr: true,
		},
		{
			name:    "database enabled with shared tier and no instance/storage requirements",
			req:     overlayReq{DatabaseEnabled: true, DbTier: "shared"},
			ctx:     overlayValidationContext{},
			wantErr: false,
		},
		{
			name:    "dedicated tier with zero instances",
			req:     overlayReq{DatabaseEnabled: true, DbTier: "dedicated", DbInstances: 0},
			ctx:     overlayValidationContext{},
			wantErr: true,
		},
		{
			name:    "dedicated tier with valid instances and storage",
			req:     overlayReq{DatabaseEnabled: true, DbTier: "dedicated", DbInstances: 3, DbStorageSize: "10Gi"},
			ctx:     overlayValidationContext{},
			wantErr: false,
		},
		{
			name:    "postgres version out of supported range",
			req:     overlayReq{DatabaseEnabled: true, DbTier: "dedicated", DbInstances: 1, DbPostgresVersion: 12},
			ctx:     overlayValidationContext{},
			wantErr: true,
		},
		{
			name:    "postgres version within supported range",
			req:     overlayReq{DatabaseEnabled: true, DbTier: "dedicated", DbInstances: 1, DbPostgresVersion: 16},
			ctx:     overlayValidationContext{},
			wantErr: false,
		},
		{
			name:    "database disabled skips all db checks even if fields look invalid",
			req:     overlayReq{DatabaseEnabled: false, DbTier: "premium", DbInstances: 0},
			ctx:     overlayValidationContext{},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			errs := validateOverlayRequest(tt.req, tt.ctx)
			if got := len(errs) > 0; got != tt.wantErr {
				t.Errorf("validateOverlayRequest() errs = %v, wantErr %v", errs, tt.wantErr)
			}
		})
	}
}
