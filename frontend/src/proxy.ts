import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Proxy (formerly middleware): redirect to /login if the session cookie is absent.
 * Full JWT verification happens server-side in each page via /auth/me.
 * The SESSION_SECRET never needs to be in the frontend environment.
 */
export function proxy(request: NextRequest) {
  const session = request.cookies.get("wxops_session");
  if (!session?.value) {
    const loginUrl = new URL("/login", request.url);
    // Remember where they were headed so signing in returns them there instead
    // of dumping them on the dashboard. Path only — auth.SafeReturnPath strips
    // the query server-side anyway, so sending it would promise a filter restore
    // that never happens. The backend re-validates before honouring it.
    loginUrl.searchParams.set("return_to", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
