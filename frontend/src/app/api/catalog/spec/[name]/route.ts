import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

/**
 * Proxy route: fetches the raw OpenAPI spec for a catalog API entity and
 * returns it to the browser as same-origin JSON/YAML.
 *
 * Using a server-side proxy means:
 * - BACKEND_URL stays server-only (not exposed to the browser)
 * - No CORS issues regardless of network topology
 * - Session cookie forwarded transparently
 *
 * GET /api/catalog/spec/[name]
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const cookieStore = await cookies();
  const session = cookieStore.get("wxops_session")?.value ?? "";

  let res: Response;
  try {
    res = await fetch(
      `${BACKEND_URL}/api/v1/catalog/entities/API/${encodeURIComponent(name)}/spec`,
      {
        headers: { Cookie: `wxops_session=${session}` },
        cache: "no-store",
      },
    );
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: `Spec not available (${res.status})` },
      { status: res.status },
    );
  }

  const body = await res.text();
  const ct = res.headers.get("content-type") ?? "application/json";

  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": ct },
  });
}
