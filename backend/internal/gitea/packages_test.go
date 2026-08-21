package gitea

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
)

func TestDiscoverPackagesAtRef_TruncatesAndSortsOversizedManifest(t *testing.T) {
	const declared = maxPackagesPerManifest + 1

	var b strings.Builder
	b.WriteString("module example.com/big\n\ngo 1.21\n\nrequire (\n")
	// Declare out of alphabetical order so a correct implementation must
	// sort, not just happen to already be sorted.
	for i := declared - 1; i >= 0; i-- {
		fmt.Fprintf(&b, "\texample.com/dep%04d v1.0.0\n", i)
	}
	b.WriteString(")\n")
	goMod := b.String()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/go.mod") {
			writeFileContentResponse(w, goMod)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	c := New(srv.URL, "token", "owner", "repo")
	manifests, err := DiscoverPackagesAtRef(context.Background(), c, "owner", "repo", "")
	if err != nil {
		t.Fatalf("DiscoverPackagesAtRef: %v", err)
	}
	if len(manifests) != 1 {
		t.Fatalf("expected exactly one manifest (go.mod), got %d", len(manifests))
	}

	m := manifests[0]
	if !m.Truncated {
		t.Errorf("Truncated = false, want true for a %d-package manifest", declared)
	}
	if m.Total != declared {
		t.Errorf("Total = %d, want %d", m.Total, declared)
	}
	if len(m.Packages) != maxPackagesPerManifest {
		t.Fatalf("len(Packages) = %d, want %d", len(m.Packages), maxPackagesPerManifest)
	}
	if !sort.SliceIsSorted(m.Packages, func(i, j int) bool { return m.Packages[i].Name < m.Packages[j].Name }) {
		t.Errorf("Packages not sorted by name — truncation would silently drop a different subset per request")
	}
}

// writeFileContentResponse mimics Gitea's contents API response shape,
// matching the base64-wrapping GetRepoFileAtRef already decodes.
func writeFileContentResponse(w http.ResponseWriter, content string) {
	w.Header().Set("Content-Type", "application/json")
	encoded := base64.StdEncoding.EncodeToString([]byte(content))
	fmt.Fprintf(w, `{"content":%q}`, encoded)
}
