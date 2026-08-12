package auth

import "testing"

// The return_to parameter is attacker-controllable — anyone can send a user a
// crafted portal login link — so every rejection case below is a real
// open-redirect defence, not a formality.
func TestSafeReturnPathRejectsOpenRedirects(t *testing.T) {
	hostile := []struct {
		name string
		in   string
	}{
		{"protocol-relative", "//evil.com/steal"},
		{"protocol-relative with backslash", `/\evil.com`},
		{"absolute https URL", "https://evil.com"},
		{"absolute http URL", "http://evil.com"},
		{"scheme-only", "javascript:alert(1)"},
		{"relative path", "dashboard/clusters"},
		{"backslash anywhere", `/dashboard\..\evil`},
		{"CRLF header injection", "/dashboard\r\nSet-Cookie: x=1"},
		{"newline", "/dashboard\nx"},
		{"null byte", "/dashboard\x00"},
		{"tab", "/dashboard\tx"},
		{"empty", ""},
		{"bare fragment", "#/dashboard"},
		{"bare query", "?next=/dashboard"},
	}

	for _, tc := range hostile {
		t.Run(tc.name, func(t *testing.T) {
			if got := SafeReturnPath(tc.in); got != "" {
				t.Errorf("SafeReturnPath(%q) = %q, want \"\" (rejected)", tc.in, got)
			}
		})
	}
}

// Returning to an auth route would bounce the user straight back into login.
func TestSafeReturnPathRejectsAuthRoutes(t *testing.T) {
	for _, in := range []string{"/auth", "/auth/", "/auth/login", "/auth/callback"} {
		if got := SafeReturnPath(in); got != "" {
			t.Errorf("SafeReturnPath(%q) = %q, want \"\" — must not loop through auth", in, got)
		}
	}
}

func TestSafeReturnPathAcceptsPortalPaths(t *testing.T) {
	cases := []struct{ in, want string }{
		{"/dashboard", "/dashboard"},
		{"/dashboard/clusters/hub", "/dashboard/clusters/hub"},
		{"/dashboard/catalog/Component/python-demo", "/dashboard/catalog/Component/python-demo"},
		{"/", "/"},

		// Query and fragment are dropped; the destination refetches its own data.
		{"/dashboard/catalog?tab=runtime", "/dashboard/catalog"},
		{"/dashboard/clusters/hub#pods", "/dashboard/clusters/hub"},

		// A path that merely starts with the letters "auth" is fine — only the
		// /auth route itself is excluded.
		{"/dashboard/authors", "/dashboard/authors"},
	}

	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			if got := SafeReturnPath(tc.in); got != tc.want {
				t.Errorf("SafeReturnPath(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// Whatever comes back must be safe to concatenate onto the frontend origin.
func TestSafeReturnPathOutputIsAlwaysOriginRelative(t *testing.T) {
	inputs := []string{
		"/dashboard", "//evil.com", "https://evil.com", `/\evil.com`,
		"/dashboard?x=1", "/auth/login", "relative", "",
	}

	for _, in := range inputs {
		got := SafeReturnPath(in)
		if got == "" {
			continue // rejected, caller uses its default
		}
		if got[0] != '/' {
			t.Errorf("SafeReturnPath(%q) = %q — must start with /", in, got)
		}
		if len(got) > 1 && (got[1] == '/' || got[1] == '\\') {
			t.Errorf("SafeReturnPath(%q) = %q — protocol-relative leaked through", in, got)
		}
	}
}
