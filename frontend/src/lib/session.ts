import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export interface UserSession {
  sub: string;
  username: string;
  groups: string[];
}

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

/**
 * Fetches the current user from the backend /auth/me endpoint.
 * The session cookie is automatically forwarded via the Next.js cookie store.
 * Returns null if not authenticated (no cookie or expired session).
 */
export async function getSession(): Promise<UserSession | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("wxops_session");
  if (!sessionCookie) return null;

  try {
    const res = await fetch(`${BACKEND_URL}/auth/me`, {
      headers: {
        Cookie: `wxops_session=${sessionCookie.value}`,
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json() as Promise<UserSession>;
  } catch {
    return null;
  }
}

/**
 * Like getSession but redirects to /login if there's no valid session.
 * Use this in protected server components.
 */
export async function requireSession(): Promise<UserSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
