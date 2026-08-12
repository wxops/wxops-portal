package auth

import "strings"

// SafeReturnPath sanitises a post-login redirect target.
//
// The portal lets a page that hit a 401 send the user back to exactly where
// they were: `/auth/login?return_to=/dashboard/clusters/hub`. That parameter is
// attacker-controllable — anyone can craft a portal login link — so it is
// treated as hostile input and reduced to a **same-origin path**, never a URL.
//
// Returns "" when the input cannot be safely used, and the caller falls back to
// the default landing page. Rejecting to a safe default is always preferable to
// honouring a questionable redirect.
//
// Rejected, and why:
//
//	""                       nothing to do
//	dashboard/clusters       relative — could resolve unpredictably
//	//evil.com/x             protocol-relative URL: browsers treat this as
//	                         https://evil.com/x, the classic open-redirect bypass
//	/\evil.com               backslash — some browsers normalise \ to /, making
//	                         this protocol-relative too
//	https://evil.com         absolute URL to another origin
//	/dashboard?x=1#y         query and fragment are dropped, path is kept
//	/auth/login              would bounce the user through login again
func SafeReturnPath(raw string) string {
	if raw == "" {
		return ""
	}

	// Control characters (CR/LF/NUL/tab) can split headers or confuse parsers.
	if strings.ContainsAny(raw, "\x00\r\n\t") {
		return ""
	}

	// Must be an absolute path on this origin.
	if !strings.HasPrefix(raw, "/") {
		return ""
	}

	// "//host" and "/\host" are protocol-relative; both resolve off-origin.
	if strings.HasPrefix(raw, "//") || strings.HasPrefix(raw, `/\`) {
		return ""
	}

	// A backslash anywhere is rejected rather than normalised — browsers differ
	// on how they treat it, and no legitimate portal path contains one.
	if strings.Contains(raw, `\`) {
		return ""
	}

	// Drop query and fragment: the destination page re-fetches its own data, so
	// carrying them adds attack surface for no benefit.
	path := raw
	if i := strings.IndexAny(path, "?#"); i >= 0 {
		path = path[:i]
	}

	if path == "" || !strings.HasPrefix(path, "/") {
		return ""
	}

	// Never return to an auth route — that would loop the user through login.
	if path == "/auth" || strings.HasPrefix(path, "/auth/") {
		return ""
	}

	return path
}
