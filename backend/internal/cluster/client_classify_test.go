package cluster

import (
	"errors"
	"net/http"
	"testing"
)

func TestClassify(t *testing.T) {
	tests := []struct {
		name       string
		status     int
		wantErr    error // nil means "no error"; otherwise compared with errors.Is
		wantOpaque bool  // true when the error is expected to be a non-sentinel wrapped error
	}{
		{name: "200 OK is not an error", status: http.StatusOK, wantErr: nil},
		{name: "403 forbidden maps to ErrForbidden", status: http.StatusForbidden, wantErr: ErrForbidden},
		{name: "401 unauthorized also maps to ErrForbidden", status: http.StatusUnauthorized, wantErr: ErrForbidden},
		{name: "404 maps to ErrNotFound", status: http.StatusNotFound, wantErr: ErrNotFound},
		{name: "500 is an opaque error, not a sentinel", status: http.StatusInternalServerError, wantOpaque: true},
		{name: "502 is an opaque error, not a sentinel", status: http.StatusBadGateway, wantOpaque: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := classify(tt.status, []byte("body"))
			switch {
			case tt.wantErr == nil && !tt.wantOpaque:
				if err != nil {
					t.Errorf("classify(%d) = %v, want nil", tt.status, err)
				}
			case tt.wantOpaque:
				if err == nil {
					t.Fatalf("classify(%d) = nil, want a non-nil opaque error", tt.status)
				}
				if errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) {
					t.Errorf("classify(%d) = %v, should not match a sentinel", tt.status, err)
				}
			default:
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("classify(%d) = %v, want errors.Is match for %v", tt.status, err, tt.wantErr)
				}
			}
		})
	}
}
