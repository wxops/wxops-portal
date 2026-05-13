"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

/**
 * Server Action: call the Go backend /auth/logout to expire the session cookie,
 * then proactively delete it from the Next.js cookie store and hard-redirect to
 * /login.
 *
 * Using a Server Action (instead of a client-side fetch + router.push) ensures:
 * - The RSC cache is fully invalidated on redirect.
 * - No stale session data is visible after sign-out.
 */
export async function logout() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("wxops_session");

  try {
    await fetch(`${BACKEND_URL}/auth/logout`, {
      method: "POST",
      headers: sessionCookie
        ? { Cookie: `wxops_session=${sessionCookie.value}` }
        : {},
      cache: "no-store",
    });
  } catch {
    // best-effort — proceed with local cookie deletion even if backend is down
  }

  // Proactively remove the cookie from the Next.js layer so the redirect
  // target sees no session even if the backend Set-Cookie was lost.
  cookieStore.delete("wxops_session");

  redirect("/login");
}
